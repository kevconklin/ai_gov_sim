"""Per-run file lock, so two worker processes never advance the same run at once.

Overlapping workers corrupt a month: one process's rollback deletes rows the other is still writing.
The lock is held only while a month runs and is released by the OS if the process dies.
For several hosts sharing one database, add a database lease as well (see deploy/README.md).
"""

from __future__ import annotations

import errno
import fcntl
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class RunLocked(RuntimeError):
    """Another process is advancing this run."""


@contextmanager
def run_lock(data_dir: Path, run_id: str) -> Iterator[None]:
    path = Path(data_dir) / "locks" / f"{run_id}.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN):
                holder = os.read(handle, 32).decode(errors="replace").strip() or "unknown pid"
                raise RunLocked(f"another worker is advancing {run_id} (pid {holder})") from error
            raise
        os.truncate(handle, 0)
        os.write(handle, str(os.getpid()).encode())
        os.fsync(handle)
        yield
    finally:
        try:
            fcntl.flock(handle, fcntl.LOCK_UN)
        finally:
            os.close(handle)
