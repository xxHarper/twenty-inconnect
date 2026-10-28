// Fixed code in the existing controller process, never a manifest-selected helper.
// Only a sealed, rehashed memfd becomes executable Python source.
export const probeBootstrap = String.raw`
import fcntl
import hashlib
import os
import re
import stat
import sys


def seal_and_exec(expected_hash, device, inode, size):
    if not re.fullmatch('[a-f0-9]{64}', expected_hash):
        raise RuntimeError('Invalid reviewed hash')
    if not all(re.fullmatch('[0-9]{1,20}', item) for item in (device, inode, size)):
        raise RuntimeError('Invalid source identity')
    expected = (int(device), int(inode), int(size))
    actual = os.fstat(3)
    if not stat.S_ISREG(actual.st_mode) or (actual.st_dev, actual.st_ino, actual.st_size) != expected or not 0 < actual.st_size <= 131072:
        raise RuntimeError('Source descriptor identity changed')
    program = os.pread(3, actual.st_size + 1, 0)
    if len(program) != actual.st_size or hashlib.sha256(program).hexdigest() != expected_hash:
        raise RuntimeError('Source bytes changed')
    sealed = os.memfd_create('inconnect-probe', os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
    replaced = False
    try:
        if sealed <= 3:
            raise RuntimeError('Unexpected snapshot descriptor')
        offset = 0
        while offset < len(program):
            written = os.write(sealed, program[offset:])
            if written <= 0:
                raise RuntimeError('Incomplete snapshot write')
            offset += written
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        fcntl.fcntl(sealed, fcntl.F_ADD_SEALS, seals)
        if fcntl.fcntl(sealed, fcntl.F_GET_SEALS) & seals != seals:
            raise RuntimeError('Snapshot seals missing')
        captured = os.fstat(sealed)
        data = os.pread(sealed, len(program) + 1, 0)
        if not stat.S_ISREG(captured.st_mode) or captured.st_size != len(program) or data != program or hashlib.sha256(data).hexdigest() != expected_hash:
            raise RuntimeError('Sealed snapshot differs')
        os.dup2(sealed, 3, inheritable=True)
        replaced = True
        pinned = os.fstat(3)
        if (pinned.st_dev, pinned.st_ino, pinned.st_size) != (captured.st_dev, captured.st_ino, captured.st_size) or fcntl.fcntl(3, fcntl.F_GET_SEALS) & seals != seals:
            raise RuntimeError('Executable descriptor differs')
        owned, sealed = sealed, None
        os.close(owned)
        os.execve('/usr/bin/python3', ['/usr/bin/python3', '-I', '-S', '/proc/self/fd/3', '--supervise'], {'LANG': 'C', 'LC_ALL': 'C'})
    except BaseException:
        if replaced:
            os.close(3)
        raise
    finally:
        if sealed is not None:
            os.close(sealed)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise RuntimeError('Invalid bootstrap arguments')
    seal_and_exec(*sys.argv[1:])
`;
