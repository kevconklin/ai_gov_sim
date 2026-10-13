-- A use case's life after approval: which stage it is in, who owns it, and when it is due back
-- for review. Every stage change is a row of its own, made by a person with a note.
ALTER TABLE items ADD COLUMN stage TEXT;               -- approved | building | piloting | live | paused | retired; NULL until approved
ALTER TABLE items ADD COLUMN owner TEXT;               -- the named person accountable for it
ALTER TABLE items ADD COLUMN review_due TEXT;          -- ISO date the next review is due
ALTER TABLE items ADD COLUMN stage_changed_on TEXT;

CREATE TABLE stage_changes (
    change_id       TEXT PRIMARY KEY,           -- <run_id>/stage/...
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    item_id         TEXT NOT NULL REFERENCES items(item_id),
    from_stage      TEXT,
    to_stage        TEXT NOT NULL,
    changed_by      TEXT NOT NULL,
    changed_on      TEXT NOT NULL,              -- ISO date
    note            TEXT NOT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX stage_changes_item ON stage_changes(item_id, created_at);
