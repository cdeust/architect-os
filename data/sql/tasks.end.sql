-- tasks.end: the end of a task and its reason. No row: unknown task. An ended task is refused by the trigger of
-- migrations/0005_tasks.sql (55000).
UPDATE tasks SET ended_at = now(), ending = $2 WHERE task = $1
RETURNING task, client, profile, opened_at, deadline_at, ended_at, ending
