-- usage.append: one usage record, appended; migrations/0004_usage_records.sql refuses any change afterwards.
INSERT INTO usage_records (at, layer, task, parent, status, route, error_type, model,
                           input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens)
VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id
