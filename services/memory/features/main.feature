Feature: the composition root of the memory service
  main.ts reads the runtime from the environment, builds the service and listens; serve.ts only hands it the
  process. The worker runs through the Docker adapter of the SandboxRunner port; here the docker client is a fake
  executable on the PATH it inherits, which records its arguments and echoes stdin.

  Scenario: the runtime of a full environment, with the defaults
    When I read the memory runtime of the test environment
    Then the memory runtime is:
      """
      {"dataUrl":"http://data:8082","worker":{"profile":"memory-worker","image":"worker:test","network":"exec","memory":"512m","pidsLimit":128,"env":{"INTERNAL_TOOLS_URL":"http://memory:8083","ANTHROPIC_BASE_URL":"http://broker:9"}},"port":8081,"internalPort":8083}
      """

  Scenario: the runtime takes the worker memory and the ports from the environment
    When I read the memory runtime of the test environment with "WORKER_MEMORY=1g, PORT=7001, INTERNAL_PORT=7002"
    Then the memory runtime has the worker memory "1g" and the ports 7001 and 7002

  Scenario Outline: a missing or empty required variable is refused: <name> <how>
    When I read the memory runtime of the test environment with <name> <how>
    Then reading the memory runtime fails with "<name> is required"

    Examples:
      | name               | how     |
      | DATA_URL           | missing |
      | WORKER_IMAGE       | missing |
      | WORKER_NETWORK     | missing |
      | INTERNAL_TOOLS_URL | missing |
      | BROKER_URL         | missing |
      | DATA_URL           | empty   |

  Scenario: start listens on both hosts, logs their ports, and closes
    When I start the memory service on free ports
    Then the memory MCP host answers its health check
    And the memory start logged its two ports
    When I close the memory service
    Then the memory MCP host no longer answers

  Scenario: the worker runs through the Docker adapter with the runtime's options
    When I start the memory service on free ports
    And the memory worker runner runs a recall request through the fake docker client
    Then the memory worker returned the input it was sent
    And the fake docker client ran "worker:test" on the network "exec" with 512m and 128 pids
    And the fake docker client got the worker environment "INTERNAL_TOOLS_URL=http://memory:8083, ANTHROPIC_BASE_URL=http://broker:9"

  Scenario Outline: the worker output is bounded at one mebibyte: <bytes> bytes are <outcome>
    When I start the memory service on free ports
    And the memory worker runner runs a request whose fake worker prints <bytes> bytes
    Then the memory worker run is <outcome>

    Examples:
      | bytes   | outcome                         |
      | 1048576 | read whole                      |
      | 1048577 | refused with WORKER_OUTPUT_INVALID |

  Scenario: an MCP port in use refuses the start
    When I start the memory service on free ports
    And I start a second memory service on the same MCP port
    Then the second start fails with "EADDRINUSE"

  Scenario: an internal port in use refuses the start and closes the MCP host that did listen
    When I start the memory service on free ports
    And I start a second memory service on a free MCP port and the same internal port
    Then the second start fails with "EADDRINUSE"
    And the MCP port of the second start is free again

  Scenario: serve reports a runtime it cannot read and gives exit code 1
    When I serve memory with the test environment without DATA_URL
    Then serve gives 1 and wrote "memory: DATA_URL is required"

  Scenario: serve starts the service with the runtime and gives exit code 0
    When I serve memory with the test environment and a start that records its call
    Then serve gives 0 and started the runtime of the test environment, logging to stderr
