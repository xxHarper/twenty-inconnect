import hashlib
from pathlib import Path
import types
import unittest
from unittest.mock import Mock, patch


# Compile the exact fixed -c string, but never invoke its __main__ entry.
text = Path(__file__).with_name('probe-bootstrap.ts').read_text()
source = text.split('String.raw`', 1)[1].rsplit('`;', 1)[0]
bootstrap = types.ModuleType('source_only_bootstrap')
exec(compile(source, 'reviewed-inline-bootstrap', 'exec'), bootstrap.__dict__)
PROGRAM = b'# reviewed synthetic program\n'
HASH = hashlib.sha256(PROGRAM).hexdigest()


class BootstrapSourceTests(unittest.TestCase):
    def setUp(self):
        self.original = Mock(st_dev=1, st_ino=2, st_size=len(PROGRAM), st_mode=0o100600)
        self.sealed = Mock(st_dev=4, st_ino=5, st_size=len(PROGRAM), st_mode=0o100777)
        self.seals = bootstrap.fcntl.F_SEAL_WRITE | bootstrap.fcntl.F_SEAL_GROW | bootstrap.fcntl.F_SEAL_SHRINK | bootstrap.fcntl.F_SEAL_SEAL
        self.patches = []
        for obj, name, options in (
            (bootstrap.os, 'fstat', dict(side_effect=[self.original, self.sealed, self.sealed])),
            (bootstrap.os, 'pread', dict(side_effect=[PROGRAM, PROGRAM])),
            (bootstrap.os, 'memfd_create', dict(return_value=8)),
            (bootstrap.os, 'write', dict(return_value=len(PROGRAM))),
            (bootstrap.os, 'dup2', {}), (bootstrap.os, 'close', {}), (bootstrap.os, 'execve', {}),
            (bootstrap.fcntl, 'fcntl', dict(side_effect=lambda _fd, command, *_: self.seals if command == bootstrap.fcntl.F_GET_SEALS else 0)),
        ):
            replacement = patch.object(obj, name, **options)
            setattr(self, name, replacement.start())
            self.addCleanup(replacement.stop)

    def invoke(self):
        bootstrap.seal_and_exec(HASH, '1', '2', str(len(PROGRAM)))

    def test_exact_hash_identity_seals_and_executable_descriptor(self):
        self.invoke()
        self.dup2.assert_called_once_with(8, 3, inheritable=True)
        self.fcntl.assert_any_call(8, bootstrap.fcntl.F_ADD_SEALS, self.seals)
        self.execve.assert_called_once_with('/usr/bin/python3', ['/usr/bin/python3', '-I', '-S', '/proc/self/fd/3', '--supervise'], {'LANG': 'C', 'LC_ALL': 'C'})
        self.close.assert_called_once_with(8)

    def test_source_replacement_inode_is_rejected_without_memfd_or_exec(self):
        self.original.st_ino = 99
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            self.invoke()
        self.memfd_create.assert_not_called()
        self.execve.assert_not_called()

    def test_concurrent_source_modification_is_rehashed_before_exec(self):
        self.pread.side_effect = [b'x' * len(PROGRAM)]
        with self.assertRaisesRegex(RuntimeError, 'bytes changed'):
            self.invoke()
        self.execve.assert_not_called()

    def test_truncation_is_not_accepted_as_a_complete_snapshot(self):
        self.pread.side_effect = [PROGRAM[:-1]]
        with self.assertRaises(RuntimeError):
            self.invoke()
        self.execve.assert_not_called()

    def test_memfd_unavailable_never_executes_source(self):
        self.memfd_create.side_effect = OSError('Unavailable')
        with self.assertRaises(OSError):
            self.invoke()
        self.execve.assert_not_called()

    def test_unexpected_snapshot_descriptor_is_closed_without_exec(self):
        self.memfd_create.return_value = 2
        with self.assertRaises(RuntimeError):
            self.invoke()
        self.close.assert_called_once_with(2)
        self.execve.assert_not_called()

    def test_seal_failure_preserves_fail_closed_and_closes_owned_memfd(self):
        self.fcntl.side_effect = OSError('Seal denied')
        with self.assertRaises(OSError):
            self.invoke()
        self.close.assert_called_once_with(8)
        self.execve.assert_not_called()

    def test_missing_write_grow_shrink_or_seal_protection_prevents_exec(self):
        for flag in (bootstrap.fcntl.F_SEAL_WRITE, bootstrap.fcntl.F_SEAL_GROW, bootstrap.fcntl.F_SEAL_SHRINK, bootstrap.fcntl.F_SEAL_SEAL):
            with self.subTest(flag=flag):
                self.fstat.side_effect = [self.original, self.sealed, self.sealed]
                self.pread.side_effect = [PROGRAM, PROGRAM]
                self.execve.reset_mock()
                self.fcntl.side_effect = lambda _fd, command, *_, flag=flag: self.seals & ~flag if command == bootstrap.fcntl.F_GET_SEALS else 0
                with self.assertRaises(RuntimeError):
                    self.invoke()
                self.execve.assert_not_called()

    def test_post_seal_modification_or_truncation_is_rejected_and_closed(self):
        self.pread.side_effect = [PROGRAM, PROGRAM[:-1]]
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            self.invoke()
        self.close.assert_called_once_with(8)
        self.execve.assert_not_called()

    def test_exact_dup_descriptor_identity_is_checked_before_exec(self):
        self.fstat.side_effect = [self.original, self.sealed, self.original]
        with self.assertRaisesRegex(RuntimeError, 'descriptor differs'):
            self.invoke()
        self.execve.assert_not_called()
        self.close.assert_any_call(3)
        self.close.assert_any_call(8)

    def test_exec_failure_closes_the_authorized_duplicate(self):
        self.execve.side_effect = OSError('exec unavailable')
        with self.assertRaises(OSError):
            self.invoke()
        self.close.assert_any_call(3)
        self.close.assert_any_call(8)

    def test_partial_writes_are_completed_but_zero_progress_fails(self):
        self.write.side_effect = [1, 0]
        with self.assertRaisesRegex(RuntimeError, 'Incomplete'):
            self.invoke()
        self.close.assert_called_once_with(8)
        self.execve.assert_not_called()


if __name__ == '__main__':
    unittest.main()
