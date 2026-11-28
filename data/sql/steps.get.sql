-- steps.get: a Step, its events by sequence and its artifacts by kind then name (bytewise), as one JSON value; the
-- timestamps in ISO 8601 UTC with milliseconds, as the in-memory store gives them. No row: unknown Step.
SELECT json_build_object(
         'run', s.run,
         'step', s.step,
         'reserved_at', to_char(s.reserved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'events', COALESCE((
           SELECT json_agg(json_build_object(
                    'seq', e.seq, 'type', e.type, 'phase', e.phase,
                    'at', to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                  ORDER BY e.seq)
           FROM step_events e WHERE e.run = s.run AND e.step = s.step), '[]'::json),
         'artifacts', COALESCE((
           SELECT json_agg(json_strip_nulls(json_build_object(
                    'kind', a.kind, 'name', NULLIF(a.name, ''), 'sha256', a.sha256,
                    'bytes', translate(encode(a.content, 'base64'), E'\n', ''),
                    'recorded_at', to_char(a.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
                  ORDER BY a.kind COLLATE "C", a.name COLLATE "C")
           FROM step_artifacts a WHERE a.run = s.run AND a.step = s.step), '[]'::json)
       ) AS value
FROM steps s
WHERE s.run = $1 AND s.step = $2
