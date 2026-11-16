Feature: the gateway, started by its entry file, serves its clients with its module and its workers in containers, before a real rootless Docker daemon (docs/design/platform-v3-srt.md, §8, brick 1b.6b)
  The exit of brick 1b.6b: the scenario of features/sandbox/gateway-entry.feature, replayed with GATEWAY_SANDBOX=docker.
  Nothing here is composed by a test: the process is node on gateway/dist/src/serve.js, given only its configuration
  and what finds the Docker client and its rootless daemon. It checks the daemon and a canary container, then starts
  data and the broker as its children, natives as under srt, and the module memory and the worker of memory-agent in
  containers with no network, each reaching one port of the host through its relay. The model is a fake one over HTTPS;
  no real call, no real key. What ran in a container is asked of the daemon, not of the gateway.

  Scenario: a client remembers, then recalls what it remembered, with the module and the workers in containers, and the process stops clean
    Given the gateway started by its entry file with its sandboxes in containers before the rootless daemon of this host, with data in memory and the broker before a fake model over HTTPS that inserts the memory "beta fact" tagged "x,y" and answers with the id it got, then searches the memory for "beta" and answers '{"summary":"one fact","memories":[]}'
    When a client of the gateway process calls "remember" with '{"content":"beta fact","tags":["x","y"]}'
    Then the gateway process answers ok with a memory id
    When a client of the gateway process calls "recall" with '{"query":"beta"}'
    Then the gateway process answers ok with the data '{"summary":"one fact","memories":[]}' and the evidence of the memory it was given, "beta fact"
    And the fake model was asked over HTTPS with the key of the broker, never with a token of a task
    And the standard output of the gateway process holds the audit of the calls "remember, recall" by "alice", ok
    And the rootless daemon started exactly 4 containers of the platform since the gateway process started, each from the image of this repository
    When a client of the gateway process calls "recall" with '{"query":"beta"}' and no token
    Then the gateway process refuses the call with "UNAUTHORIZED"
    When the gateway process receives SIGTERM
    Then the gateway process ends with the code 0, without a failure on its standard error
    And nothing listens on the port of the gateway process or on the port of its broker any more
    And no container of the platform is left on the rootless daemon, and no relay folder under the temporary folder of this host

  Scenario: before the daemon with root of the same host, the process refuses to start, and launches nothing
    When the gateway is started by its entry file with its sandboxes in containers before the daemon with root of this host, and its end is awaited
    Then the gateway process ended with the code 1, its standard error starting with "gateway: ISOLATION_UNAVAILABLE: the daemon is not rootless: "
    And nothing listens on the port of the gateway process or on the port of its broker any more
    And the rootless daemon started exactly 0 containers of the platform since the gateway process started, each from the image of this repository
