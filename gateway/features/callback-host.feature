Feature: Callback of the modules (docs/design/platform-v3-srt.md, §2, Identifiant d'appel, brick 1b.5)
  A module calls the gateway back over streamable HTTP, POST /mcp on the loopback, the identifier of the call it serves
  as bearer. Missing, unknown or invalidated: 401 before any MCP. A data operation goes to operate, any other name is a
  module address that goes to call; the task and the caller come from the identifier, never from an argument. Here the
  host listens on a free port of 127.0.0.1 and the router is scripted.

  Background:
    Given the callback host over a router that knows the call "call-1"

  Scenario Outline: a request without a valid call identifier is <status> before any MCP
    When a module posts to "<path>" with the bearer "<bearer>"
    Then the callback answers <status>
    And the router was asked nothing but to describe "<described>"

    Examples:
      | path  | bearer | status | described |
      | /mcp  |        | 401    |           |
      | /mcp  | call-9 | 401    | call-9    |
      | /mcp/ | call-1 | 404    |           |
      | /     | call-1 | 404    |           |

  Scenario: a module whose header names another scheme before Bearer is 401
    When a module posts to "/mcp" with the authorization "Basic Bearer call-1"
    Then the callback answers 401

  Scenario: the callback answers in JSON, as the server of the gateway
    When a module posts an initialize to "/mcp" with the bearer "call-1"
    Then the callback answers 200 in JSON from "architect-os-gateway-callback" version "0.1.0"

  Scenario: a GET is not the callback
    When a module gets "/mcp" with the bearer "call-1"
    Then the callback answers 404

  Scenario: a module lists the data operations it may call back, with the JSON schema of their input
    When the module of "call-1" lists the tools of the callback
    Then the callback lists every data operation with the JSON schema of its input

  Scenario: a data operation is operated under the call identifier, its answer forwarded
    When the module of "call-1" calls back "memory.search" with '{"query":"alpha"}'
    Then the router operated "memory.search" with '{"query":"alpha"}' for the call "call-1"
    And the module got the text '[{"id":"m1"}]' and no error

  Scenario: a module address is called under the call identifier, its structured answer forwarded
    When the module of "call-1" calls back "judge.score" with '{"text":"t"}'
    Then the router called "judge.score" with '{"text":"t"}' for the call "call-1"
    And the module got the text '{"score":1}' with the structured content '{"score":1}' and no error

  Scenario: a refusal of the router is an answer flagged as an error, its code kept
    When the module of "call-1" calls back "memory.insert" with '{"content":"c"}'
    Then the module got the error '{"code":"FORBIDDEN_WRITE","message":"memory may not write memory.memories"}'

  Scenario: an answer of data flagged as an error is forwarded as an error
    When the module of "call-1" calls back "tasks.end" with '{"task":"t","ending":"completed"}'
    Then the module got the text '{"code":"NOT_FOUND"}' flagged as an error

  Scenario: a failure that is not a refusal is SERVICE_UNAVAILABLE
    When the module of "call-1" calls back "usage.append" with '{}'
    Then the module got the error '{"code":"SERVICE_UNAVAILABLE","message":"data is gone"}'
