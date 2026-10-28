import fcntl
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


def terminate_owned_child(child, pidfd, pinned, allowed_executables=()):
    if child.poll() is not None:
        return
    actual = process_identity(child.pid)
    if actual[:2] != pinned[:2] or actual[2] not in (pinned[2], *allowed_executables):
        raise RuntimeError('Process identity lost')
    signal.pidfd_send_signal(pidfd, signal.SIGTERM)
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        child.wait(timeout=2)


def build_bwrap_arguments(directory, request):
    if type(directory) is not int or directory <= 3 or request['probe'] not in ('BOUNDARY', 'LIFECYCLE_WAIT'):
        raise RuntimeError('Invalid probe descriptor or command')
    run_id = request['runId']
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', run_id):
        raise RuntimeError('Invalid probe identity')
    return ['/usr/bin/bwrap', '--unshare-user', '--unshare-net', '--unshare-pid',
            '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session', '--clearenv',
            '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
            '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
            '--dir', '/var', '--dir', '/var/run', '--ro-bind', '/proc/self/fd/' + str(directory), '/lm',
            '--ro-bind-data', '3', '/lm/probe.py',
            '--setenv', 'LANG', 'C', '--setenv', 'LC_ALL', 'C', '--setenv', 'HOME', '/lm/home',
            '--setenv', 'LM_PROBE_RUN_ID', run_id,
            '--', '/usr/bin/python3', '-I', '-S', '/lm/probe.py', '--payload', request['probe'], run_id]


def read_sealed_program(expected_hash):
    seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
    identity = os.fstat(3)
    if not stat.S_ISREG(identity.st_mode) or not 0 < identity.st_size <= 131072 or fcntl.fcntl(3, fcntl.F_GET_SEALS) & seals != seals:
        raise RuntimeError('Executable snapshot is not sealed')
    program = os.pread(3, identity.st_size + 1, 0)
    if len(program) != identity.st_size or hashlib.sha256(program).hexdigest() != expected_hash:
        raise RuntimeError('Executable snapshot hash differs')
    return program


def await_prelaunch(descriptor, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeError('Prelaunch deadline exceeded')
    ready, _, _ = select.select([descriptor], [], [], remaining)
    if not ready or os.read(descriptor, 4) != b'GO\n' or time.monotonic() >= deadline:
        raise RuntimeError('Prelaunch barrier closed')


def prelaunch(descriptor, directory, request, deadline):
    if type(descriptor) is not int or type(directory) is not int or descriptor <= 3 or directory <= 3 or descriptor == directory:
        raise RuntimeError('Invalid prelaunch descriptors')
    try:
        arguments = build_bwrap_arguments(directory, request)
        read_sealed_program(request['supervisorSha256'])
        await_prelaunch(descriptor, deadline)
    finally:
        os.close(descriptor)
    # No Popen/fork: the owned, pinned child transitions to the fixed bwrap image.
    os.lseek(3, 0, os.SEEK_SET)
    os.set_inheritable(3, True)
    os.set_inheritable(directory, True)
    os.execve(arguments[0], arguments, {'LANG': 'C', 'LC_ALL': 'C'})


def finish_child(child, pidfd, pinned, released):
    if child is None:
        return False
    try:
        if not released:
            # Parent has closed its sole writer. EOF aborts the inert prelaunch.
            try:
                child.wait(timeout=2)
                return True
            except subprocess.TimeoutExpired:
                pass
        if pidfd is None or pinned is None:
            return False
        terminate_owned_child(child, pidfd, pinned, ('/usr/bin/bwrap',) if released else ())
        child.wait(timeout=2)
        return True
    except Exception:
        return False


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
    pinned = None
    barrier_read = None
    barrier_write = None
    released = False
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
        program = read_sealed_program(request['supervisorSha256'])
        write_owned(directory, 'probe.py', program)
        emit('ACQUIRED', before=before)
        await_durable_acquisition(session_deadline)
        if interrupted[0] or time.monotonic() >= session_deadline:
            raise RuntimeError('Acquisition interrupted or expired')
        arguments = build_bwrap_arguments(directory, request)
        emit('LAUNCHING')
        barrier_read, barrier_write = os.pipe2(os.O_CLOEXEC)
        child = subprocess.Popen(['/usr/bin/python3', '-I', '-S', '/proc/self/fd/3', '--prelaunch',
                                  str(barrier_read), str(directory), json.dumps(request), str(session_deadline)],
                                 shell=False, env={'LANG': 'C', 'LC_ALL': 'C'},
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 close_fds=True, pass_fds=(3, directory, barrier_read))
        owned_read, barrier_read = barrier_read, None
        os.close(owned_read)
        # Popen owns the unreaped child: PID cannot be reused before pidfd_open.
        child_pidfd = os.pidfd_open(child.pid)
        pinned = process_identity(child.pid)
        write_owned(directory, 'process.json', json.dumps(pinned).encode())
        emit('RUNNING')
        if interrupted[0] or time.monotonic() >= session_deadline or child.poll() is not None:
            raise RuntimeError('Prelaunch interrupted, expired or exited')
        if process_identity(child.pid) != pinned:
            raise RuntimeError('Prelaunch identity lost')
        if os.write(barrier_write, b'GO\n') != 3:
            raise RuntimeError('Prelaunch release incomplete')
        released = True
        owned_write, barrier_write = barrier_write, None
        os.close(owned_write)
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
                terminate_owned_child(child, child_pidfd, pinned, (arguments[0],))
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
        # Abort the inert stage even without a pidfd; never release after failure.
        if barrier_write is not None:
            owned_write, barrier_write = barrier_write, None
            try:
                os.close(owned_write)
            except OSError:
                pass
        reaped = finish_child(child, child_pidfd, pinned, released)
        if directory is not None:
            try:
                write_owned(directory, 'termination.json', json.dumps({'childReaped': reaped, 'workloadReleased': released}).encode())
            except Exception:
                pass
        # Evidence failure must never skip containment/wait or become a PASS.
        try:
            emit('PARTIAL_FAILURE')
            emit('CLOSED', treeEmpty=False, hostUnchanged=False, evidenceComplete=False, boundaryPassed=False)
        except Exception:
            raise RuntimeError('Terminal evidence unavailable') from None
    finally:
        close_failed = False
        for descriptor in (barrier_read, barrier_write, child_pidfd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    close_failed = True
        for stream in (() if child is None else (child.stdout, child.stderr)):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    close_failed = True
        if audit is not None:
            try:
                audit.close()
            except OSError:
                close_failed = True
        if directory is not None:
            try:
                os.close(directory)
            except OSError:
                close_failed = True
        if close_failed:
            raise RuntimeError('Owned handle closure unverified')
        # Resources are retained; no tree absence or recovery is inferred from reap.


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
    elif sys.argv[1:2] == ['--prelaunch'] and len(sys.argv) == 6:
        require_native_execution_authorization()
        prelaunch(int(sys.argv[2]), int(sys.argv[3]), json.loads(sys.argv[4]), float(sys.argv[5]))
    elif sys.argv[1:] == ['--supervise']:
        # A second gate prevents direct --supervise use during SOURCE-ONLY P2.
        require_native_execution_authorization()
        supervise(read_request())
    else:
        raise SystemExit('Unknown PROBE_ONLY entry')
