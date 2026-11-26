-- steps.appendEvent: the next event of a Step, numbered from 0. An unknown Step violates the foreign key (23503).
INSERT INTO step_events (run, step, seq, type, phase)
SELECT $1, $2, COALESCE(MAX(seq) + 1, 0), $3, $4 FROM step_events WHERE run = $1 AND step = $2
RETURNING run, step, seq, type, phase, at
