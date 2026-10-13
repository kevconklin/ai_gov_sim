-- A model per seat, so a committee can be made of different models as well as different briefs.
-- Null means the run's pinned committee model, which is what every existing seat has.
ALTER TABLE agents ADD COLUMN model TEXT;

-- What the worker can offer, published for the dashboard to read: the dashboard has no access to
-- config/ or to the worker's environment, so it cannot know which providers have a key.
CREATE TABLE model_catalog (
    model_id        TEXT PRIMARY KEY,           -- "<provider>:<model>", or a bare id for anthropic
    label           TEXT NOT NULL,
    provider        TEXT NOT NULL,
    available       BOOLEAN NOT NULL,           -- the worker holds a key for this provider
    input_price     DOUBLE PRECISION NOT NULL,  -- USD per million tokens
    output_price    DOUBLE PRECISION NOT NULL,
    updated_at      TEXT NOT NULL
);
