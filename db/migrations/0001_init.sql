-- Schema (SPEC section 8, extended where later sections need storage).
-- Runs unchanged on SQLite and Postgres:
--   * JSON is TEXT (cast with ::jsonb in Postgres queries when needed)
--   * ids are app-generated TEXT; run-scoped ids are prefixed "<run_id>/" so forks can remap them
--   * real timestamps are ISO-8601 UTC TEXT; sim_month is 'YYYY-MM' from the sim clock
--   * every run-scoped table has run_id, so checkpoints and forks can copy rows generically

CREATE TABLE experiments (
    experiment_id   TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL
);

-- One run = one bank in one replicate. Paired runs in a replicate share a seed.
CREATE TABLE runs (
    run_id                  TEXT PRIMARY KEY,
    experiment_id           TEXT NOT NULL REFERENCES experiments(experiment_id),
    bank_id                 TEXT NOT NULL,
    condition               TEXT NOT NULL,
    replicate               INTEGER NOT NULL,
    seed                    BIGINT NOT NULL,
    parent_run_id           TEXT REFERENCES runs(run_id),
    fork_month              TEXT,
    model_versions          TEXT NOT NULL,
    config_hash             TEXT NOT NULL,
    start_month             TEXT NOT NULL,
    current_month           TEXT,                   -- last fully completed sim month
    status                  TEXT NOT NULL,          -- created | running | paused | stopped | failed
    spend_cap_usd_per_month DOUBLE PRECISION,
    started_at              TEXT NOT NULL
);

CREATE TABLE interventions (
    intervention_id TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES runs(run_id),
    sim_month       TEXT,
    real_ts         TEXT NOT NULL,
    kind            TEXT NOT NULL,
    description     TEXT NOT NULL,
    source          TEXT NOT NULL                   -- cli | dashboard | worker
);

CREATE TABLE sim_months (
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    bank_id             TEXT NOT NULL,
    sim_month           TEXT NOT NULL,
    company_state       TEXT NOT NULL,
    wall_clock_seconds  DOUBLE PRECISION,
    completed_at        TEXT,
    PRIMARY KEY (run_id, sim_month)
);

CREATE TABLE agents (
    agent_id            TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(run_id),
    bank_id             TEXT NOT NULL,
    seat                TEXT NOT NULL,
    name                TEXT NOT NULL,
    title               TEXT NOT NULL,
    persona_file        TEXT NOT NULL,
    active_from         TEXT NOT NULL,
    active_to           TEXT,
    stance_baseline     DOUBLE PRECISION NOT NULL,
    replaced_agent_id   TEXT REFERENCES agents(agent_id),
    replacement_reason  TEXT
);

CREATE TABLE agent_memories (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    agent_id        TEXT NOT NULL REFERENCES agents(agent_id),
    sim_month       TEXT NOT NULL,
    text            TEXT NOT NULL,
    token_estimate  INTEGER NOT NULL,
    compressed      BOOLEAN NOT NULL,
    PRIMARY KEY (agent_id, sim_month)
);

CREATE TABLE llm_calls (
    call_id             TEXT PRIMARY KEY,
    run_id              TEXT,
    agent_id            TEXT,
    sim_month           TEXT,
    model               TEXT NOT NULL,
    purpose             TEXT NOT NULL,
    status              TEXT NOT NULL,          -- ok | error
    attempt             INTEGER NOT NULL,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    cached_tokens       INTEGER NOT NULL DEFAULT 0,  -- cache reads
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cost_usd            DOUBLE PRECISION NOT NULL DEFAULT 0,
    batch               BOOLEAN NOT NULL,
    batch_id            TEXT,
    custom_id           TEXT,
    stop_reason         TEXT,
    error               TEXT,
    request             TEXT NOT NULL,
    response            TEXT,
    created_at          TEXT NOT NULL
);
CREATE INDEX idx_llm_calls_run_month ON llm_calls (run_id, sim_month);
CREATE INDEX idx_llm_calls_created ON llm_calls (created_at);
-- A batch result is logged once, even if collection is re-run after a crash.
CREATE UNIQUE INDEX idx_llm_calls_batch_result ON llm_calls (batch_id, custom_id);

-- Submitted Batch API jobs, so a restarted worker can collect results it has not logged yet.
CREATE TABLE llm_batches (
    batch_id        TEXT PRIMARY KEY,
    run_id          TEXT,
    status          TEXT NOT NULL,              -- submitted | collected
    requests        TEXT NOT NULL,              -- json: custom_id -> request metadata and params
    submitted_at    TEXT NOT NULL,
    collected_at    TEXT
);

