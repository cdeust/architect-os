-- 0006: the state of a Step (docs/design/orchestration-fable-5-2.md, §15, step A), as the StepStore port of
-- packages/sandbox records it: one row per Step of a run, its events in order, its artifacts with their bytes and their
-- SHA-256. Nothing of it changes once written: an UPDATE or a DELETE of a row, and a TRUNCATE of a table, raise 55000
-- (object_not_in_prerequisite_state), which sql/operations.json maps to INVALID_OPERATION. The kinds, phases and names
-- are those of packages/contracts/src/steps.ts.
CREATE TABLE steps (
  run         text NOT NULL CHECK (run ~ '^[\x21-\x7e]{1,200}$'),
  step        text NOT NULL CHECK (step ~ '^[a-z][a-z0-9-]{0,31}$'),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run, step)
);

CREATE TABLE step_events (
  run   text NOT NULL,
  step  text NOT NULL,
  seq   integer NOT NULL CHECK (seq >= 0),
  type  text NOT NULL CHECK (type IN ('phase.started', 'phase.ended')),
  phase text NOT NULL CHECK (phase IN ('scouts', 'build', 'checks', 'reviews')),
  at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run, step, seq),
  FOREIGN KEY (run, step) REFERENCES steps (run, step)
);

-- `name` is '' for the four kinds that are one per Step, the name of the session or the check for the others.
CREATE TABLE step_artifacts (
  run         text NOT NULL,
  step        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN (
    'scout.measure', 'scout.facts', 'build.brief', 'build.measure', 'build.report',
    'check', 'review.brief', 'review.measure', 'review.verdict'
  )),
  name        text NOT NULL CHECK (name = '' OR name ~ '^[a-z][a-z0-9-]{0,31}$'),
  content     bytea NOT NULL CHECK (octet_length(content) <= 1048576),
  sha256      text NOT NULL GENERATED ALWAYS AS (encode(sha256(content), 'hex')) STORED,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((name = '') = (kind IN ('build.brief', 'build.measure', 'build.report', 'review.brief'))),
  PRIMARY KEY (run, step, kind, name),
  FOREIGN KEY (run, step) REFERENCES steps (run, step)
);

CREATE FUNCTION steps_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'object_not_in_prerequisite_state';
END
$$;

CREATE TRIGGER steps_are_kept
  BEFORE UPDATE OR DELETE ON steps
  FOR EACH ROW EXECUTE FUNCTION steps_refuse_change();
-- Defence in depth: while step_events and step_artifacts reference steps, a TRUNCATE of steps alone is refused first
-- by their foreign keys (0A000), and with CASCADE by their own triggers; this trigger holds if a reference goes.
CREATE TRIGGER steps_are_not_truncated
  BEFORE TRUNCATE ON steps
  FOR EACH STATEMENT EXECUTE FUNCTION steps_refuse_change();

CREATE TRIGGER step_events_are_append_only
  BEFORE UPDATE OR DELETE ON step_events
  FOR EACH ROW EXECUTE FUNCTION steps_refuse_change();
CREATE TRIGGER step_events_are_not_truncated
  BEFORE TRUNCATE ON step_events
  FOR EACH STATEMENT EXECUTE FUNCTION steps_refuse_change();

CREATE TRIGGER step_artifacts_are_immutable
  BEFORE UPDATE OR DELETE ON step_artifacts
  FOR EACH ROW EXECUTE FUNCTION steps_refuse_change();
CREATE TRIGGER step_artifacts_are_not_truncated
  BEFORE TRUNCATE ON step_artifacts
  FOR EACH STATEMENT EXECUTE FUNCTION steps_refuse_change();
