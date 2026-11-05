Feature: usage, from the broker through the gateway to data (docs/design/platform-v3-srt.md, §2, Mesure du coût, 1b.3)
  The broker sends one usage record per upstream answer to the gateway, its parent on stdio; the gateway writes it to
  data, its other child on stdio, with the layer `broker`, and data keeps it append-only and sums it per task, layer and
  model. When the `tools/call` of the gateway to data fails, the gateway revokes the tokens (the broker answers 401) and
  the records received meanwhile are lost; at the return of data, it grants them again. Here the broker and data are
  the real ones, in-process over MCP, the upstream a local fake, the key a test value in a 0600 file.

  Scenario Outline: UsageSink contract: a record is stored and data is available (<adapter>)
    Given the "<adapter>" usage sink
    When the gateway appends the usage record '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200,"model":"m1","input_tokens":2}'
    Then the append outcome is "stored"
    And the usage sink is available

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario Outline: UsageSink contract: data gone is unavailable, not a refusal (<adapter>)
    Given the "<adapter>" usage sink
    And data is gone
    Then appending the usage record '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200}' fails with "SERVICE_UNAVAILABLE"
    And the usage sink is not available

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario: an MCP data that cannot reach its store is unavailable; a record it refuses is an answer
    Given the "mcp" usage sink over a store that fails with "connection to db.internal refused"
    Then appending the usage record '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200}' fails with "SERVICE_UNAVAILABLE"
    And the usage sink is not available
    Given the "mcp" usage sink
    When the gateway appends the usage record '{"at":"2026-11-05T10:00:00.000Z","layer":"worker","task":"t1","status":200}'
    Then the append outcome is "refused"
    And the usage sink is available

  Scenario Outline: BrokerControl contract: a granted token is honoured once, until revoked (<adapter>)
    Given the "<adapter>" broker control
    When the gateway grants "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" to the task "task-1" called by "call-1"
    Then the broker honours "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" for '{"task":"task-1","parent":"call-1"}'
    When the gateway grants "tok_ffffffffffffffffffffffffffffffffffff" to the task "task-3"
    Then the broker honours "tok_ffffffffffffffffffffffffffffffffffff" for '{"task":"task-3"}'
    And granting "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" to the task "task-2" is refused
    When the gateway revokes "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    Then the broker does not honour "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario: a call of a worker through the broker leaves one record in data, summed per task, layer and model
    Given the broker, the gateway and data over MCP, the gateway probing data every 20 ms
    And the gateway opens the task "task-1" with the token "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    When the worker of "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" posts to the broker, which answers 200
    And the worker of "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" posts to the broker, which answers 200
    Then data sums for "task-1":
      """
      [{"task":"task-1","layer":"broker","model":"claude-test","requests":2,"input_tokens":24,"output_tokens":14,"cache_read_input_tokens":6,"cache_creation_input_tokens":4}]
      """
    And the usage state of the gateway is '{"data":"up","lost":0,"refused":0}'

  Scenario: data gone: the broker refuses the next call with 401, the record is lost; data back: the token spends again
    Given the broker, the gateway and data over MCP, the gateway probing data every 20 ms
    And the gateway opens the task "task-1" with the token "tok_cccccccccccccccccccccccccccccccccccc"
    And data is gone
    When the worker of "tok_cccccccccccccccccccccccccccccccccccc" posts to the broker, which answers 200
    Then the gateway turns data down and loses 1 record
    And the worker of "tok_cccccccccccccccccccccccccccccccccccc" posting to the broker is answered 401
    When data is back, empty
    Then the worker of "tok_cccccccccccccccccccccccccccccccccccc" posting to the broker is answered 200 again
    And data sums for "task-1":
      """
      [{"task":"task-1","layer":"broker","model":"claude-test","requests":1}]
      """
    And the usage state of the gateway is '{"data":"up","lost":1,"refused":0}'
