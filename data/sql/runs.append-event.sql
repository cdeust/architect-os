-- runs.appendEvent: next event of a run, numbered from 0. Its number is taken by the UPDATE of the row of the run, which
-- locks it: a concurrent append waits, then reads the number this one left (migrations/0007). An unknown run updates no
-- row, so nothing is inserted and nothing returned: NOT_FOUND.
WITH taken AS (
  UPDATE runs SET next_seq = next_seq + 1 WHERE id = $1::uuid
  RETURNING id, next_seq - 1 AS seq
)
INSERT INTO run_events (run_id, seq, type, payload)
SELECT id, seq, $2, $3::jsonb FROM taken
RETURNING run_id, seq, type, payload, at
