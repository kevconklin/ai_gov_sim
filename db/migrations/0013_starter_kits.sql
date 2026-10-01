-- Starter kits, published by the worker for the dashboard to offer at setup. The dashboard cannot
-- read config/, so the kits it shows come from here; the worker reads the YAML when it applies one.
CREATE TABLE starter_kits (
    starter_id      TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    audience        TEXT NOT NULL,
    framework       TEXT NOT NULL,              -- the kit's default; the person may choose another
    stances         TEXT NOT NULL,              -- json {cautious|balanced|ambitious: {label, text}}
    facts_template  TEXT NOT NULL,
    business_goals  TEXT NOT NULL,
    control_count   INTEGER NOT NULL,
    document_count  INTEGER NOT NULL,
    updated_at      TEXT NOT NULL
);
