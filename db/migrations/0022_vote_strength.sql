-- A ballot says yes or no; a disclosed committee's ballot also says how strongly, 1 (barely) to 5
-- (strongly), so a person can see a 4-2 vote that was six shrugs apart from one that was a fight.
ALTER TABLE votes ADD COLUMN strength INTEGER;
