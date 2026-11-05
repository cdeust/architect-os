Feature: Data MCP server (docs/design/platform-v3-srt.md, brick 1b.3)
  Data serves its typed operations as MCP tools generated from DATA_OPS, on the stdio of its one parent, the gateway:
  one tool per operation, its input schema, the tables it writes, and no tool that takes SQL. An answer is the JSON of
  the operation's output; a refusal is `isError` with its named code, and nothing of a database message.

  Scenario: lists exactly the typed operations, each with its input schema and the tables it writes
    Given an MCP client of the data MCP server over an in-memory store
    Then the MCP server is "architect-os-data" version "0.1.0"
    And the MCP tools are exactly the typed operations
    And every MCP tool has an object input schema and names the tables it writes

  Scenario: answers an operation with the JSON of its output
    Given an MCP client of the data MCP server over an in-memory store
    When the client calls "runs.create" with '{"service":"memory","tool":"recall","input":{}}'
    And I keep the MCP answer id as "run"
    And the client calls "runs.get" with '{"run_id":"$run"}'
    Then the MCP answer matches '{"id":"$run","status":"running"}'

  Scenario Outline: refuses an operation with its named code: <code>
    Given an MCP client of the data MCP server over an in-memory store
    When the client calls "runs.create" with '{"service":"memory","tool":"recall","input":{}}'
    And I keep the MCP answer id as "run"
    And the client calls "runs.complete" with '{"run_id":"$run","status":"ok","result":null}'
    And the client calls "<op>" with '<input>'
    Then the MCP call is refused with the code "<code>"

    Examples:
      | op            | input                                                                   | code              |
      | runs.complete | {"run_id":"$run","status":"failed","result":null}                       | INVALID_OPERATION |
      | runs.get      | {"run_id":"00000000-0000-4000-8000-000000000000"}                       | NOT_FOUND         |

  Scenario: arguments outside the input schema are refused before the operation
    Given an MCP client of the data MCP server over an in-memory store
    When the client calls "usage.append" with '{"task":"t1","status":200}'
    Then the MCP call is refused by the input schema
    When the client calls "sql" with '{"text":"select 1"}'
    Then the MCP call is refused without a code

  Scenario: a failure of the store answers INTERNAL, without its message
    Given an MCP client of the data MCP server over a store that fails with "password=hunter2 at db.internal"
    When the client calls "runs.get" with '{"run_id":"00000000-0000-4000-8000-000000000000"}'
    Then the MCP call is refused with '{"code":"INTERNAL","message":"internal error"}'
    And the MCP answer does not contain "hunter2"

  Scenario: the data process serves MCP on its stdio and ends with 0 when its stdin ends
    Given the data process served on a pair of streams without DATABASE_URL
    When the client calls "usage.append" with '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200,"model":"m1","input_tokens":4}'
    And the client calls "usage.aggregate" with '{}'
    Then the MCP answer matches '[{"task":"t1","layer":"broker","model":"m1","requests":1,"input_tokens":4}]'
    When the stdin of the data process ends
    Then the data process ends with 0
    And the data process wrote nothing but MCP on its stdout
    And the data process wrote "data: DATABASE_URL is not set: using the in-memory backend" on its stderr

  Scenario: a data process whose stdin ended and was read before it served ends with 0
    Given the data process started with a stdin already ended and read
    Then the data process ends with 0

  Scenario: a data process that cannot open its store ends with 1 and says why on stderr
    Given the data process started with the DATABASE_URL "postgresql://127.0.0.1:1/none"
    Then the data process ends with 1
    And the data process wrote "data: connect ECONNREFUSED" on its stderr
    And the data process wrote nothing on its stdout

  @postgres
  Scenario: the data process over Postgres keeps the usage records it is sent over MCP
    Given the data process served on a pair of streams over the database of the scenario
    When the client calls "usage.append" with '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200,"model":"m1","input_tokens":4}'
    And the client calls "usage.append" with '{"at":"2026-11-05T10:00:01.000Z","layer":"broker","task":"t1","status":200,"model":"m1","input_tokens":6}'
    And the client calls "usage.aggregate" with '{"task":"t1"}'
    Then the MCP answer matches '[{"task":"t1","layer":"broker","model":"m1","requests":2,"input_tokens":10}]'
    And the data process wrote "data: migrations applied: [0001_runs.sql, 0002_memory.sql, 0003_runs_immutable.sql, 0004_usage_records.sql]" on its stderr
    When the stdin of the data process ends
    Then the data process ends with 0
