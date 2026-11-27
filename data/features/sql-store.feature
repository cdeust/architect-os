Feature: SQL store, statement table and migrations
  The SQL lives in sql/ and migrations/; one executor binds every value as a parameter.

  Scenario: loads the committed table: every contract operation has a statement and its SQL file
    When I load the committed statement table
    Then the table has 16 distinct operations
    And every statement of the table has a non-empty text

  Scenario Outline: rejects a table with <defect>
    When I copy the sql directory and rewrite "<file>" as "<rewrite>"
    Then loading the statement table from the copy fails

    Examples:
      | defect                                         | file            | rewrite                                |
      | an operation without a statement               | operations.json | drop the first statement               |
      | an operation the contracts do not know         | operations.json | rename the first operation to sql.raw  |
      | a parameter list shorter than the placeholders | runs.create.sql | append the placeholder $4              |
      | an unknown field                               | operations.json | add the unknown field cache            |
      | a SQL file that does not exist                 | operations.json | point the first statement at nope.sql  |
      | not JSON                                       | operations.json | replace the content by an opening brace |

  Scenario Outline: rejects a table whose SQL writes or reads other tables than its operation declares: <defect>
    When I copy the sql directory and rewrite "<file>" as "<rewrite>"
    Then loading the statement table from the copy fails saying <message>

    Examples:
      | defect                                          | file             | rewrite                          | message                                                             |
      | a statement writing a table it does not declare | runs.get.sql     | append a delete of the runs      | operation runs.get writes ["runs"] but declares [] in DATA_OPS |
      | a declared table its statement does not write   | usage.append.sql | select the 12 parameters instead | operation usage.append writes [] but declares ["usage_records"] in DATA_OPS |
      | a statement writing another table than it declares | usage.append.sql | insert into runs instead | operation usage.append writes ["runs"] but declares ["usage_records"] in DATA_OPS |
      | a statement whose sources cannot be read whole | runs.get.sql     | read the runs and the tasks by a comma | runs.get.sql: SQL_SOURCES_UNREADABLE: a comma between two sources of one FROM |
      | a statement reading a table it does not declare | runs.get.sql     | select from the tasks too        | operation runs.get reads ["runs","tasks"] but declares ["runs"] in DATA_OPS |
      | a declared table its statement does not read    | tasks.open.sql   | return nothing                   | operation tasks.open reads [] but declares ["tasks"] in DATA_OPS |

  Scenario Outline: reads the tables a statement writes: <statement>
    Then the statement "<statement>" writes "<tables>"

    Examples:
      | statement                                                   | tables                    |
      | SELECT id FROM runs WHERE id = $1 FOR UPDATE                |                           |
      | SELECT id FROM runs FOR NO KEY UPDATE                       |                           |
      | INSERT INTO runs (id) VALUES ($1) ON CONFLICT DO UPDATE SET id = $1 | runs              |
      | -- UPDATE runs\nSELECT 1                                    |                           |
      | update Runs set status = $1                                 | runs                      |
      | DELETE FROM memory.memories WHERE id = $1                   | memory.memories           |
      | TRUNCATE TABLE ONLY run_events                              | run_events                |
      | MERGE INTO usage_records USING runs ON true WHEN MATCHED THEN DO NOTHING | usage_records |
      | WITH x AS (UPDATE runs SET a = 1 RETURNING id) INSERT INTO run_events SELECT id FROM x | runs, run_events |
      | UPDATE-- the table\nruns SET a = 1                          | runs                      |
      | SELECT id FROM runs FOR  UPDATE OF runs                     |                           |
      | INSERT  INTO runs VALUES (1)                                | runs                      |
      | DELETE  FROM runs                                           | runs                      |
      | TRUNCATE runs                                               | runs                      |
      | TRUNCATE  TABLE runs                                        | runs                      |
      | TRUNCATE ONLY  runs                                         | runs                      |
      | MERGE  INTO runs USING x ON true WHEN MATCHED THEN DO NOTHING | runs                    |
      | UPDATE  runs SET a = 1                                      | runs                      |
      | INSERT INTO runs SELECT 1; INSERT INTO runs SELECT 2        | runs                      |

  Scenario Outline: reads the tables a statement reads: <statement>
    Then the statement "<statement>" reads "<tables>"

    Examples:
      | statement                                                                     | tables                 |
      | SELECT id FROM runs WHERE id = $1                                             | runs                   |
      | select id from Runs r left join run_events e on e.run_id = r.id               | runs, run_events       |
      | SELECT 1 FROM ONLY memory.memories                                            | memory.memories        |
      | INSERT INTO runs (id) VALUES ($1)                                             |                        |
      | INSERT INTO runs (id) VALUES ($1) RETURNING id                                | runs                   |
      | INSERT INTO run_events SELECT 1 FROM run_events                               | run_events             |
      | DELETE FROM runs WHERE id = $1                                                |                        |
      | DELETE  FROM runs                                                             |                        |
      | SELECT a IS DISTINCT FROM b                                                   |                        |
      | WITH taken AS (UPDATE steps SET n = 1 RETURNING n) SELECT n FROM taken        | steps                  |
      | WITH taken AS(SELECT 1 FROM runs) SELECT 1 FROM taken                         | runs                   |
      | -- FROM tasks\nSELECT 1                                                       |                        |
      | SELECT 1 FROM  runs JOIN  tasks ON true                                       | runs, tasks            |
      | SELECT 1 FROM runs; SELECT 2 FROM runs                                        | runs                   |
      | UPDATE runs SET a = 1 returning id                                            | runs                   |

  Scenario Outline: refuses a statement whose sources it cannot read whole: <form>
    Then the statement "<statement>" is refused as unreadable, saying "<why>"

    Examples:
      | form                                   | statement                                                          | why                                              |
      | a comma join                           | SELECT 1 FROM runs, tasks                                          | a comma between two sources of one FROM          |
      | a comma join after an alias            | SELECT 1 FROM runs r, tasks t                                      | a comma between two sources of one FROM          |
      | a comma join after AS                  | SELECT 1 FROM runs AS r, tasks                                     | a comma between two sources of one FROM          |
      | a DELETE with USING                    | DELETE FROM runs USING tasks WHERE true                            | a USING that brings a table                      |
      | a MERGE with USING                     | MERGE INTO runs USING tasks ON true WHEN MATCHED THEN DO NOTHING   | a USING that brings a table                      |
      | a WITH clause named like a table       | WITH tasks AS (SELECT 1 FROM runs) SELECT 1 FROM tasks             | a WITH clause takes the name of the table tasks  |
      | a subquery in FROM                     | SELECT 1 FROM (SELECT 1 FROM runs) x                               | a subquery after FROM                            |
      | a subquery in JOIN                     | SELECT 1 FROM runs JOIN (SELECT 1 FROM tasks) t ON true            | a subquery after JOIN                            |
      | a function in FROM                     | SELECT 1 FROM generate_series(1, 3)                                | a function after FROM                            |
      | a function in JOIN                     | SELECT 1 FROM runs JOIN unnest(r.a) u ON true                      | a function after JOIN                            |
      | no name after FROM                     | SELECT 1 FROM                                                      | no table after FROM                              |
      | a number after FROM                    | SELECT 1 FROM 1                                                    | no table after FROM                              |
      | a source with a column list            | SELECT 1 FROM runs r (a, b)                                        | an unreadable source after FROM                  |
      | a sampled source                       | SELECT 1 FROM runs TABLESAMPLE SYSTEM (1)                          | an unreadable source after FROM                  |

  Scenario Outline: reads a statement whose words only look like a source: <form>
    Then the statement "<statement>" reads "<tables>"

    Examples:
      | form                                   | statement                                                          | tables      |
      | a JOIN with USING a column list        | SELECT 1 FROM runs JOIN run_events USING (id)                      | runs, run_events |
      | a FROM inside a string                 | SELECT 'FROM tasks, runs' FROM runs                                | runs        |
      | a FROM inside an escaped string        | SELECT E'it\\\\'s FROM tasks' FROM runs                            | runs        |
      | a FROM inside a doubled quote          | SELECT 'it''s FROM tasks' FROM runs                                | runs        |
      | a source at the end of the statement   | SELECT 1 FROM runs;                                                | runs        |
      | a source closed by a parenthesis       | SELECT (SELECT 1 FROM runs) AS x                                   | runs        |
      | a source with ONLY                     | SELECT 1 FROM ONLY runs r WHERE true                               | runs        |

  Scenario: reads a statement whose quoted name holds the word FROM
    Then the statement 'SELECT 1 AS "x FROM tasks" FROM runs' reads "runs"

  Scenario: the usage records are written by usage.append only
    Then only the operation "usage.append" writes the table "usage_records"

  Scenario: binds every value as a parameter, never into the SQL text
    Given a SQL data store over a recording executor answering the run row
    When I execute "runs.create" with:
      """
      {"service":"s'; DROP TABLE runs;--","tool":"t","input":{"a":1}}
      """
    Then the recorded statement 0 does not contain "DROP"
    And the recorded statement 0 has the parameters:
      """
      ["s'; DROP TABLE runs;--","t","{\"a\":1}"]
      """
    And the answer as JSON equals:
      """
      {"id":"r","service":"s","tool":"t","input":{},"status":"running","created_at":"1970-01-01T00:00:00.000Z"}
      """

  Scenario: chooses the vector statement only when an embedding is given
    Given a SQL data store over a recording executor answering no row
    When I execute "memory.search" with the input '{"query":"100%_x","limit":3}'
    And I execute "memory.search" with the input '{"query":"","embedding":[1,2],"limit":2}'
    Then the recorded statement 0 has the parameters '["100%_x",3]'
    And the recorded statement 0 contains "ILIKE"
    And the recorded statement 1 has the parameters '["[1,2]",2]'
    And the recorded statement 1 contains "<=>"

  Scenario: maps declared SQLSTATEs to named failures and an empty answer to NOT_FOUND
    Given a SQL data store over a recording executor failing with SQLSTATE "23503" and message 'violates foreign key constraint "run_events_run_id_fkey"'
    When I execute "runs.appendEvent" with the input '{"run_id":"r","type":"run.created","payload":{}}' and it is refused
    Then the failure matches '{"code":"NOT_FOUND","message":"runs.appendEvent: not found"}'
    Given a SQL data store over a recording executor answering no row
    When I execute "runs.get" with the input '{"run_id":"r"}' and it is refused
    Then the failure code is "NOT_FOUND"

  Scenario: applies each versioned migration once, in order
    When I migrate twice from the committed migrations directory with an in-memory ledger
    Then the first migration applies "0001_runs.sql, 0002_memory.sql, 0003_runs_immutable.sql, 0004_usage_records.sql, 0005_tasks.sql, 0006_steps.sql, 0007_run_events_sequence.sql"
    And the second migration applies nothing
    And the migration statements include "CREATE EXTENSION IF NOT EXISTS vector"

  @postgres
  Scenario: a usage record cannot be changed nor removed: UPDATE, DELETE and TRUNCATE are refused by the database
    Given the postgres data store
    When I execute "usage.append" with the input '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200,"model":"m1","input_tokens":3}'
    Then the database refuses "UPDATE usage_records SET input_tokens = 0" with SQLSTATE "55000"
    And the database refuses "DELETE FROM usage_records" with SQLSTATE "55000"
    And the database refuses "TRUNCATE usage_records" with SQLSTATE "55000"
    When I execute "usage.aggregate" with the input '{}'
    Then the answer matches '[{"task":"t1","layer":"broker","model":"m1","requests":1,"input_tokens":3}]'

  @postgres
  Scenario: an ended task cannot change, an open task can only end, and no task is removed
    Given the postgres data store
    When I execute "tasks.open" with the input '{"task":"t1","client":"cli","profile":"p","deadline_at":"2026-11-06T10:00:00.000Z"}'
    Then the database refuses "UPDATE tasks SET deadline_at = now()" with SQLSTATE "55000"
    And the database refuses "UPDATE tasks SET client = 'x'" with SQLSTATE "55000"
    And the database refuses "DELETE FROM tasks" with SQLSTATE "55000"
    When I execute "tasks.end" with the input '{"task":"t1","ending":"cancelled"}'
    Then the database refuses "UPDATE tasks SET ending = 'completed'" with SQLSTATE "55000"

  @postgres
  Scenario: nothing of a Step changes once written: UPDATE, DELETE and TRUNCATE of its three tables are refused by the database
    Given the postgres data store
    When I execute "steps.reserve" with the input '{"run":"r1","step":"s"}'
    And I execute "steps.appendEvent" with the input '{"run":"r1","step":"s","type":"phase.started","phase":"build"}'
    And I execute "steps.recordArtifact" with the input '{"run":"r1","step":"s","kind":"build.brief","bytes":"YnJpZWY="}'
    Then the database refuses "UPDATE steps SET reserved_at = now()" with SQLSTATE "55000"
    And the database refuses "DELETE FROM steps" with SQLSTATE "55000"
    And the database refuses "TRUNCATE steps" with SQLSTATE "0A000"
    And the database refuses "TRUNCATE steps CASCADE" with SQLSTATE "55000"
    And the database refuses "UPDATE steps SET next_seq = 0" with SQLSTATE "55000"
    And the database refuses "UPDATE steps SET next_seq = next_seq + 2" with SQLSTATE "55000"
    And the database refuses "UPDATE steps SET step = 't', next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE steps SET run = 'r2', next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE steps SET reserved_at = now(), next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE step_events SET phase = 'checks'" with SQLSTATE "55000"
    And the database refuses "DELETE FROM step_events" with SQLSTATE "55000"
    And the database refuses "TRUNCATE step_events" with SQLSTATE "55000"
    And the database refuses "UPDATE step_artifacts SET content = '\x00'" with SQLSTATE "55000"
    And the database refuses "DELETE FROM step_artifacts" with SQLSTATE "55000"
    And the database refuses "TRUNCATE step_artifacts" with SQLSTATE "55000"
    And the database refuses "INSERT INTO step_artifacts (run, step, kind, name, content) VALUES ('r1', 's', 'check', '', 'x')" with SQLSTATE "23514"
    And the database refuses "INSERT INTO step_artifacts (run, step, kind, name, content) VALUES ('r1', 's', 'build.report', '', decode(repeat('61', 1048577), 'hex'))" with SQLSTATE "23514"
    When I execute "steps.get" with the input '{"run":"r1","step":"s"}'
    Then the answer matches '{"events":[{"seq":0,"phase":"build"}],"artifacts":[{"kind":"build.brief","bytes":"YnJpZWY="}]}'

  @postgres
  Scenario: two appends to one Step at the same time both succeed, numbered in the order they took the Step
    Given the postgres data store
    When I execute "steps.reserve" with the input '{"run":"r1","step":"s"}'
    And a first append to the Step "s" of the run "r1" holds its transaction open while a second one arrives
    Then both appends succeeded, numbered 0 and 1 in their order
    When I execute "steps.get" with the input '{"run":"r1","step":"s"}'
    Then the answer matches '{"events":[{"seq":0,"type":"phase.started"},{"seq":1,"type":"phase.ended"}]}'

  @postgres
  Scenario: two appends to one run at the same time both succeed, numbered in the order they took the run
    Given the postgres data store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And a first append to the run kept as "run" holds its transaction open while a second one arrives
    Then both run appends succeeded, numbered 0 and 1 in their order
    When I execute "runs.events" with the input '{"run_id":"$run"}'
    Then the answer lists events "0 run.created, 1 worker.started"

  @postgres
  Scenario: a completed run takes the number of its next event and nothing else; no run renumbers its events
    Given the postgres data store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"run.created","payload":{}}'
    Then the database refuses "UPDATE runs SET next_seq = 0" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET next_seq = next_seq + 2" with SQLSTATE "55000"
    When I execute "runs.complete" with the input '{"run_id":"$run","status":"ok","result":null}'
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"run.completed","payload":{}}'
    Then the answer matches '{"seq":1,"type":"run.completed"}'
    And the database refuses "UPDATE runs SET status = 'failed', next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET service = 's', next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET tool = 't', next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET input = jsonb_build_object('x', 1), next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET result = '1', next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET created_at = now(), next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET completed_at = now(), next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET id = gen_random_uuid(), next_seq = next_seq + 1" with SQLSTATE "55000"
    And the database refuses "UPDATE runs SET next_seq = next_seq" with SQLSTATE "55000"
    When I execute "runs.events" with the input '{"run_id":"$run"}'
    Then the answer lists events "0 run.created, 1 run.completed"

  @postgres
  Scenario: the migration numbers the next event of a run that already has events after its last
    Given the postgres data store migrated up to "0006_steps.sql" with a completed run of 2 events
    When the remaining migrations are applied
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"run.completed","payload":{}}'
    Then the answer matches '{"seq":2,"type":"run.completed"}'