CREATE TABLE meetings (
    meeting_id      TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    meeting_date    TEXT NOT NULL,              -- sim calendar date, YYYY-MM-DD
    agenda          TEXT NOT NULL,              -- json list of {item_id, kind, title, ref_id}
    minutes_json    TEXT,
    minutes_text    TEXT,
    status          TEXT NOT NULL               -- open | closed
);

CREATE TABLE messages (
    msg_id          TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id      TEXT REFERENCES meetings(meeting_id),
    agent_id        TEXT REFERENCES agents(agent_id),   -- null for meeting logistics
    sim_month       TEXT NOT NULL,
    phase           TEXT NOT NULL,              -- position | debate | vote | minutes | memory | handover | logistics
    round           INTEGER,
    seq             INTEGER NOT NULL,
    text            TEXT NOT NULL,
    tags            TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_messages_meeting ON messages (meeting_id, seq);

CREATE TABLE positions (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id      TEXT NOT NULL REFERENCES meetings(meeting_id),
    agent_id        TEXT NOT NULL REFERENCES agents(agent_id),
    item_id         TEXT NOT NULL,
    support         INTEGER NOT NULL,           -- 1 strongly oppose .. 5 strongly support (structured)
    stance_score    DOUBLE PRECISION,           -- 1 very cautious .. 5 very aggressive (coded)
    position        TEXT NOT NULL,
    PRIMARY KEY (meeting_id, agent_id, item_id)
);

CREATE TABLE votes (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id      TEXT NOT NULL REFERENCES meetings(meeting_id),
    agent_id        TEXT NOT NULL REFERENCES agents(agent_id),
    item_id         TEXT NOT NULL,
    vote            TEXT NOT NULL,              -- yes | no | abstain
    rationale       TEXT,
    PRIMARY KEY (meeting_id, agent_id, item_id)
);

CREATE TABLE decisions (
    decision_id     TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    meeting_id      TEXT NOT NULL REFERENCES meetings(meeting_id),
    sim_month       TEXT NOT NULL,
    item_id         TEXT NOT NULL,
    kind            TEXT NOT NULL,              -- use_case | policy_edit | status_change
    ref_id          TEXT NOT NULL,
    outcome         TEXT NOT NULL,              -- approved | rejected
    yes_votes       INTEGER NOT NULL,
    no_votes        INTEGER NOT NULL,
    abstentions     INTEGER NOT NULL,
    tie_broken      BOOLEAN NOT NULL
);

CREATE TABLE use_cases (
    use_case_id       TEXT PRIMARY KEY,
    run_id            TEXT NOT NULL REFERENCES runs(run_id),
    bank_id           TEXT NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL,
    lob               TEXT,
    details           TEXT NOT NULL,            -- json from propose_use_case
    risk_tier         TEXT,                     -- set by the engine classifier
    status            TEXT NOT NULL,            -- proposed | approved | building | live | paused | retired | rejected
    proposed_month    TEXT NOT NULL,
    decided_month     TEXT,
    live_month        TEXT,
    retired_month     TEXT,
    proposer_agent_id TEXT REFERENCES agents(agent_id),
    meeting_id        TEXT REFERENCES meetings(meeting_id)
);

CREATE TABLE use_case_history (
    history_id      TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    use_case_id     TEXT NOT NULL REFERENCES use_cases(use_case_id),
    sim_month       TEXT NOT NULL,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    source          TEXT NOT NULL,              -- committee | engine
    decision_id     TEXT
);

CREATE TABLE policy_edits (
    edit_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    meeting_id      TEXT NOT NULL REFERENCES meetings(meeting_id),
    sim_month       TEXT NOT NULL,
    agent_id        TEXT REFERENCES agents(agent_id),
    section         TEXT NOT NULL,
    text            TEXT NOT NULL,
    rationale       TEXT,
    status          TEXT NOT NULL               -- proposed | approved | rejected
);

CREATE TABLE status_changes (
    change_id       TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    meeting_id      TEXT NOT NULL REFERENCES meetings(meeting_id),
    sim_month       TEXT NOT NULL,
    agent_id        TEXT REFERENCES agents(agent_id),
    use_case_id     TEXT NOT NULL REFERENCES use_cases(use_case_id),
    new_status      TEXT NOT NULL,              -- paused | retired | live (resume)
    rationale       TEXT,
    status          TEXT NOT NULL               -- proposed | approved | rejected
);

CREATE TABLE policy_versions (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    git_sha         TEXT NOT NULL,
    policy_text     TEXT NOT NULL,
    word_count      INTEGER NOT NULL,
    control_count   INTEGER NOT NULL,
    controls        TEXT NOT NULL,              -- json list of control ids
    readability     DOUBLE PRECISION,
    PRIMARY KEY (run_id, sim_month)
);

-- Reality engine working record for one approved use case (inspector page).
CREATE TABLE engine_decisions (
    decision_id     TEXT PRIMARY KEY REFERENCES decisions(decision_id),
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    use_case_id     TEXT NOT NULL REFERENCES use_cases(use_case_id),
    sim_month       TEXT NOT NULL,
    classification  TEXT NOT NULL,
    estimates       TEXT NOT NULL,
    priors          TEXT NOT NULL,
    blended         TEXT NOT NULL,
    plan            TEXT NOT NULL               -- sampled project plan and live parameters
);

CREATE TABLE engine_draws (
    draw_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    decision_id     TEXT,
    sim_month       TEXT NOT NULL,
    variable        TEXT NOT NULL,
    dist            TEXT NOT NULL,
    params          TEXT NOT NULL,
    seed            BIGINT NOT NULL,
    value           DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_engine_draws_decision ON engine_draws (decision_id);

CREATE TABLE outcome_reports (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,              -- month the report was delivered
    report_text     TEXT NOT NULL,
    reported        TEXT NOT NULL,              -- json of the figures shown to the committee
    PRIMARY KEY (run_id, sim_month)
);

CREATE TABLE events (
    event_id        TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    type            TEXT NOT NULL,
    severity        TEXT,                       -- low | medium | high
    source          TEXT NOT NULL,              -- random | scheduled | injected | engine | regulator | board
    payload         TEXT NOT NULL
);
CREATE INDEX idx_events_run_month ON events (run_id, sim_month);

CREATE TABLE inbox_items (
    item_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    sent_date       TEXT NOT NULL,
    recipient_seat  TEXT,                       -- null = whole committee
    sender_name     TEXT NOT NULL,
    sender_title    TEXT NOT NULL,
    subject         TEXT NOT NULL,
    body            TEXT NOT NULL,
    event_id        TEXT REFERENCES events(event_id)
);

CREATE TABLE news_items (
    news_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    published_date  TEXT NOT NULL,
    outlet          TEXT NOT NULL,
    headline        TEXT NOT NULL,
    body            TEXT NOT NULL,
    event_id        TEXT REFERENCES events(event_id)
);

CREATE TABLE exams (
    exam_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    kind            TEXT NOT NULL,              -- full_scope | targeted
    trigger_reason  TEXT NOT NULL,
    letter_text     TEXT NOT NULL,
    result          TEXT NOT NULL
);

CREATE TABLE findings (
    finding_id      TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    exam_id         TEXT REFERENCES exams(exam_id),
    sim_month       TEXT NOT NULL,
    severity        TEXT NOT NULL,              -- observation | mra | mria | enforcement_referral
    topic           TEXT NOT NULL,
    description     TEXT NOT NULL,
    required_action TEXT,
    due_month       TEXT,
    status          TEXT NOT NULL,              -- open | closed | escalated
    closed_month    TEXT
);

CREATE TABLE board_memos (
    memo_id         TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    text            TEXT NOT NULL,
    actions         TEXT NOT NULL
);

-- LLM-coded text measures (SPEC 9.1 mechanism 4).
CREATE TABLE coded_measures (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    msg_id          TEXT NOT NULL REFERENCES messages(msg_id),
    measure         TEXT NOT NULL,              -- stance | objection | suspicion | frameworks | outcome_claims
    value           TEXT NOT NULL,              -- json
    rubric_version  TEXT NOT NULL,
    PRIMARY KEY (msg_id, measure)
);

-- dimension carries the breakdown key (seat, risk tier, severity); '' when none.
CREATE TABLE metrics (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    bank_id         TEXT NOT NULL,
    sim_month       TEXT NOT NULL,
    metric          TEXT NOT NULL,
    dimension       TEXT NOT NULL DEFAULT '',
    value           DOUBLE PRECISION,
    PRIMARY KEY (run_id, sim_month, metric, dimension)
);

CREATE TABLE alerts (
    alert_id        TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES runs(run_id),
    sim_month       TEXT,
    kind            TEXT NOT NULL,
    severity        TEXT NOT NULL,              -- info | warning | critical
    message         TEXT NOT NULL,
    dedupe_key      TEXT,
    created_at      TEXT NOT NULL,
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX idx_alerts_dedupe ON alerts (kind, dedupe_key);

CREATE TABLE checkpoints (
    checkpoint_id   TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    sim_month       TEXT NOT NULL,
    uri             TEXT NOT NULL,
    git_sha         TEXT,
    created_at      TEXT NOT NULL
);

-- Dashboard control actions; the worker polls this table (SPEC 10.1).
CREATE TABLE commands (
    command_id      TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES runs(run_id),
    kind            TEXT NOT NULL,              -- start | pause | resume | stop | advance | inject_event | fork | set_spend_cap
    payload         TEXT NOT NULL DEFAULT '{}',
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL,              -- pending | done | failed
    result          TEXT,
    created_at      TEXT NOT NULL,
    processed_at    TEXT
);
