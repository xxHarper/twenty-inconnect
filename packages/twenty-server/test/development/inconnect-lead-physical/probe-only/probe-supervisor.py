import hashlib
import json
import os
import re
import resource
import select
import signal
import stat
import subprocess
import sys
import time


def boot_id():
    with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as stream:
        return stream.read().strip()


def snapshot():
    result = {'bootId': boot_id(), 'namespaces': {}}
    for name in ('user', 'net', 'mnt', 'pid'):
        result['namespaces'][name] = os.readlink('/proc/self/ns/' + name)
    for name in ('mountinfo', 'net/route', 'net/ipv6_route', 'net/unix'):
        path = '/proc/self/' + name if name == 'mountinfo' else '/proc/' + name
        with open(path, encoding='utf8') as stream:
            result[name] = stream.read(65537)
            if len(result[name]) > 65536:
                raise RuntimeError('Observation bound exceeded')
            if name == 'mountinfo':
                result[name] = hashlib.sha256(result[name].encode()).hexdigest()
            elif name == 'net/unix':
                # Retain counts without leaking unrelated host socket paths.
                result[name] = '\n'.join('socket' for _ in result[name].splitlines())
    return result


def process_identity(pid):
    with open('/proc/' + str(pid) + '/stat', encoding='ascii') as stream:
        ticks = stream.read().rsplit(')', 1)[1].split()[19]
    return (pid, ticks, os.readlink('/proc/' + str(pid) + '/exe'))


def write_owned(directory, name, data):
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.fsync(directory)


def payload(probe, run_id):
    if probe not in ('BOUNDARY', 'LIFECYCLE_WAIT'):
        raise RuntimeError('Unknown probe')
    expected_environment = {'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/lm/home', 'LM_PROBE_RUN_ID': run_id}
    if dict(os.environ) != expected_environment:
        raise RuntimeError('Environment boundary mismatch')
    with open('/lm/canary', encoding='ascii') as stream:
        if stream.read() != run_id:
            raise RuntimeError('Missing owned canary')
    for path in ('/home', '/mnt', '/etc', '/run/postgresql', '/var/run/postgresql',
                 '/var/lib/postgresql', '/lm/.env', '/lm/.env.test', '/lm/.pgpass'):
        if os.path.lexists(path):
            raise RuntimeError('Filesystem boundary mismatch')
    for descriptor in os.listdir('/proc/self/fd'):
        if int(descriptor) <= 2:
            continue
        try:
            os.readlink('/proc/self/fd/' + descriptor)
        except FileNotFoundError:
            continue
        raise RuntimeError('Unexpected inherited descriptor')
    observed = snapshot()
    with open('/proc/net/dev', encoding='ascii') as stream:
        interfaces = [row.split(':', 1)[0].strip() for row in stream if ':' in row]
    if interfaces != ['lo'] or len(observed['net/route'].splitlines()) != 1:
        raise RuntimeError('Network interface or IPv4 route mismatch')
    if observed['net/ipv6_route'].strip() or len(observed['net/unix'].splitlines()) != 1:
        raise RuntimeError('IPv6 route or Unix socket boundary mismatch')
    # No connect, socket or packet is sent to the host or an external service.
    print(json.dumps(observed), flush=True)
    if probe == 'LIFECYCLE_WAIT':
        time.sleep(10)


def empty_namespace(namespace):
    # Incomplete visibility cannot establish absence. Never signal discovered PIDs.
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        try:
            path = '/proc/' + name
            if os.readlink(path + '/ns/pid') == namespace:
                return False
        except FileNotFoundError:
            continue
        except PermissionError:
            return False
    return True


def terminate_owned_child(child, pidfd, pinned):
    if child.poll() is not None:
        return
    if process_identity(child.pid) != pinned:
        raise RuntimeError('Process identity lost')
    signal.pidfd_send_signal(pidfd, signal.SIGTERM)
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        child.wait(timeout=2)


def build_bwrap_arguments(directory, request):
    if type(directory) is not int or directory < 3 or request['probe'] not in ('BOUNDARY', 'LIFECYCLE_WAIT'):
        raise RuntimeError('Invalid probe descriptor or command')
    run_id = request['runId']
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', run_id):
        raise RuntimeError('Invalid probe identity')
    return ['/usr/bin/bwrap', '--unshare-user', '--unshare-net', '--unshare-pid',
            '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session', '--clearenv',
            '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
            '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
            '--dir', '/var', '--dir', '/var/run', '--ro-bind', '/proc/self/fd/' + str(directory), '/lm',
            '--setenv', 'LANG', 'C', '--setenv', 'LC_ALL', 'C', '--setenv', 'HOME', '/lm/home',
            '--setenv', 'LM_PROBE_RUN_ID', run_id,
            '--', '/usr/bin/python3', '-I', '-S', '/lm/probe.py', '--payload', request['probe'], run_id]


