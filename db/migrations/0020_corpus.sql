-- The corpus: the organization's governing documents, versioned, and the revisions the committee
-- proposes to them. A revision is a draft attached to a matter; it applies, as a new version that
-- supersedes the old, only when a person signs that matter approved. The committee never writes
-- directly; the signature is the pen.
ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN supersedes TEXT;          -- the document_id this version replaced

CREATE TABLE document_revisions (
    rev_id      TEXT PRIMARY KEY,               -- <run_id>/rev/...
    run_id      TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id  TEXT NOT NULL REFERENCES meetings(meeting_id),
    item_id     TEXT NOT NULL,                  -- the agenda item's short id the revision rides on
    agent_id    TEXT NOT NULL REFERENCES agents(agent_id),
    target      TEXT NOT NULL,                  -- 'policy' for the AI policy, else 'document'
    document_id TEXT,                           -- the document being revised; NULL for a new one
    kind        TEXT,                           -- for a new document
    title       TEXT NOT NULL,                  -- the document's title, or the policy section
    body        TEXT NOT NULL,                  -- the full new text (document) or the section's text (policy)
    rationale   TEXT NOT NULL,
    mode        TEXT,                           -- policy only: add (to the section) | replace (the section)
    status      TEXT NOT NULL,                  -- proposed | applied | dropped
    applied_as  TEXT,                           -- the new document_id, or the policy commit
    created_at  TEXT NOT NULL
);
CREATE INDEX document_revisions_item ON document_revisions(meeting_id, item_id);
