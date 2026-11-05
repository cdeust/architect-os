-- 0005: the tasks of the gateway (docs/design/platform-v3-srt.md, §2, Bornes opérationnelles, brick 1b.4): opened with
-- the bounds of the profile of their client, ended once with the reason of their end. Ending an ended task, or
-- changing what it was opened with, raises 55000 (object_not_in_prerequisite_state): INVALID_OPERATION.
CREATE TABLE tasks (
  task        text PRIMARY KEY,
  client      text NOT NULL,
  profile     text NOT NULL,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  ended_at    timestamptz,
  ending      text CHECK (ending IN ('completed', 'deadline', 'max_calls', 'cancelled', 'error')),
  CHECK ((ended_at IS NULL) = (ending IS NULL))
);

CREATE FUNCTION tasks_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'task % cannot change: %', OLD.task, TG_OP USING ERRCODE = 'object_not_in_prerequisite_state';
END
$$;

-- An open task may only be ended; an ended task, nothing.
CREATE TRIGGER tasks_end_once
  BEFORE UPDATE ON tasks
  FOR EACH ROW WHEN (
    OLD.ending IS NOT NULL
    OR NEW.task IS DISTINCT FROM OLD.task OR NEW.client IS DISTINCT FROM OLD.client
    OR NEW.profile IS DISTINCT FROM OLD.profile OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
  )
  EXECUTE FUNCTION tasks_refuse_change();

CREATE TRIGGER tasks_are_kept
  BEFORE DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_refuse_change();
