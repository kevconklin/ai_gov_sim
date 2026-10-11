-- Gates: typed decisions made before an expensive step. Each call is kept with its probability, and
-- a review records whether its debate was skipped and at what confidence, so the trail can say so.
CREATE TABLE classifier_calls (
    call_id         TEXT PRIMARY KEY,           -- <run_id>/gate/...
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id      TEXT,
    purpose         TEXT NOT NULL,              -- debate_outcome | ...
    provider        TEXT NOT NULL,
    label           TEXT NOT NULL,
    probability     DOUBLE PRECISION NOT NULL,
    acted           BOOLEAN NOT NULL,           -- the gate changed what happened
    inputs          TEXT NOT NULL,              -- json summary of what it saw, never the full packet
    latency_ms      INTEGER NOT NULL,
    cost_usd        DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX classifier_calls_run ON classifier_calls(run_id, created_at);

ALTER TABLE meetings ADD COLUMN debate_skipped BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE meetings ADD COLUMN debate_skip_p DOUBLE PRECISION;
