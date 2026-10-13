-- Configuration a customer controls, and the record of every change to it.

-- More of what the committee is told about the organisation it serves.
ALTER TABLE org_profiles ADD COLUMN framework TEXT;         -- nist_ai_rmf | iso_42001 | eu_ai_act | sr_11_7 | none
ALTER TABLE org_profiles ADD COLUMN business_goals TEXT;
ALTER TABLE org_profiles ADD COLUMN ai_landscape TEXT;      -- what is happening around the organisation
ALTER TABLE org_profiles ADD COLUMN ai_tools TEXT;          -- AI already in use

-- Governing documents the committee can read: acceptable use policies, charters, standards.
-- Retired rather than deleted, so a review held last year can still be read against what applied then.
CREATE TABLE documents (
    document_id     TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    kind            TEXT NOT NULL,              -- acceptable_use | charter | policy | standard | regulation | other
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    added_by        TEXT NOT NULL,
    added_at        TEXT NOT NULL,
    retired_at      TEXT
);

-- Append-only. One row per field changed, with what it was and what it became. Nothing here is
-- ever updated or deleted: a configuration nobody can trace is a committee nobody can defend.
CREATE TABLE config_changes (
    change_id       TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    changed_at      TEXT NOT NULL,              -- real timestamp; this is an audit record
    actor           TEXT NOT NULL,
    source          TEXT NOT NULL,              -- dashboard_session | cli_asserted | system
    area            TEXT NOT NULL,              -- workspace | profile | brief | panel | document | budget
    target          TEXT NOT NULL,              -- the field, seat, kind or document changed
    before_value    TEXT,
    after_value     TEXT,
    reason          TEXT NOT NULL
);

CREATE INDEX config_changes_run ON config_changes (run_id, changed_at);
