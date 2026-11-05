-- tasks.open: a task opened by the gateway; a task already opened violates the primary key (23505).
INSERT INTO tasks (task, client, profile, deadline_at) VALUES ($1, $2, $3, $4::timestamptz)
RETURNING task, client, profile, opened_at, deadline_at, ended_at, ending
