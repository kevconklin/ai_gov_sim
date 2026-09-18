"""Per-run lock, so two workers never advance the same run at once.

Overlapping workers corrupt a month: one process's rollback deletes rows the other is still
writing. The lock is held only while a month runs.

Two backends, chosen by what the run's database can do:

- **Postgres advisory lease.** Held on the worker's own connection, so it spans hosts and is
  released by the server the moment that connection drops. This is what makes more than one
  pod safe.
- **File lock.** A `flock` in the data directory, released by the OS if the process dies. It
  only covers one host, which is all SQLite ever spans anyway.
"""

from __future__ import annotations

import errno
import fcntl
import hashlib
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class RunLocked(RuntimeError):
    """Another process is advancing this run."""


def advisory_key(run_id: str) -> int:
    """A stable signed 64-bit key for one run.

    Hashed here rather than with Postgres `hashtext()`, which carries no promise of stability
    across server versions: a key that changed under an upgrade would silently stop excluding.
    """
    return int.from_bytes(hashlib.blake2b(run_id.encode(), digest_size=8).digest(), "big", signed=True)


# Advisory locks are re-entrant within one Postgres session, so the same process could take a
# run twice and believe it held it exclusively. A run is not re-entrant; this keeps it honest.
_HELD: set[tuple[int, int]] = set()


@contextmanager
def _database_lease(db: Any, run_id: str) -> Iterator[None]:
    key = advisory_key(run_id)
    mine = (id(db), key)
    if mine in _HELD:
        raise RunLocked(f"this worker already holds {run_id}")
    if not db.try_advisory_lock(key):
        raise RunLocked(f"another worker is advancing {run_id} (database lease held elsewhere)")
    _HELD.add(mine)
    try:
        yield
    finally:
        _HELD.discard(mine)
        try:
            db.advisory_unlock(key)
        except Exception:  # noqa: BLE001 - a dropped connection has already released it
            pass


@contextmanager
def _file_lock(data_dir: Path, run_id: str) -> Iterator[None]:
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


@contextmanager
def run_lock(data_dir: Path, run_id: str, *, db: Any = None) -> Iterator[None]:
    """Hold one run for the duration of a month, across hosts where the database allows it."""
    if db is not None and getattr(db, "advisory_locks", False):
        with _database_lease(db, run_id):
            yield
    else:
        with _file_lock(data_dir, run_id):
            yield
