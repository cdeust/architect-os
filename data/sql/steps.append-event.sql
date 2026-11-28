-- steps.appendEvent: the next event of a Step, numbered from 0. Its number is taken by the UPDATE of the row of the
-- Step, which locks it: a concurrent append waits, then reads the number this one left. An unknown Step updates no
-- row, so nothing is inserted and nothing returned: NOT_FOUND.
WITH taken AS (
  UPDATE steps SET next_seq = next_seq + 1 WHERE run = $1 AND step = $2
  RETURNING run, step, next_seq - 1 AS seq
)
INSERT INTO step_events (run, step, seq, type, phase)
SELECT run, step, seq, $3, $4 FROM taken
RETURNING run, step, seq, type, phase, at
