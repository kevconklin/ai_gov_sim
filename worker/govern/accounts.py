"""Accounts and memberships, the worker's half.

The dashboard creates users (it holds the sign-in form); the worker records who may do what in an
organization, because that is customer configuration and belongs on the change record. Password
hashes are scrypt in a format both sides read, so the CLI can make the first operator account on
a machine with no dashboard yet.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from typing import Any

from govern import ids
from govern.db import Database, utc_now_iso

ROLES = ("runs", "decides", "asks")          # what a member may do in one organization, most to least
GLOBAL_ROLES = ("operator", "member")        # an operator runs the service and sees every organization
SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LEN = 16384, 8, 1, 32
MIN_PASSWORD = 12
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AccountError(ValueError):
    """The account or membership change cannot be made as asked."""


def hash_password(password: str) -> str:
    if len(password) < MIN_PASSWORD:
        raise AccountError(f"a password needs at least {MIN_PASSWORD} characters")
    salt = os.urandom(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=KEY_LEN)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, key = stored.split("$")
        if algo != "scrypt":
            return False
        want = base64.b64decode(key)
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(want))
        return hmac.compare_digest(got, want)
    except (ValueError, TypeError):
        return False


def create_user(db: Database, *, email: str, name: str, password: str, role: str = "member",
                created_by: str | None = None, must_change: bool = False) -> str:
    email = email.strip().lower()
    if not _EMAIL.match(email):
        raise AccountError("an account needs a real email address")
    if len(name.strip()) < 2:
        raise AccountError("an account needs the person's name")
    if role not in GLOBAL_ROLES:
        raise AccountError(f"role must be one of {', '.join(GLOBAL_ROLES)}")
    if db.fetch_one("SELECT 1 FROM users WHERE email = ?", (email,)):
        raise AccountError(f"{email} already has an account")
    user_id = ids.global_id()
    db.insert("users", {"user_id": user_id, "email": email, "name": name.strip(), "password_hash": hash_password(password),
                        "role": role, "must_change": must_change, "disabled_at": None, "created_at": utc_now_iso(),
                        "created_by": created_by})
    return user_id


def user_by_email(db: Database, email: str) -> Any:
    return db.fetch_one("SELECT * FROM users WHERE email = ?", (email.strip().lower(),))


def set_member(db: Database, run_id: str, *, user_id: str, role: str, actor: str, reason: str,
               source: str = "cli_asserted") -> str:
    """Give a person a role in one organization, or change it. On the change record like any setting."""
    from govern.settings import _reason, record_change
    why = _reason(reason)
    if role not in ROLES:
        raise AccountError(f"role must be one of {', '.join(ROLES)}")
    user = db.fetch_one("SELECT user_id, email, name, disabled_at FROM users WHERE user_id = ?", (user_id,))
    if user is None or user["disabled_at"]:
        raise AccountError("that account does not exist or is disabled")
    if db.fetch_one("SELECT 1 FROM runs WHERE run_id = ? AND condition = 'workspace'", (run_id,)) is None:
        raise AccountError(f"{run_id} is not an organization")
    current = db.fetch_one("SELECT membership_id, role, removed_at FROM memberships WHERE run_id = ? AND user_id = ?", (run_id, user_id))
    before = current["role"] if current and not current["removed_at"] else None
    if before == role:
        return current["membership_id"]
    if current:
        db.update("memberships", {"role": role, "removed_at": None, "added_by": actor, "added_at": utc_now_iso()},
                  where={"membership_id": current["membership_id"]})
        membership_id = current["membership_id"]
    else:
        membership_id = ids.unique(run_id, "member")
        db.insert("memberships", {"membership_id": membership_id, "run_id": run_id, "user_id": user_id, "role": role,
                                  "added_by": actor, "added_at": utc_now_iso(), "removed_at": None})
    record_change(db, run_id, actor=actor, source=source, area="people", target=f"{user['name']} <{user['email']}>",
                  before=before, after=role, reason=why)
    return membership_id


def remove_member(db: Database, run_id: str, *, user_id: str, actor: str, reason: str, source: str = "cli_asserted") -> None:
    from govern.settings import _reason, record_change
    why = _reason(reason)
    current = db.fetch_one("SELECT m.membership_id, m.role, u.name, u.email FROM memberships m JOIN users u ON u.user_id = m.user_id "
                           "WHERE m.run_id = ? AND m.user_id = ? AND m.removed_at IS NULL", (run_id, user_id))
    if current is None:
        raise AccountError("that person is not a member of this organization")
    db.update("memberships", {"removed_at": utc_now_iso()}, where={"membership_id": current["membership_id"]})
    record_change(db, run_id, actor=actor, source=source, area="people", target=f"{current['name']} <{current['email']}>",
                  before=current["role"], after=None, reason=why)


def members(db: Database, run_id: str) -> list[Any]:
    return db.fetch_all("SELECT m.membership_id, m.role, m.added_by, m.added_at, u.user_id, u.email, u.name FROM memberships m "
                        "JOIN users u ON u.user_id = m.user_id WHERE m.run_id = ? AND m.removed_at IS NULL ORDER BY u.name", (run_id,))


def reset_password(db: Database, *, email: str, password: str) -> None:
    """A new temporary password. Every session the account had ends; the person must change it at sign-in."""
    user = user_by_email(db, email)
    if user is None:
        raise AccountError(f"no account for {email}")
    db.update("users", {"password_hash": hash_password(password), "must_change": True,
                        "session_version": int(user["session_version"] or 0) + 1}, where={"user_id": user["user_id"]})


def set_disabled(db: Database, *, email: str, disabled: bool) -> None:
    user = user_by_email(db, email)
    if user is None:
        raise AccountError(f"no account for {email}")
    db.update("users", {"disabled_at": utc_now_iso() if disabled else None,
                        "session_version": int(user["session_version"] or 0) + 1}, where={"user_id": user["user_id"]})
