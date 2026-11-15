Feature: the gateway, started by its entry file, serves its clients with its real children under a real srt (docs/design/platform-v3-srt.md, §8, brick 1b.6a)
  The exit of brick 1b.6a. Nothing here is composed by a test: the process is node on gateway/dist/src/serve.js, given
  only its configuration. It starts data and the broker as its children, the module memory and the worker of
  memory-agent under srt, and serves a real MCP client over HTTP. The model is a fake one over HTTPS, with a
  certificate made for the scenario and given to the broker alone as its authority: the broker refuses an upstream in
  clear. No real call, no real key.

  Scenario: a client remembers, then recalls what it remembered, through the process and its children, and the process stops clean
    Given the gateway started by its entry file, with data in memory and the broker before a fake model over HTTPS that inserts the memory "beta fact" tagged "x,y" and answers with the id it got, then searches the memory for "beta" and answers '{"summary":"one fact","memories":[]}'
    When a client of the gateway process calls "remember" with '{"content":"beta fact","tags":["x","y"]}'
    Then the gateway process answers ok with a memory id
    When a client of the gateway process calls "recall" with '{"query":"beta"}'
    Then the gateway process answers ok with the data '{"summary":"one fact","memories":[]}' and the evidence of the memory it was given, "beta fact"
    And the fake model was asked over HTTPS with the key of the broker, never with a token of a task
    And the standard output of the gateway process holds the audit of the calls "remember, recall" by "alice", ok
    When a client of the gateway process calls "recall" with '{"query":"beta"}' and no token
    Then the gateway process refuses the call with "UNAUTHORIZED"
    When the gateway process receives SIGTERM
    Then the gateway process ends with the code 0, without a failure on its standard error
    And nothing listens on the port of the gateway process or on the port of its broker any more