def await_durable_acquisition(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeError('Acquisition deadline exceeded')
    ready, _, _ = select.select([sys.stdin], [], [], remaining)
    if not ready or os.read(sys.stdin.fileno(), 32) != b'ACK\n':
        raise RuntimeError('Durable acquisition acknowledgement missing')


def supervise(request):
    required = {'capability', 'probe', 'expectedTermination', 'runId', 'bootId', 'reviewedCommit', 'supervisorSha256',
                'resourceRoot', 'deadlineSeconds', 'memoryMiB', 'processLimit'}
    if set(request) != required or request['capability'] != 'PROBE_ONLY':
        raise RuntimeError('Only PROBE_ONLY is implemented')
    run_id = request['runId']
    if not isinstance(run_id, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', run_id):
        raise RuntimeError('Invalid run identity')
    if request['resourceRoot'] != '/tmp/inconnect-lead-phys-' + run_id or request['probe'] not in ('BOUNDARY', 'LIFECYCLE_WAIT'):
        raise RuntimeError('Invalid resource or command')
    if request['expectedTermination'] not in ('NORMAL_EXIT', 'TIMEOUT', 'CANCELLED', 'INTERRUPTED'):
        raise RuntimeError('Invalid termination expectation')
    if request['probe'] == 'BOUNDARY' and request['expectedTermination'] != 'NORMAL_EXIT':
        raise RuntimeError('Invalid boundary scenario')
    for key, minimum, maximum in (('deadlineSeconds', 1, 30), ('memoryMiB', 128, 512), ('processLimit', 16, 64)):
        if type(request[key]) is not int or not minimum <= request[key] <= maximum:
            raise RuntimeError('Invalid limit')
    session_deadline = time.monotonic() + request['deadlineSeconds']
    if boot_id() != request['bootId'] or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('Kernel or boot identity unavailable')
    own_pidfd = os.pidfd_open(os.getpid())
    os.close(own_pidfd)
    resource.setrlimit(resource.RLIMIT_AS, (request['memoryMiB'] * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NPROC, (request['processLimit'],) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (35, 35))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1048576, 1048576))
    sequence = 0
    directory = None
    child = None
    child_pidfd = None
    audit = None
    pending_events = []
    interrupted = [False]
    signal.signal(signal.SIGTERM, lambda *_: interrupted.__setitem__(0, True))
    signal.signal(signal.SIGINT, lambda *_: interrupted.__setitem__(0, True))

    def emit(kind, **extra):
        nonlocal sequence
        sequence += 1
        event = {'runId': run_id, 'bootId': request['bootId'], 'sequence': sequence, 'kind': kind, **extra}
        encoded = json.dumps(event) + '\n'
        if audit is not None:
            audit.write(encoded)
            audit.flush()
            os.fsync(audit.fileno())
        else:
            pending_events.append(encoded)
        sys.stdout.write(encoded)
        sys.stdout.flush()

    try:
        before = snapshot()
        emit('ACQUIRING')
        temporary = os.open('/tmp', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            root_name = 'inconnect-lead-phys-' + run_id
            os.mkdir(root_name, mode=0o700, dir_fd=temporary)
            os.fsync(temporary)
            directory = os.open(root_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=temporary)
        finally:
            os.close(temporary)
        identity = os.fstat(directory)
        if identity.st_uid != os.getuid() or stat.S_IMODE(identity.st_mode) != 0o700:
            raise RuntimeError('Resource ownership unknown')
        descriptor = os.open('events.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        audit = os.fdopen(descriptor, 'w', encoding='utf8')
        audit.writelines(pending_events)
        audit.flush()
        os.fsync(audit.fileno())
        write_owned(directory, 'before.json', json.dumps(before).encode())
        write_owned(directory, 'ownership.json', json.dumps({'runId': run_id, 'bootId': request['bootId'], 'device': identity.st_dev, 'inode': identity.st_ino}).encode())
        write_owned(directory, 'canary', run_id.encode('ascii'))
        os.mkdir('home', mode=0o700, dir_fd=directory)
        with open('/proc/self/fd/3', 'rb') as source:
            program = source.read(131072)
        if hashlib.sha256(program).hexdigest() != request['supervisorSha256']:
            raise RuntimeError('Reviewed program hash differs')
        write_owned(directory, 'probe.py', program)
        emit('ACQUIRED', before=before)
        await_durable_acquisition(session_deadline)
        if interrupted[0] or time.monotonic() >= session_deadline:
            raise RuntimeError('Acquisition interrupted or expired')
        arguments = build_bwrap_arguments(directory, request)
        emit('LAUNCHING')
        child = subprocess.Popen(arguments, shell=False, env={'LANG': 'C', 'LC_ALL': 'C'},
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 close_fds=True, pass_fds=(directory,))
        # Popen owns the unreaped child: PID cannot be reused before pidfd_open.
        child_pidfd = os.pidfd_open(child.pid)
        pinned = process_identity(child.pid)
        write_owned(directory, 'process.json', json.dumps(pinned).encode())
        emit('RUNNING')
        deadline = session_deadline
        cause = 'NORMAL_EXIT'
        while True:
            try:
                stdout, stderr = child.communicate(timeout=0.02)
                break
            except subprocess.TimeoutExpired as pending:
                if len(pending.output or b'') + len(pending.stderr or b'') > 65536:
                    raise RuntimeError('Output bound exceeded')
            if boot_id() != request['bootId']:
                raise RuntimeError('Boot identity changed')
            ready, _, _ = select.select([sys.stdin], [], [], 0)
            control = os.read(sys.stdin.fileno(), 32) if ready else None
            cancel = control == b'CANCEL\n'
            if control == b'':
                interrupted[0] = True
            if control not in (None, b'', b'CANCEL\n'):
                raise RuntimeError('Unexpected control input')
            if interrupted[0] or cancel or time.monotonic() >= deadline:
                cause = 'INTERRUPTED' if interrupted[0] else 'CANCELLED' if cancel else 'TIMEOUT'
                terminate_owned_child(child, child_pidfd, pinned)
                stdout, stderr = child.communicate(timeout=2)
                break
        if len(stdout) + len(stderr) > 65536:
            raise RuntimeError('Output bound exceeded')
        write_owned(directory, 'probe.stdout', stdout)
        write_owned(directory, 'probe.stderr', stderr)
        observed = json.loads(stdout.decode('utf8'))
        independent = all(observed['namespaces'][key] != before['namespaces'][key] for key in ('user', 'net', 'mnt', 'pid'))
        emit(cause)
        after = snapshot()
        write_owned(directory, 'after.json', json.dumps(after).encode())
        emit('CLOSED', supervisorExited=True, treeEmpty=empty_namespace(observed['namespaces']['pid']),
             hostUnchanged=before == after, evidenceComplete=True,
             observations={'before': before, 'after': after, 'probe': observed},
             boundaryPassed=independent and (child.returncode == 0 if cause == 'NORMAL_EXIT' else child.returncode in (-signal.SIGTERM, -signal.SIGKILL)))
    except Exception:
        # Never fall back to numeric kill or recursive cleanup on missing authority.
        emit('PARTIAL_FAILURE')
        emit('CLOSED', treeEmpty=False, hostUnchanged=False, evidenceComplete=False, boundaryPassed=False)
    finally:
        if child_pidfd is not None:
            os.close(child_pidfd)
        if audit is not None:
            audit.close()
        if directory is not None:
            os.close(directory)
        # All resources are retained; independent recovery is required on loss.


def require_native_execution_authorization():
    raise RuntimeError('PHYS-P2: supervisor execution BLOCKED pending physical authorization/review')


def read_request():
    value = bytearray()
    while len(value) <= 65536:
        current = os.read(sys.stdin.fileno(), 1)
        if current == b'\n':
            return json.loads(value.decode('utf8'))
        if not current:
            break
        value.extend(current)
    raise RuntimeError('Incomplete or oversized request')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--payload'] and len(sys.argv) == 4:
        payload(sys.argv[2], sys.argv[3])
    elif sys.argv[1:] == ['--supervise']:
        # A second gate prevents direct --supervise use during SOURCE-ONLY P2.
        require_native_execution_authorization()
        supervise(read_request())
    else:
        raise SystemExit('Unknown PROBE_ONLY entry')
