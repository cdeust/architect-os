-- usage.aggregate: M2, the sums per task, layer and model, of one task ($1) or of all ($1 null), at most $2 groups.
-- A token count absent from a record counts 0. The order is bytewise (COLLATE "C"), as the in-memory store sorts. The
-- sums are cast to float8: pg gives a bigint as a string, and a float8 is exact up to 2^53 tokens.
SELECT task, layer, model,
       count(*)::float8                                      AS requests,
       COALESCE(sum(input_tokens), 0)::float8                AS input_tokens,
       COALESCE(sum(output_tokens), 0)::float8               AS output_tokens,
       COALESCE(sum(cache_read_input_tokens), 0)::float8     AS cache_read_input_tokens,
       COALESCE(sum(cache_creation_input_tokens), 0)::float8 AS cache_creation_input_tokens
FROM usage_records
WHERE $1::text IS NULL OR task = $1::text
GROUP BY task, layer, model
ORDER BY task COLLATE "C", layer COLLATE "C", model COLLATE "C" NULLS FIRST
LIMIT $2
