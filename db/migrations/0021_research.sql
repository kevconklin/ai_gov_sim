-- A seat can hold capabilities beyond the shared tools. The first is research: a seat that may
-- search the web and read a page, through the worker, with everything it reads fenced as evidence.
ALTER TABLE agents ADD COLUMN capabilities TEXT;      -- JSON list, such as ["research"]; NULL means none

-- Every search and page read a seat makes, so the record shows what the committee looked at and
-- what it cost. The seat sees only what is logged here, fenced; nothing reaches it unlogged.
CREATE TABLE research_calls (
    research_id TEXT PRIMARY KEY,               -- <run_id>/research/...
    run_id      TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id  TEXT NOT NULL,
    item_id     TEXT,                           -- the agenda item it was for, when the seat said
    agent_id    TEXT NOT NULL REFERENCES agents(agent_id),
    kind        TEXT NOT NULL,                  -- search | page
    query       TEXT,                           -- the search, in the seat's words
    url         TEXT,                           -- the page read
    results     TEXT,                           -- JSON: sources found, or the page's title and length
    summary     TEXT,                           -- what the seat was given (before fencing)
    status      TEXT NOT NULL,                  -- ok | refused | failed
    cost_usd    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX research_calls_meeting ON research_calls(meeting_id, item_id);
