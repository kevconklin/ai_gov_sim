-- Agenda deferrals: one row per time the committee tabled an item that reached the agenda.
-- Passive skips (a candidate the human never selected) are not deferrals and are not recorded here.
-- Counting is cumulative and never resets; see config/agenda_priority.yaml.

CREATE TABLE agenda_deferrals (
    deferral_id     TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    ref_id          TEXT NOT NULL,              -- use_case_id | edit_id | change_id
    meeting_id      TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    reason          TEXT NOT NULL               -- one of config agenda_priority.deferral.counts_as_deferral
);

CREATE INDEX agenda_deferrals_ref ON agenda_deferrals (run_id, ref_id);
