-- Every typed decision asked of the fast decision model (Jev): the state it saw, the questions, the
-- calibrated answers, and what the code then did. A gate routes or flags; it never decides a matter,
-- and a person can read every call here. classifier_calls keeps the debate gate's own summary rows.
CREATE TABLE gate_calls (
    call_id      TEXT PRIMARY KEY,              -- <run_id>/jev/...
    run_id       TEXT NOT NULL REFERENCES runs(run_id),
    purpose      TEXT NOT NULL,                 -- intake_triage | debate_outcome | ...
    item_id      TEXT,                          -- the matter it was about, when one
    meeting_id   TEXT,
    model        TEXT NOT NULL,
    state        TEXT NOT NULL,                 -- json, as sent (cut to a size)
    questions    TEXT NOT NULL,                 -- json map of typed questions
    answers      TEXT,                          -- json map of typed answers with probabilities and confidence
    acted        TEXT,                          -- json: what the code did with the answers
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd     DOUBLE PRECISION NOT NULL DEFAULT 0,
    latency_ms   INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL,                 -- ok | unavailable
    error        TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX gate_calls_run ON gate_calls(run_id, created_at);
CREATE INDEX gate_calls_item ON gate_calls(item_id);
