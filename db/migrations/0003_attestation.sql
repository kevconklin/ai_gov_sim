-- Human attestations. No decision applies without a row here: apply_attested() refuses.
-- The rationale is the attester's own words; the platform never drafts it, because a
-- machine-authored attestation is discoverable evidence that oversight was a formality.

CREATE TABLE attestations (
    attestation_id  TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    decision_id     TEXT NOT NULL REFERENCES decisions(decision_id),
    actor           TEXT NOT NULL,              -- the accountable human
    outcome         TEXT NOT NULL,              -- approved | rejected | deferred
    rationale       TEXT NOT NULL,
    responded_to    TEXT NOT NULL,              -- json list of dissenting agent_ids answered
    created_at      TEXT NOT NULL               -- real timestamp; this is an audit record
);

CREATE UNIQUE INDEX attestations_decision ON attestations (decision_id);
