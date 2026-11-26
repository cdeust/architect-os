-- steps.reserve: a Step of a run, reserved once; a Step already reserved violates the primary key (23505).
INSERT INTO steps (run, step) VALUES ($1, $2)
RETURNING run, step, reserved_at
