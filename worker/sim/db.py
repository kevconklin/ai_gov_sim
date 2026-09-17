"""Data layer. SQLite locally; the same schema runs on Postgres for the hosted pilot (M10)."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
_MIGRATION_NAME = re.compile(r"^\d{4}_[a-z0-9_]+\.sql$")


def utc_now_iso() -> str:
    """Real wall-clock timestamp for logs. Never put this in agent-facing text."""
    return datetime.now(timezone.utc).isoformat()


def _check_identifier(name: str) -> str:
    if not _IDENTIFIER.match(name):
        raise ValueError(f"unsafe SQL identifier: {name!r}")
    return name


def _to_db_value(value: Any) -> Any:
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, sort_keys=True, default=str)
    return value


class Database:
    """SQLite-backed data layer. PostgresDatabase (below) exposes the same interface for the hosted deployment."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._conn = connection

    @staticmethod
    def connect(target: str | Path) -> "Database":
        """A postgres:// URL opens Postgres; anything else is a SQLite file path."""
        text = str(target)
        if text.startswith(("postgres://", "postgresql://")):
            return PostgresDatabase.connect_postgres(text)
        return Database.connect_sqlite(text.removeprefix("sqlite:///").removeprefix("file:"))

    @classmethod
    def connect_sqlite(cls, path: Path | str) -> "Database":
        conn = sqlite3.connect(str(path), isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return cls(conn)

    def close(self) -> None:
        self._conn.close()

    @staticmethod
    def loads(text: str | None) -> Any:
        return None if text is None else json.loads(text)

    def migrate(self, migrations_dir: Path) -> list[str]:
        """Apply unapplied *.sql files in name order. Returns the names applied."""
        migrations_dir = Path(migrations_dir)
        if not migrations_dir.is_dir():
            raise FileNotFoundError(f"migrations directory not found: {migrations_dir}")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        done = {r["name"] for r in self.fetch_all("SELECT name FROM schema_migrations")}
        applied = []
        for path in sorted(migrations_dir.glob("*.sql")):
            if path.name in done:
                continue
            if not _MIGRATION_NAME.match(path.name):
                raise ValueError(f"migration file name must look like 0001_name.sql: {path.name}")
            script = f"BEGIN;\n{path.read_text()}\nINSERT INTO schema_migrations VALUES ('{path.name}', '{utc_now_iso()}');\nCOMMIT;"
            try:
                self._conn.executescript(script)
            except sqlite3.Error:
                if self._conn.in_transaction:
                    self._conn.execute("ROLLBACK")
                raise
            applied.append(path.name)
        return applied

    def insert(self, table: str, row: Mapping[str, Any]) -> None:
        if not row:
            raise ValueError("cannot insert an empty row")
        columns = [_check_identifier(c) for c in row]
        placeholders = ", ".join("?" for _ in columns)
        sql = f"INSERT INTO {_check_identifier(table)} ({', '.join(columns)}) VALUES ({placeholders})"
        self._conn.execute(sql, [_to_db_value(v) for v in row.values()])

    def update(self, table: str, values: Mapping[str, Any], *, where: Mapping[str, Any]) -> int:
        if not values or not where:
            raise ValueError("update requires both values and a where clause")
        set_sql = ", ".join(f"{_check_identifier(c)} = ?" for c in values)
        where_sql = " AND ".join(f"{_check_identifier(c)} = ?" for c in where)
        sql = f"UPDATE {_check_identifier(table)} SET {set_sql} WHERE {where_sql}"
        params = [_to_db_value(v) for v in values.values()] + [_to_db_value(v) for v in where.values()]
        return self._conn.execute(sql, params).rowcount

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Run a parameterized statement with no result rows. Returns the affected row count."""
        return self._conn.execute(sql, [_to_db_value(v) for v in params]).rowcount

    def upsert(self, table: str, row: Mapping[str, Any], *, key: Sequence[str]) -> None:
        columns = [_check_identifier(c) for c in row]
        conflict = ", ".join(_check_identifier(k) for k in key)
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c not in key)
        sql = (f"INSERT INTO {_check_identifier(table)} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) "
               f"ON CONFLICT ({conflict}) DO " + (f"UPDATE SET {updates}" if updates else "NOTHING"))
        self._conn.execute(sql, [_to_db_value(v) for v in row.values()])

    def fetch_all(self, sql: str, params: Sequence[Any] = ()) -> list[sqlite3.Row]:
        return self._conn.execute(sql, params).fetchall()

    def fetch_one(self, sql: str, params: Sequence[Any] = ()) -> sqlite3.Row | None:
        return self._conn.execute(sql, params).fetchone()


class PostgresDatabase(Database):
    """Same interface on psycopg 3. Placeholders are written as '?' and translated."""

    def __init__(self, connection: Any) -> None:  # noqa: D107 - psycopg connection
        self._conn = connection

    @classmethod
    def connect_postgres(cls, url: str) -> "PostgresDatabase":
        import psycopg
        from psycopg.rows import dict_row

        return cls(psycopg.connect(url, autocommit=True, row_factory=dict_row))

    @staticmethod
    def _sql(sql: str) -> str:
        return sql.replace("%", "%%").replace("?", "%s")

    def migrate(self, migrations_dir: Path) -> list[str]:
        migrations_dir = Path(migrations_dir)
        if not migrations_dir.is_dir():
            raise FileNotFoundError(f"migrations directory not found: {migrations_dir}")
        self._conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        done = {r["name"] for r in self.fetch_all("SELECT name FROM schema_migrations")}
        applied = []
        for path in sorted(migrations_dir.glob("*.sql")):
            if path.name in done:
                continue
            if not _MIGRATION_NAME.match(path.name):
                raise ValueError(f"migration file name must look like 0001_name.sql: {path.name}")
            with self._conn.transaction():
                self._conn.execute(path.read_text())
                self._conn.execute("INSERT INTO schema_migrations VALUES (%s, %s)", (path.name, utc_now_iso()))
            applied.append(path.name)
        return applied

    def insert(self, table: str, row: Mapping[str, Any]) -> None:
        if not row:
            raise ValueError("cannot insert an empty row")
        columns = [_check_identifier(c) for c in row]
        sql = f"INSERT INTO {_check_identifier(table)} ({', '.join(columns)}) VALUES ({', '.join('%s' for _ in columns)})"
        self._conn.execute(sql, [_to_db_value(v) for v in row.values()])

    def update(self, table: str, values: Mapping[str, Any], *, where: Mapping[str, Any]) -> int:
        if not values or not where:
            raise ValueError("update requires both values and a where clause")
        set_sql = ", ".join(f"{_check_identifier(c)} = %s" for c in values)
        where_sql = " AND ".join(f"{_check_identifier(c)} = %s" for c in where)
        params = [_to_db_value(v) for v in values.values()] + [_to_db_value(v) for v in where.values()]
        return self._conn.execute(f"UPDATE {_check_identifier(table)} SET {set_sql} WHERE {where_sql}", params).rowcount

    def upsert(self, table: str, row: Mapping[str, Any], *, key: Sequence[str]) -> None:
        columns = [_check_identifier(c) for c in row]
        conflict = ", ".join(_check_identifier(k) for k in key)
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c not in key)
        sql = (f"INSERT INTO {_check_identifier(table)} ({', '.join(columns)}) VALUES ({', '.join('%s' for _ in columns)}) "
               f"ON CONFLICT ({conflict}) DO " + (f"UPDATE SET {updates}" if updates else "NOTHING"))
        self._conn.execute(sql, [_to_db_value(v) for v in row.values()])

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        return self._conn.execute(self._sql(sql), [_to_db_value(v) for v in params]).rowcount

    def fetch_all(self, sql: str, params: Sequence[Any] = ()) -> list[Any]:
        return self._conn.execute(self._sql(sql), list(params)).fetchall()

    def fetch_one(self, sql: str, params: Sequence[Any] = ()) -> Any:
        return self._conn.execute(self._sql(sql), list(params)).fetchone()
