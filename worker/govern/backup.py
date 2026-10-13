"""Backups you have restored from, or no backups at all.

The record is the product. A backup is a consistent copy of the whole database plus the policy
repositories, written to a folder that something else carries off the machine. Restore is a
command too, and a test runs it, because a backup nobody has restored from is a hope.

SQLite: `VACUUM INTO` gives a consistent copy without stopping the worker. Postgres: `pg_dump`
custom format, restored with `pg_restore`. Policy repositories are plain git checkouts and are
copied whole.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class BackupError(RuntimeError):
    """The backup or restore did not complete; nothing partial should be trusted."""


def _stamp(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


def backup(target: str, data_dir: Path, out_dir: Path, *, now: datetime | None = None) -> dict[str, Any]:
    """Write one backup set under out_dir/<stamp>/ and return what it holds."""
    dest = Path(out_dir) / _stamp(now)
    dest.mkdir(parents=True, exist_ok=False)
    if target.startswith(("postgres://", "postgresql://")):
        dump = dest / "database.pgdump"
        result = subprocess.run(["pg_dump", "--format=custom", "--no-owner", "--file", str(dump), target], capture_output=True, text=True)
        if result.returncode != 0:
            raise BackupError(f"pg_dump failed: {result.stderr.strip()}")
        kind = "postgres"
    else:
        import sqlite3
        src = sqlite3.connect(target)
        try:
            src.execute("VACUUM INTO ?", (str(dest / "database.sqlite"),))
        finally:
            src.close()
        kind = "sqlite"
    policies = Path(data_dir) / "policies"
    if policies.is_dir():
        shutil.copytree(policies, dest / "policies", symlinks=False)
    manifest = {"kind": kind, "written_at": _stamp(now), "database": target if kind == "postgres" else os.path.basename(target),
                "policies": policies.is_dir(), "files": sorted(str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file())[:50]}
    (dest / "MANIFEST.txt").write_text("\n".join(f"{k}: {v}" for k, v in manifest.items()) + "\n")
    return {"path": str(dest), **manifest}


def restore(backup_dir: Path, target: str, data_dir: Path) -> dict[str, Any]:
    """Put a backup set back. The database at `target` must be empty or absent: this never merges."""
    src = Path(backup_dir)
    if not (src / "MANIFEST.txt").is_file():
        raise BackupError(f"{src} is not a backup set (no MANIFEST.txt)")
    if target.startswith(("postgres://", "postgresql://")):
        dump = src / "database.pgdump"
        if not dump.is_file():
            raise BackupError("this backup set holds no Postgres dump")
        result = subprocess.run(["pg_restore", "--no-owner", "--dbname", target, str(dump)], capture_output=True, text=True)
        if result.returncode != 0:
            raise BackupError(f"pg_restore failed: {result.stderr.strip()}")
    else:
        copy = src / "database.sqlite"
        if not copy.is_file():
            raise BackupError("this backup set holds no SQLite copy")
        out = Path(target)
        if out.exists() and out.stat().st_size > 0:
            raise BackupError(f"{out} already exists; restore into an empty path and swap it in yourself")
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(copy, out)
    policies_out = Path(data_dir) / "policies"
    if (src / "policies").is_dir():
        if policies_out.exists() and any(policies_out.iterdir()):
            raise BackupError(f"{policies_out} is not empty; restore into an empty data directory")
        shutil.copytree(src / "policies", policies_out, dirs_exist_ok=True)
    return {"restored_from": str(src), "database": target, "policies": (src / "policies").is_dir()}


def prune(out_dir: Path, keep: int) -> list[str]:
    """Keep the newest `keep` sets; return what was removed."""
    sets = sorted(p for p in Path(out_dir).iterdir() if p.is_dir() and (p / "MANIFEST.txt").is_file())
    gone = []
    for p in sets[:-keep] if keep > 0 else sets:
        shutil.rmtree(p)
        gone.append(str(p))
    return gone
