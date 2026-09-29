-- Real accounts. A user is a person with a password; a membership is what they may do in one
-- organization. Until now one shared password opened every organization under any typed name,
-- so nothing on the record could be attributed to a verified person.
CREATE TABLE users (
    user_id         TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,       -- lowercased
    name            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,              -- scrypt$N$r$p$salt$hash, base64; see lib/auth/password.ts and govern/accounts.py
    role            TEXT NOT NULL,              -- operator (runs the service, every organization) | member
    must_change     BOOLEAN NOT NULL DEFAULT FALSE,
    disabled_at     TEXT,
    created_at      TEXT NOT NULL,
    created_by      TEXT
);

CREATE TABLE memberships (
    membership_id   TEXT PRIMARY KEY,           -- <run_id>/member/...
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    user_id         TEXT NOT NULL REFERENCES users(user_id),
    role            TEXT NOT NULL,              -- runs | decides | asks
    added_by        TEXT NOT NULL,
    added_at        TEXT NOT NULL,
    removed_at      TEXT,
    UNIQUE (run_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);
