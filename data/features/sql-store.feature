Feature: SQL store, statement table and migrations
  The SQL lives in sql/ and migrations/; one executor binds every value as a parameter.

  Scenario: loads the committed table: every contract operation has a statement and its SQL file
    When I load the committed statement table
    Then the table has 12 distinct operations
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

  Scenario Outline: rejects a table whose SQL writes other tables than its operation declares: <defect>
    When I copy the sql directory and rewrite "<file>" as "<rewrite>"
    Then loading the statement table from the copy fails saying <message>

    Examples:
      | defect                                          | file             | rewrite                          | message                                                             |
      | a statement writing a table it does not declare | runs.get.sql     | append a delete of the runs      | operation runs.get writes ["runs"] but declares [] in DATA_OPS |
      | a declared table its statement does not write   | usage.append.sql | select the 12 parameters instead | operation usage.append writes [] but declares ["usage_records"] in DATA_OPS |
      | a statement writing another table than it declares | usage.append.sql | insert into runs instead | operation usage.append writes ["runs"] but declares ["usage_records"] in DATA_OPS |

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
    Then the first migration applies "0001_runs.sql, 0002_memory.sql, 0003_runs_immutable.sql, 0004_usage_records.sql, 0005_tasks.sql"
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
