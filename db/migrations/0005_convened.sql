-- Which meetings a human called. A scheduled meeting's decisions are applied by the ungated
-- path and never wait on an attestation; without this flag the attestation queue shows them
-- anyway, which conflates "waiting on a person" with "already handled".

ALTER TABLE meetings ADD COLUMN convened BOOLEAN NOT NULL DEFAULT FALSE;
