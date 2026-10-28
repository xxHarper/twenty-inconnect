import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('acquisition_under_test', Path(__file__).with_name('probe-supervisor.py'))
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
RUN = '10000000-0000-4000-8000-000000000001'
BOOT = '20000000-0000-4000-8000-000000000001'
PROGRAM = b'# synthetic, never executed\n'


def request():
    return dict(capability='PROBE_ONLY', probe='BOUNDARY', expectedTermination='NORMAL_EXIT', runId=RUN,
                bootId=BOOT, reviewedCommit='a'*40, supervisorSha256=hashlib.sha256(PROGRAM).hexdigest(),
                resourceRoot='/tmp/inconnect-lead-phys-'+RUN, deadlineSeconds=2, memoryMiB=128, processLimit=16)


class AcquisitionSourceTests(unittest.TestCase):
    def exercise(self, failure):
        child = Mock(pid=123, returncode=None)
        child.poll.return_value = None
        output = io.StringIO()
        operations = []
        with contextlib.ExitStack() as stack:
            for obj, name, value in ((supervisor, 'boot_id', BOOT), (supervisor, 'snapshot', {}),
                                     (supervisor.os, 'open', 9), (supervisor.os, 'getuid', 1000),
                                     (supervisor.os, 'fdopen', Mock(fileno=Mock(return_value=9))),
                                     (supervisor.os, 'fstat', Mock(st_uid=1000, st_mode=0o40700, st_dev=1, st_ino=2)),
                                     (supervisor, 'process_identity', (123, '10', '/usr/bin/python3')),
                                     (supervisor, 'read_sealed_program', PROGRAM),
                                     (supervisor.os, 'pipe2', (20, 21))):
                stack.enter_context(patch.object(obj, name, return_value=value))
            for obj, name in ((supervisor.os, 'mkdir'), (supervisor.os, 'fsync'), (supervisor.resource, 'setrlimit'), (supervisor.signal, 'signal'), (supervisor, 'await_durable_acquisition')):
                stack.enter_context(patch.object(obj, name))
            def close_owned(fd):
                operations.append(('close', fd))
                if failure == 'read-close' and fd == 20:
                    raise OSError('Read handle close failed')
            close = stack.enter_context(patch.object(supervisor.os, 'close', side_effect=close_owned))
            write = stack.enter_context(patch.object(supervisor.os, 'write', side_effect=lambda fd, data: operations.append(('release', fd)) or len(data)))
            stack.enter_context(patch.object(supervisor.sys, 'stdout', output))
            stack.enter_context(patch.object(supervisor.os, 'kill', side_effect=AssertionError('Numeric kill forbidden')))
            signal = stack.enter_context(patch.object(supervisor.signal, 'pidfd_send_signal'))
            spawn = stack.enter_context(patch.object(supervisor.subprocess, 'Popen', return_value=child))
            stack.enter_context(patch.object(supervisor.os, 'pidfd_open', side_effect=[88, OSError('pidfd unavailable')] if failure in ('pidfd', 'pidfd-timeout') else [88, 89]))
            identity = (123, '10', '/usr/bin/python3')
            if failure == 'identity':
                stack.enter_context(patch.object(supervisor, 'process_identity', side_effect=OSError('Identity lost')))
            def persist(_directory, name, data):
                operations.append(('persist', name))
                if name == 'process.json' and failure in ('process-evidence', 'terminal-evidence', 'wait-error', 'wait-timeout', 'signal-error'):
                    raise OSError('process fsync failure')
                if name == 'termination.json' and failure == 'terminal-evidence':
                    raise OSError('terminal fsync failure')
            stack.enter_context(patch.object(supervisor, 'write_owned', side_effect=persist))
            if failure == 'wait-error':
                child.wait.side_effect = OSError('wait failed')
            elif failure in ('wait-timeout', 'signal-error', 'pidfd-timeout'):
                child.wait.side_effect = subprocess.TimeoutExpired('owned', 2)
            if failure == 'signal-error':
                signal.side_effect = PermissionError('No signal authority')
            if failure == 'early-exit':
                child.poll.return_value = 0
            if failure == 'identity-drift':
                stack.enter_context(patch.object(supervisor, 'process_identity', side_effect=[identity, (123, '11', '/usr/bin/python3')]))
            if failure == 'after-release':
                child.communicate.side_effect = OSError('communication lost')
            if failure == 'audit-terminal':
                # Both RUNNING and terminal persistence can fail; containment still runs.
                audit = Mock(fileno=Mock(return_value=9))
                def fail_terminal(encoded):
                    if '"kind": "RUNNING"' in encoded or '"kind": "PARTIAL_FAILURE"' in encoded:
                        raise OSError('audit failed')
                audit.write.side_effect = fail_terminal
                stack.enter_context(patch.object(supervisor.os, 'fdopen', return_value=audit))
            supervisor.supervise(request()) if failure != 'audit-terminal' else self.assertRaises(RuntimeError, supervisor.supervise, request())
            spawn.assert_called_once()
            self.assertIn('--prelaunch', spawn.call_args.args[0])
            self.assertEqual(spawn.call_args.kwargs['pass_fds'], (3, 9, 20))
            self.assertNotIn(21, spawn.call_args.kwargs['pass_fds'])
            if failure == 'after-release':
                self.assertIn(('persist', 'process.json'), operations)
                self.assertLess(operations.index(('persist', 'process.json')), operations.index(('release', 21)))
                signal.assert_called()
            else:
                write.assert_not_called()
                self.assertIn(('close', 21), operations)
                child.wait.assert_called()
            if failure in ('pidfd', 'pidfd-timeout'):
                signal.assert_not_called()
            if failure == 'process-evidence':
                self.assertLess(operations.index(('close', 21)), operations.index(('persist', 'termination.json')))
            close.assert_any_call(9)
        if failure != 'audit-terminal':
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(events[-1]['kind'], 'CLOSED')
            self.assertFalse(events[-1]['treeEmpty'])
            self.assertFalse(events[-1]['evidenceComplete'])

    def test_original_pidfd_failure_attack_aborts_barrier_and_reaps(self):
        self.exercise('pidfd')

    def test_original_process_evidence_failure_attack_aborts_barrier_and_reaps(self):
        self.exercise('process-evidence')

    def test_pidfd_failure_and_wait_timeout_keeps_barrier_closed_without_signals(self):
        self.exercise('pidfd-timeout')

    def test_failure_between_popen_and_pidfd_aborts_and_waits(self):
        self.exercise('read-close')

    def test_unknown_identity_never_releases_workload(self):
        self.exercise('identity')

    def test_terminal_evidence_failure_cannot_skip_wait(self):
        self.exercise('terminal-evidence')

    def test_wait_error_is_unverified_without_workload_release(self):
        self.exercise('wait-error')

    def test_wait_timeout_uses_acquired_pidfd_and_stays_unverified(self):
        self.exercise('wait-timeout')

    def test_signal_error_does_not_fall_back_to_numeric_pid(self):
        self.exercise('signal-error')

    def test_early_child_exit_prevents_release(self):
        self.exercise('early-exit')

    def test_pid_reuse_identity_drift_prevents_release(self):
        self.exercise('identity-drift')

    def test_failure_after_release_terminates_and_reaps_owned_child(self):
        self.exercise('after-release')

    def test_terminal_audit_failure_still_aborts_and_waits(self):
        self.exercise('audit-terminal')

    def test_eof_cancel_partial_or_timeout_does_not_exec_workload(self):
        for control in (b'', b'CANCEL\n', b'G', b'FORCE\n'):
            with self.subTest(control=control), patch.object(supervisor, 'read_sealed_program'), patch.object(supervisor.time, 'monotonic', return_value=0), patch.object(supervisor.select, 'select', return_value=([20], [], [])), patch.object(supervisor.os, 'read', return_value=control), patch.object(supervisor.os, 'close') as close, patch.object(supervisor.os, 'execve') as execute:
                with self.assertRaises(RuntimeError):
                    supervisor.prelaunch(20, 9, request(), 1)
                close.assert_called_once_with(20)
                execute.assert_not_called()
        with patch.object(supervisor.time, 'monotonic', return_value=2), patch.object(supervisor.os, 'read') as read:
            with self.assertRaises(RuntimeError):
                supervisor.await_prelaunch(20, 1)
            read.assert_not_called()

    def test_only_explicit_python_to_bwrap_exec_transition_can_be_signalled(self):
        child = Mock(pid=123)
        child.poll.return_value = None
        with patch.object(supervisor, 'process_identity', return_value=(123, '10', '/usr/bin/bwrap')), patch.object(supervisor.signal, 'pidfd_send_signal') as signal, patch.object(supervisor.os, 'kill', side_effect=AssertionError('Numeric kill forbidden')):
            supervisor.terminate_owned_child(child, 8, (123, '10', '/usr/bin/python3'), ('/usr/bin/bwrap',))
            signal.assert_called_once_with(8, supervisor.signal.SIGTERM)
            child.wait.assert_called_once_with(timeout=2)

    def test_allowed_exec_path_does_not_hide_reused_pid_or_foreign_image(self):
        child = Mock(pid=123)
        child.poll.return_value = None
        for actual in ((123, '11', '/usr/bin/bwrap'), (123, '10', '/usr/bin/foreign')):
            with patch.object(supervisor, 'process_identity', return_value=actual), patch.object(supervisor.signal, 'pidfd_send_signal') as signal:
                with self.assertRaises(RuntimeError):
                    supervisor.terminate_owned_child(child, 8, (123, '10', '/usr/bin/python3'), ('/usr/bin/bwrap',))
                signal.assert_not_called()

    def test_invalid_command_closes_prelaunch_reader_without_exec(self):
        invalid = {**request(), 'probe': '/bin/sh'}
        with patch.object(supervisor.os, 'close') as close, patch.object(supervisor.os, 'execve') as execute:
            with self.assertRaises(RuntimeError):
                supervisor.prelaunch(20, 9, invalid, 1)
            close.assert_called_once_with(20)
            execute.assert_not_called()

    def test_prelaunch_requires_sealed_program_and_closes_on_failure(self):
        with patch.object(supervisor, 'read_sealed_program', side_effect=RuntimeError('No seals')), patch.object(supervisor.os, 'close') as close, patch.object(supervisor.os, 'execve') as execute:
            with self.assertRaises(RuntimeError):
                supervisor.prelaunch(20, 9, request(), 1)
            close.assert_called_once_with(20)
            execute.assert_not_called()

    def test_successful_prelaunch_closes_control_before_fixed_exec(self):
        calls = []
        with patch.object(supervisor, 'read_sealed_program'), patch.object(supervisor.time, 'monotonic', return_value=0), patch.object(supervisor.select, 'select', return_value=([20], [], [])), patch.object(supervisor.os, 'read', return_value=b'GO\n'), patch.object(supervisor.os, 'close', side_effect=lambda fd: calls.append(('close', fd))), patch.object(supervisor.os, 'set_inheritable'), patch.object(supervisor.os, 'lseek') as seek, patch.object(supervisor.os, 'execve', side_effect=lambda *_: calls.append(('exec',))) as execute:
            supervisor.prelaunch(20, 9, request(), 1)
        self.assertEqual(calls, [('close', 20), ('exec',)])
        seek.assert_called_once_with(3, 0, supervisor.os.SEEK_SET)
        self.assertEqual(execute.call_args.args[0], '/usr/bin/bwrap')


if __name__ == '__main__':
    unittest.main()
