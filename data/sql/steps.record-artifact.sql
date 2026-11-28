-- steps.recordArtifact: one artifact of a Step, its bytes given in base64, its SHA-256 computed by the table. An
-- artifact already recorded violates the primary key (23505); an unknown Step, the foreign key (23503).
INSERT INTO step_artifacts (run, step, kind, name, content) VALUES ($1, $2, $3, COALESCE($4, ''), decode($5, 'base64'))
RETURNING run, step, kind, NULLIF(name, '') AS name, sha256, recorded_at
