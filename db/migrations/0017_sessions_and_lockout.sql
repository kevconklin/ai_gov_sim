-- A session that outlives its account is a hole: the cookie used to carry the role for twelve hours
-- whatever happened to the account. Now every request looks the account up, and a version on the
-- account, bumped by a password change or a disable, cuts off every session issued before it.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

-- Failed sign-ins, by email and by address, so a credential-stuffing run hits a wall.
CREATE TABLE login_failures (
    failure_id  TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    address     TEXT NOT NULL,
    failed_at   TEXT NOT NULL
);
CREATE INDEX login_failures_email ON login_failures(email, failed_at);
CREATE INDEX login_failures_address ON login_failures(address, failed_at);
