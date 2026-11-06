Feature: Module memory (docs/design/platform-v3-srt.md, §2, brick 1b.5)
  The module memory is a child of the gateway on its stdio, its tools search and insert each a view of one data
  operation. A call carries its call identifier in _meta.call; the module calls the gateway back with it as bearer, on
  the URL its profile sets, and forwards the answer untouched. Without an identifier it calls nothing back. It serves
  until its stdin ends. Here the gateway is an MCP client of the test and its callback a fake on a free loopback port.

  Scenario: the module lists its two tools with the schemas of their data operations
    Given the module memory served with its callback on a fake gateway
    Then the module lists exactly the tools "search,insert" with the input schemas of "memory_search,memory_insert"
    And the module is served by "architect-os-module-memory" version "0.1.0"

  Scenario Outline: a call of <tool> is called back as <op> under the identifier of the call
    Given the module memory served with its callback on a fake gateway
    When the gateway calls "<tool>" with '<args>' and the call identifier "call-7"
    Then the callback got "<op>" with '<args>' and the bearer "call-7"
    And the callback was called by the client "architect-os-module-memory" version "0.1.0"
    And the module answered the text '[{"id":"m1"}]' with the structured content '{"rows":1}' and no error

    Examples:
      | tool   | op            | args                                 |
      | search | memory.search | {"query":"alpha","limit":5}          |
      | insert | memory.insert | {"content":"a fact","tags":["x"]}    |

  Scenario: a refusal of the gateway is forwarded as an error, without structured content when it has none
    Given the module memory served with its callback on a fake gateway that refuses with '{"code":"FORBIDDEN_WRITE"}'
    When the gateway calls "insert" with '{"content":"c","tags":[]}' and the call identifier "call-7"
    Then the module answered the text '{"code":"FORBIDDEN_WRITE"}' flagged as an error

  Scenario: an answer without text is forwarded as an empty text
    Given the module memory served with its callback on a fake gateway that answers no text
    When the gateway calls "search" with '{"query":"q","limit":5}' and the call identifier "call-7"
    Then the module answered the text '' and no error

  Scenario: a call without its call identifier calls nothing back
    Given the module memory served with its callback on a fake gateway
    When the gateway calls "search" with '{"query":"q","limit":5}' without a call identifier
    Then the module answered the text '{"code":"UNAUTHORIZED","message":"a call of the module carries its call identifier in _meta"}' flagged as an error
    And the callback got nothing

  Scenario: the module ends with its stdin, exit code 0
    Given the module memory served with its callback on a fake gateway
    When the gateway closes the stdin of the module
    Then the module ends with the exit code 0

  Scenario: the module without its callback URL does not start: exit code 2
    When the module memory is served without GATEWAY_CALLBACK_URL
    Then the module ends with the exit code 2
    And the module wrote "GATEWAY_CALLBACK_URL is not set" on its stderr
