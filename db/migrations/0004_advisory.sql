-- Advisory items: perspectives are sealed per seat, then synthesised. No ballot, no decision
-- row, and nothing here applies to the bank's state. The human reads it and decides what to do.

CREATE TABLE perspectives (
    run_id               TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id           TEXT NOT NULL REFERENCES meetings(meeting_id),
    agent_id             TEXT NOT NULL REFERENCES agents(agent_id),
    item_id              TEXT NOT NULL,
    stance               INTEGER NOT NULL,      -- 1 strongly against .. 5 strongly for (structured)
    position             TEXT NOT NULL,
    key_concern          TEXT NOT NULL,
    would_change_my_mind TEXT NOT NULL,         -- what the human can go and check
    PRIMARY KEY (meeting_id, agent_id, item_id)
);

CREATE TABLE syntheses (
    synthesis_id     TEXT PRIMARY KEY,
    run_id           TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id       TEXT NOT NULL REFERENCES meetings(meeting_id),
    item_id          TEXT NOT NULL,
    spread           INTEGER NOT NULL,          -- max stance - min stance
    split            BOOLEAN NOT NULL,
    for_seats        TEXT NOT NULL,             -- json list
    against_seats    TEXT NOT NULL,             -- json list
    undecided_seats  TEXT NOT NULL,             -- json list
    checks           TEXT NOT NULL,             -- json list of [seat, what would change that mind]
    narrative        TEXT
);

CREATE UNIQUE INDEX syntheses_item ON syntheses (meeting_id, item_id);
