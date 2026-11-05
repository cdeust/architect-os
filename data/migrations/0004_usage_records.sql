-- 0004: usage records of the registry (docs/design/platform-v3-srt.md, §2, Mesure du coût), one per upstream answer of
-- the broker (layer broker) or per client turn (layer client, brick 1c). Never content, never a key or a token: the
-- columns are those of UsageAppendInputSchema in packages/contracts/src/data-ops.ts.
CREATE TABLE usage_records (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at                          timestamptz NOT NULL,
  layer                       text NOT NULL CHECK (layer IN ('broker', 'client')),
  task                        text NOT NULL,
  parent                      text,
  status                      integer NOT NULL,
  route                       text,
  error_type                  text,
  model                       text,
  input_tokens                integer CHECK (input_tokens >= 0),
  output_tokens               integer CHECK (output_tokens >= 0),
  cache_read_input_tokens     integer CHECK (cache_read_input_tokens >= 0),
  cache_creation_input_tokens integer CHECK (cache_creation_input_tokens >= 0),
  recorded_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_records_task_idx ON usage_records (task, layer, model);

-- Append-only: an UPDATE or a DELETE of a row, and a TRUNCATE of the table, raise 55000
-- (object_not_in_prerequisite_state), which sql/operations.json maps to INVALID_OPERATION.
CREATE FUNCTION usage_records_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'usage_records is append-only: % refused', TG_OP USING ERRCODE = 'object_not_in_prerequisite_state';
END
$$;

CREATE TRIGGER usage_records_are_append_only
  BEFORE UPDATE OR DELETE ON usage_records
  FOR EACH ROW EXECUTE FUNCTION usage_records_refuse_change();

CREATE TRIGGER usage_records_are_not_truncated
  BEFORE TRUNCATE ON usage_records
  FOR EACH STATEMENT EXECUTE FUNCTION usage_records_refuse_change();
