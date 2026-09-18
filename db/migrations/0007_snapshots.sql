-- Rollback snapshots, taken before a month runs and cleared when it completes.
--
-- These used to be files under SIM_DATA_DIR. A worker that dies mid-month is recovered by
-- reading its snapshot back, so on a scheduler that can move a pod to another node the file
-- was exactly the wrong place for it: the replacement pod would find no snapshot and leave a
-- half-written month in place. In the database it travels with the run.
--
-- Deliberately not in RUN_TABLES: a rollback deletes every run-scoped row, and deleting the
-- snapshot while restoring from it would leave nothing to restore.

CREATE TABLE run_snapshots (
    run_id      TEXT NOT NULL REFERENCES runs(run_id),
    sim_month   TEXT NOT NULL,
    payload     TEXT NOT NULL,              -- json dump of every run-scoped row
    created_at  TEXT NOT NULL,
    PRIMARY KEY (run_id, sim_month)
);
