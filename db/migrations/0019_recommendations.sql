-- What the committee recommends a person do, beyond approve or reject: who should own a thing,
-- the conditions an approval should carry, a document the organization lacks (drafted), a
-- change of policy wording, a follow-up with a date. Recommendations are advice on the record;
-- nothing here applies on its own. A person adds the document, proposes the wording, names the owner.
CREATE TABLE recommendations (
    rec_id      TEXT PRIMARY KEY,               -- <run_id>/rec/...
    run_id      TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id  TEXT NOT NULL REFERENCES meetings(meeting_id),
    item_id     TEXT NOT NULL,                  -- the agenda item's short id, such as IT-001
    agent_id    TEXT NOT NULL REFERENCES agents(agent_id),
    kind        TEXT NOT NULL,                  -- owner | condition | document | policy_wording | follow_up
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    due         TEXT,                           -- for a follow-up: when, in the adviser's words
    created_at  TEXT NOT NULL
);
CREATE INDEX recommendations_meeting ON recommendations(meeting_id, item_id);
