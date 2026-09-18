-- How the attester's identity was established. The record says a named person is accountable,
-- so the ledger should also say how that name was arrived at rather than leaving a reader to
-- assume it was verified.
--   dashboard_session  the name fixed at sign-in, carried in the signed session cookie
--   cli_asserted       supplied on the command line, not checked against anything
--   unknown            written before this column existed

ALTER TABLE attestations ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
