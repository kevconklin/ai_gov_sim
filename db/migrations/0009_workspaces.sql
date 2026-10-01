-- A workspace is a run with a real organisation behind it instead of a fictional bank.
-- The profile is what committee members are told about who they serve. The simulation needs no
-- row here: it builds the same profile from its fictional world and hands it over the same way.

CREATE TABLE org_profiles (
    run_id          TEXT PRIMARY KEY REFERENCES runs(run_id),
    name            TEXT NOT NULL,
    facts           TEXT NOT NULL,              -- a few lines about the organisation
    risk_appetite   TEXT NOT NULL,              -- the board's direction on AI, in its own words
    seats           TEXT NOT NULL,              -- json list: speaking order
    chair_seat      TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

-- The committee as data. When set, this text is the member's brief and the persona file is unused.
ALTER TABLE agents ADD COLUMN persona_text TEXT;
