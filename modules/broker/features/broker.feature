Feature: the broker, sole holder of the API key (docs/design/platform-v3-srt.md, §2, Broker)
  The gateway grants a task token by `token_grant` on the broker's stdio and revokes it by `token_revoke`. A worker
  presents its token as its API key; the broker relays POST /v1/messages only, to its one upstream, with the key of its
  0600 file in x-api-key and the body unchanged, and sends the gateway one usage record per answer, logger `usage`.
  Here the upstream is a local fake, the key a test value in a temporary 0600 file, the gateway an MCP client over a
  pair of streams.

  Background:
    Given a fake upstream answering a JSON message
    And a broker over that upstream with the key "sk-test-key-of-the-scenario"

  Scenario: the broker introduces itself to the gateway by its name and version
    Then the gateway sees the MCP server "architect-os-broker" version "0.1.0"

  Scenario: a granted token is relayed with the key of the file in x-api-key, and nothing else of the caller's
    Given the gateway grants the token "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" to the task "task-1" called by "call-1"
    When the worker posts '{"model":"m","max_tokens":1}' to "/v1/messages?beta=true" with the token "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    Then the broker answers 200 with the body of the upstream
    And the upstream received one POST to "/v1/messages?beta=true" with the body '{"model":"m","max_tokens":1}'
    And the upstream request carried the key "sk-test-key-of-the-scenario" in x-api-key and no authorization

  Scenario Outline: one usage record per answer, sent to the gateway with its task and parent: <answer>
    Given the gateway grants the token "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" to the task "task-2" called by "call-2"
    And the fake upstream answers <answer>
    When the worker posts '{"model":"m"}' to "/v1/messages" with the token "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    Then the gateway got one usage record matching:
      """
      <record>
      """
    And every usage record is valid against the contract of the broker
    And no usage record and no answer holds the key, the token or the content

    Examples:
      | answer             | record                                                                                                                                                                                                |
      | a JSON message     | {"status":200,"task":"task-2","parent":"call-2","route":"/v1/messages","model":"claude-test","input_tokens":12,"output_tokens":7,"cache_read_input_tokens":3,"cache_creation_input_tokens":2} |
      | a stream of events | {"status":200,"task":"task-2","parent":"call-2","route":"/v1/messages","model":"claude-test","input_tokens":5,"output_tokens":4}                                                                     |
      | an API error       | {"status":400,"task":"task-2","parent":"call-2","route":"/v1/messages","error_type":"invalid_request_error"}                                                                                          |

  Scenario: a token granted without a parent gives records without a parent
    Given the gateway grants the token "tok_cccccccccccccccccccccccccccccccccccc" to the task "task-3"
    When the worker posts '{"model":"m"}' to "/v1/messages" with the token "tok_cccccccccccccccccccccccccccccccccccc"
    Then the gateway got one usage record matching:
      """
      {"status":200,"task":"task-3","route":"/v1/messages"}
      """
    And the usage record has no parent

  Scenario Outline: no spending without a granted token in x-api-key (401): <case>
    Given the gateway grants the token "tok_dddddddddddddddddddddddddddddddddddd" to the task "task-4" called by "call-4"
    When the worker posts '{"model":"m"}' to "/v1/messages" with the headers "<headers>"
    Then the broker answers 401 "authentication_error"
    And the upstream of the broker received no request
    And the gateway got no usage record

    Examples:
      | case                       | headers                                                         |
      | no key                     | content-type=application/json                                   |
      | an unknown token           | x-api-key=tok_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee            |
      | the token as a bearer      | authorization=Bearer tok_dddddddddddddddddddddddddddddddddddd   |
      | the key of the broker      | x-api-key=sk-test-key-of-the-scenario                           |

  Scenario: a revoked token is worth nothing (401), and a second revocation says so
    Given the gateway grants the token "tok_ffffffffffffffffffffffffffffffffffff" to the task "task-5" called by "call-5"
    When the gateway revokes the token "tok_ffffffffffffffffffffffffffffffffffff"
    Then the broker answered the revocation with '{"revoked":true}'
    When the worker posts '{"model":"m"}' to "/v1/messages" with the token "tok_ffffffffffffffffffffffffffffffffffff"
    Then the broker answers 401 "authentication_error"
    And the upstream of the broker received no request
    When the gateway revokes the token "tok_ffffffffffffffffffffffffffffffffffff"
    Then the broker answered the revocation with '{"revoked":false}'

  Scenario: a token is granted once: a second grant is refused and the cost stays with the first task
    Given the gateway grants the token "tok_gggggggggggggggggggggggggggggggggggg" to the task "task-6" called by "call-6"
    When the gateway grants the token "tok_gggggggggggggggggggggggggggggggggggg" to the task "task-7" called by "call-7"
    Then the grant is refused with '{"error":"token already granted"}'
    When the worker posts '{"model":"m"}' to "/v1/messages" with the token "tok_gggggggggggggggggggggggggggggggggggg"
    Then the gateway got one usage record matching:
      """
      {"task":"task-6","parent":"call-6"}
      """

  Scenario Outline: a grant outside the contract is refused and grants nothing: <case>
    When the gateway calls token_grant with '<arguments>'
    Then the grant is refused by the schema
    When the worker posts '{"model":"m"}' to "/v1/messages" with the token "tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh"
    Then the broker answers 401 "authentication_error"

    Examples:
      | case                  | arguments                                                                              |
      | a short token         | {"token":"tok_hhhh","task":"t"}                                                        |
      | no task               | {"token":"tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh"}                                   |
      | an unknown field      | {"token":"tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh","task":"t","budget":1}             |
      | a task with a space   | {"token":"tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh","task":"a b"}                      |
      | a token led by a sign | {"token":"!tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh","task":"t"}                       |
      | a token ended by a sign | {"token":"tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh!","task":"t"}                     |

  Scenario Outline: only POST /v1/messages passes: <method> <path> is refused (403)
    Given the gateway grants the token "tok_iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii" to the task "task-8" called by "call-8"
    When the worker sends "<method>" to "<path>" with the token "tok_iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"
    Then the broker answers 403 "permission_error"
    And the upstream of the broker received no request

    Examples:
      | method | path                               |
      | GET    | /v1/messages                       |
      | POST   | /v1/models                         |
      | POST   | /v1/messages/batches               |
      | POST   | //evil.example/v1/messages         |
      | POST   | /v1/messages/../../api/oauth/token |

  Scenario: a body the policy of 1a.0 refuses is refused (403) and recorded for its task
    Given the gateway grants the token "tok_jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj" to the task "task-9" called by "call-9"
    When the worker posts '{"model":"m","mcp_servers":[]}' to "/v1/messages" with the token "tok_jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj"
    Then the broker answers 403 "permission_error"
    And the upstream of the broker received no request
    And the gateway got one usage record matching:
      """
      {"status":403,"task":"task-9","parent":"call-9","route":"/v1/messages","error_type":"refused_by_policy"}
      """

  Scenario Outline: a key file that cannot be read stops the spending (503), without its cause: <change>
    Given the gateway grants the token "tok_kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk" to the task "task-10" called by "call-10"
    And the key file of the broker is <change>
    When the worker posts '{"model":"m"}' to "/v1/messages" with the token "tok_kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"
    Then the broker answers 503 with exactly:
      """
      {"type":"error","error":{"type":"api_error","message":"broker key unavailable: see the key file of the broker"}}
      """
    And the upstream of the broker received no request

    Examples:
      | change                        |
      | removed                       |
      | readable by its group         |
      | emptied                       |
