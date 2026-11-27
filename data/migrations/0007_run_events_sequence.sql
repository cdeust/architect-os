-- 0007: the events of a run are numbered under the lock of their run, as those of a Step (0006). runs.appendEvent takes
-- the number by an UPDATE of the row of the run, which Postgres serializes: two appends at the same time get two
-- numbers in order, where MAX(seq) + 1 gave both the same one and refused the second (23505). The number of a run that
-- has events is the one after its last; the trigger of 0003 is lifted for that one statement, inside the transaction
-- of the migration, and set again.
ALTER TABLE runs ADD COLUMN next_seq integer NOT NULL DEFAULT 0 CHECK (next_seq >= 0);

ALTER TABLE runs DISABLE TRIGGER runs_completed_are_immutable;
UPDATE runs SET next_seq = numbered.next FROM (
  SELECT run_id, MAX(seq) + 1 AS next FROM run_events GROUP BY run_id
) AS numbered WHERE runs.id = numbered.run_id;
ALTER TABLE runs ENABLE TRIGGER runs_completed_are_immutable;

-- A completed run stays immutable but for the number of its next event, which may only go up by one: an event appended
-- after its completion is still accepted, as before.
DROP TRIGGER runs_completed_are_immutable ON runs;
CREATE TRIGGER runs_completed_are_immutable
  BEFORE UPDATE ON runs
  FOR EACH ROW WHEN (
    OLD.status <> 'running' AND (
      NEW.id IS DISTINCT FROM OLD.id OR NEW.service IS DISTINCT FROM OLD.service
      OR NEW.tool IS DISTINCT FROM OLD.tool OR NEW.input IS DISTINCT FROM OLD.input
      OR NEW.status IS DISTINCT FROM OLD.status OR NEW.result IS DISTINCT FROM OLD.result
      OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.next_seq IS DISTINCT FROM OLD.next_seq + 1
    )
  )
  EXECUTE FUNCTION runs_refuse_update_of_completed();

-- On any run, the number of the next event stays, or goes up by one: never back, never past a number.
CREATE FUNCTION runs_refuse_renumbering() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run % cannot renumber its events', OLD.id USING ERRCODE = 'object_not_in_prerequisite_state';
END
$$;

CREATE TRIGGER runs_number_their_events_one_at_a_time
  BEFORE UPDATE ON runs
  FOR EACH ROW WHEN (NEW.next_seq <> OLD.next_seq AND NEW.next_seq <> OLD.next_seq + 1)
  EXECUTE FUNCTION runs_refuse_renumbering();
