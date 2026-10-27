import importlib.util
import io
import json
from pathlib import Path
import signal
import subprocess
import unittest
from unittest.mock import Mock, call, patch


# Import defines functions only; the __main__ branch never runs in these tests.
specification = importlib.util.spec_from_file_location('lead_probe_under_test', Path(__file__).with_name('probe-supervisor.py'))
supervisor = importlib.util.module_from_spec(specification)
specification.loader.exec_module(supervisor)
RUN_ID = '10000000-0000-4000-8000-000000000001'
BOOT_ID = '20000000-0000-4000-8000-000000000001'


class ProbeSupervisorSourceTests(unittest.TestCase):
    def setUp(self):
        self.spawn_patch = patch.object(supervisor.subprocess, 'Popen', side_effect=AssertionError('Real process forbidden'))
        self.spawn = self.spawn_patch.start()
        self.addCleanup(self.spawn_patch.stop)
        self.signal_patch = patch.object(supervisor.signal, 'pidfd_send_signal')
        self.pidfd_signal = self.signal_patch.start()
        self.addCleanup(self.signal_patch.stop)
        self.kill_patch = patch.object(supervisor.os, 'kill', side_effect=AssertionError('Numeric PID signal forbidden'))
        self.kill = self.kill_patch.start()
        self.addCleanup(self.kill_patch.stop)

    def test_exact_namespace_and_command_arguments(self):
        actual = supervisor.build_bwrap_arguments(9, {'runId': RUN_ID, 'probe': 'BOUNDARY'})
        self.assertEqual(actual, [
            '/usr/bin/bwrap', '--unshare-user', '--unshare-net', '--unshare-pid',
            '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session', '--clearenv',
            '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
            '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
            '--dir', '/var', '--dir', '/var/run', '--ro-bind', '/proc/self/fd/9', '/lm',
            '--setenv', 'LANG', 'C', '--setenv', 'LC_ALL', 'C', '--setenv', 'HOME', '/lm/home',
            '--setenv', 'LM_PROBE_RUN_ID', RUN_ID,
            '--', '/usr/bin/python3', '-I', '-S', '/lm/probe.py', '--payload', 'BOUNDARY', RUN_ID])
        self.spawn.assert_not_called()

    def test_unknown_program_paths_and_interpolation_are_rejected(self):
        for request in ({'runId': RUN_ID, 'probe': '/bin/sh'}, {'runId': '$(foreign)', 'probe': 'BOUNDARY'}):
            with self.assertRaises(RuntimeError):
                supervisor.build_bwrap_arguments(9, request)
        with self.assertRaises(RuntimeError):
            supervisor.build_bwrap_arguments(0, {'runId': RUN_ID, 'probe': 'BOUNDARY'})

    def test_term_uses_owned_pidfd_and_never_numeric_pid(self):
        child = Mock(pid=100)
        child.poll.return_value = None
        with patch.object(supervisor, 'process_identity', return_value=(100, '10', '/usr/bin/bwrap')):
            supervisor.terminate_owned_child(child, 8, (100, '10', '/usr/bin/bwrap'))
        self.pidfd_signal.assert_called_once_with(8, signal.SIGTERM)
        child.wait.assert_called_once_with(timeout=2)
        self.kill.assert_not_called()

    def test_kill_escalation_uses_same_pinned_descriptor(self):
        child = Mock(pid=100)
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired('owned', 2), 0]
        with patch.object(supervisor, 'process_identity', return_value=(100, '10', '/usr/bin/bwrap')):
            supervisor.terminate_owned_child(child, 8, (100, '10', '/usr/bin/bwrap'))
        self.assertEqual(self.pidfd_signal.call_args_list, [call(8, signal.SIGTERM), call(8, signal.SIGKILL)])
        self.kill.assert_not_called()

    def test_pid_reuse_and_exec_drift_forbid_signals(self):
        child = Mock(pid=100)
        child.poll.return_value = None
        for actual in ((100, '11', '/usr/bin/bwrap'), (100, '10', '/usr/bin/foreign')):
            with patch.object(supervisor, 'process_identity', return_value=actual), self.assertRaises(RuntimeError):
                supervisor.terminate_owned_child(child, 8, (100, '10', '/usr/bin/bwrap'))
        self.pidfd_signal.assert_not_called()

    def test_missing_signal_authority_never_falls_back(self):
        child = Mock(pid=100)
        child.poll.return_value = None
        self.pidfd_signal.side_effect = PermissionError('Denied')
        with patch.object(supervisor, 'process_identity', return_value=(100, '10', '/usr/bin/bwrap')), self.assertRaises(PermissionError):
            supervisor.terminate_owned_child(child, 8, (100, '10', '/usr/bin/bwrap'))
        self.kill.assert_not_called()
        child.wait.assert_not_called()

    def test_exited_supervisor_does_not_signal_a_reused_pid(self):
        child = Mock(pid=100)
        child.poll.return_value = 0
        supervisor.terminate_owned_child(child, 8, (100, '10', '/usr/bin/bwrap'))
        self.pidfd_signal.assert_not_called()

    def test_absence_requires_complete_process_visibility(self):
        with patch.object(supervisor.os, 'listdir', return_value=['100']), patch.object(supervisor.os, 'readlink', side_effect=PermissionError()):
            self.assertFalse(supervisor.empty_namespace('pid:[10]'))
        with patch.object(supervisor.os, 'listdir', return_value=['100']), patch.object(supervisor.os, 'getuid', return_value=1000), patch.object(supervisor.os, 'stat', return_value=Mock(st_uid=1000)), patch.object(supervisor.os, 'readlink', return_value='pid:[10]'):
            self.assertFalse(supervisor.empty_namespace('pid:[10]'))

    def test_missing_pidfd_capability_prevents_acquisition_and_spawn(self):
        request = {'capability': 'PROBE_ONLY', 'probe': 'BOUNDARY', 'expectedTermination': 'NORMAL_EXIT',
                   'runId': RUN_ID, 'bootId': BOOT_ID, 'reviewedCommit': 'a' * 40, 'supervisorSha256': 'b' * 64,
                   'resourceRoot': '/tmp/inconnect-lead-phys-' + RUN_ID,
                   'deadlineSeconds': 2, 'memoryMiB': 256, 'processLimit': 32}
        with patch.object(supervisor, 'boot_id', return_value=BOOT_ID), patch.object(supervisor.os, 'pidfd_open', side_effect=OSError('Unavailable')), patch.object(supervisor.os, 'mkdir') as mkdir:
            with self.assertRaises(OSError):
                supervisor.supervise(request)
            mkdir.assert_not_called()
        self.spawn.assert_not_called()

    def test_partial_acquisition_is_preserved_without_launch(self):
        request = {'capability': 'PROBE_ONLY', 'probe': 'BOUNDARY', 'expectedTermination': 'NORMAL_EXIT',
                   'runId': RUN_ID, 'bootId': BOOT_ID, 'reviewedCommit': 'a' * 40, 'supervisorSha256': 'b' * 64,
                   'resourceRoot': '/tmp/inconnect-lead-phys-' + RUN_ID,
                   'deadlineSeconds': 2, 'memoryMiB': 256, 'processLimit': 32}
        output = io.StringIO()
        with patch.object(supervisor, 'boot_id', return_value=BOOT_ID), patch.object(supervisor.os, 'pidfd_open', return_value=8), patch.object(supervisor.os, 'close'), patch.object(supervisor.resource, 'setrlimit'), patch.object(supervisor.signal, 'signal'), patch.object(supervisor, 'snapshot', return_value={}), patch.object(supervisor.os, 'open', return_value=9), patch.object(supervisor.os, 'mkdir', side_effect=FileExistsError()), patch.object(supervisor.sys, 'stdout', output):
            supervisor.supervise(request)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([event['kind'] for event in events], ['ACQUIRING', 'PARTIAL_FAILURE', 'CLOSED'])
        self.assertFalse(events[-1]['treeEmpty'])
        self.assertFalse(events[-1]['evidenceComplete'])
        self.spawn.assert_not_called()

    def test_native_gate_denies_before_any_probe(self):
        with self.assertRaisesRegex(RuntimeError, 'BLOCKED'):
            supervisor.require_native_execution_authorization()
        self.spawn.assert_not_called()

    def test_launch_requires_durable_ack_and_missing_ack_has_no_fallback(self):
        for value in (b'', b'CANCEL\n', b'FORCE\n'):
            with patch.object(supervisor.time, 'monotonic', return_value=0), patch.object(supervisor.select, 'select', return_value=([0], [], [])), patch.object(supervisor.os, 'read', return_value=value), self.assertRaises(RuntimeError):
                supervisor.await_durable_acquisition(1)
        with patch.object(supervisor.time, 'monotonic', return_value=0), patch.object(supervisor.select, 'select', return_value=([0], [], [])), patch.object(supervisor.os, 'read', return_value=b'ACK\n'):
            supervisor.await_durable_acquisition(1)
        self.spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main()
