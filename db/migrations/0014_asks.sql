-- A question asked of the policy, and what the policy said back. Every ask is kept: the ones the
-- policy could not answer are what the committee needs to hear next, and the ones it could are
-- the evidence that people are reading it.
CREATE TABLE asks (
    ask_id      TEXT PRIMARY KEY,               -- <run_id>/ask/...
    run_id      TEXT NOT NULL REFERENCES runs(run_id),
    asked_by    TEXT NOT NULL,
    asked_at    TEXT NOT NULL,                  -- the real date, ISO
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    covered     BOOLEAN NOT NULL,               -- the policy settled it, with at least one real control cited
    controls    TEXT NOT NULL,                  -- json list of AI-GOV ids cited, all present in the policy
    call_id     TEXT,                           -- the llm_calls row that produced the answer
    item_id     TEXT REFERENCES items(item_id), -- set once it has been sent to the committee as a question
    created_at  TEXT NOT NULL
);
CREATE INDEX asks_run ON asks(run_id, created_at);
