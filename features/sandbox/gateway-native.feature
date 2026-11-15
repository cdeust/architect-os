Feature: the native gateway serves the clients' front under a real srt (docs/design/platform-v3-srt.md, §8, brick 1b.6a)
  The platform of recall.feature, composed by the production code (composeNative): the clients' MCP server in front of
  the router, served over HTTP on a free loopback port. A real MCP client calls the intent tool with a bearer token; the
  gateway opens one task for the subject of the token under the profile owner, runs the module and the worker under srt
  before a fake model, completes the task and journals the call. No real call, no real key.

  Scenario: a client recalls through the front, over HTTP, with a bearer token
    Given the platform of the committed topology under srt, data in memory holding the memory "alpha fact", and the broker before a fake model that searches the memory for "alpha" then answers '{"summary":"one fact","memories":[]}'
    And the clients' front of the gateway served over HTTP on a free loopback port
    When a client calls the tool "recall" over HTTP with '{"query":"alpha"}' and the bearer token of the front
    Then the client's answer is ok with the data '{"summary":"one fact","memories":[]}'
    And the registry of data holds one task of the subject of the token under the profile "owner", ended "completed"
    And the registry of data holds the usage of that task: 2 answers of the model under the layer "broker"
    And the audit log holds the call of "recall" by the subject of the token, ok
    And the callback host of the modules listens on "127.0.0.1" only

  Scenario: a client without a token is refused and no task is opened
    Given the platform of the committed topology under srt, data in memory holding the memory "alpha fact", and the broker before a fake model that searches the memory for "alpha" then answers '{"summary":"one fact","memories":[]}'
    And the clients' front of the gateway served over HTTP on a free loopback port
    When a client calls the tool "recall" over HTTP with '{"query":"alpha"}' and no token
    Then the client's call is refused with code "UNAUTHORIZED"
    And the gateway opened no task in the registry of data
    And the audit log holds the call of "recall" refused with "UNAUTHORIZED"

  Scenario: a client remembers through the front, over HTTP, with a bearer token
    Given the platform of the committed topology under srt, data in memory holding the memory "alpha fact", and the broker before a fake model that inserts the memory "beta fact" tagged "x,y" then answers with the id it got
    And the clients' front of the gateway served over HTTP on a free loopback port
    When a client calls the tool "remember" over HTTP with '{"content":"beta fact","tags":["x","y"]}' and the bearer token of the front
    Then the client's answer is ok with a memory id
    And the registry of data holds one task of the subject of the token under the profile "owner", ended "completed"
    And the audit log holds the call of "remember" by the subject of the token, ok
