-- tasks.get: one task. No row: unknown task.
SELECT task, client, profile, opened_at, deadline_at, ended_at, ending FROM tasks WHERE task = $1
