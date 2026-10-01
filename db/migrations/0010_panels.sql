-- Which seats review which kind of item. Not every matter needs the whole committee: a vendor
-- review wants security, legal and risk, and convening eight members for it costs eight members'
-- calls. Rows here override config/panels.yaml for one workspace. risk_tier '*' matches any tier.

CREATE TABLE panel_rules (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    kind            TEXT NOT NULL,
    risk_tier       TEXT NOT NULL,              -- low | medium | high | *
    seats           TEXT NOT NULL,              -- json list of seat ids
    PRIMARY KEY (run_id, kind, risk_tier)
);
