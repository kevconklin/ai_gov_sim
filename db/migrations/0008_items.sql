-- Intake. Every AI matter an organisation wants reviewed arrives here: a use case, a tool, a
-- vendor, a change to policy, an exception to it, an incident, or a question. Until this table
-- existed there was no way in; the only items a committee could take were ones its own members
-- proposed inside a meeting, which is a simulation's shape, not a governance function's.

CREATE TABLE items (
    item_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    kind            TEXT NOT NULL,              -- use_case | tool | vendor | policy_change | exception | incident | question
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    details         TEXT NOT NULL,              -- json, free-form facts from the submitter
    risk_tier       TEXT,                       -- low | medium | high, as submitted or triaged
    status          TEXT NOT NULL,              -- submitted | in_review | recommended | approved | rejected | withdrawn
    submitted_by    TEXT NOT NULL,
    submitted_on    TEXT NOT NULL,              -- YYYY-MM-DD
    decided_on      TEXT
);

CREATE INDEX items_open ON items (run_id, status);
