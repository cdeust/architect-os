Feature: The process of the native gateway
  serveNative starts data and the broker, composes the gateway, serves the clients on the loopback, and stops with
  nothing left running (docs/design/platform-v3-srt.md, §8, 1b.6a). Its children and its sandboxes are doubles; the
  ports are real and free.

  Scenario: a refused configuration is written on stderr and nothing is launched
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the environment of the native process lacks GATEWAY_PORT
    When the native process is started and its end is awaited
    Then the native process gave the code 1
    And the native process wrote on its standard error:
      """
      gateway: GATEWAY_PORT must be an integer from 1 to 65535
      """
    And the native process launched nothing

  Scenario: the host is asked for the sandboxes of exactly the configured means, and the check comes before the launcher
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    When the native process is started and serving
    Then the host of the native process was asked for the sandboxes of exactly '{"means":"srt"}'
    And the host of the native process was called in the order "sandboxes, check, check ended, launch"

  Scenario: the means of Docker are asked for as the operator wrote them
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the environment of the native process has GATEWAY_SANDBOX set to "docker"
    And the environment of the native process has GATEWAY_DOCKER_IMAGE set to "node@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    And the environment of the native process has GATEWAY_DOCKER_NODE set to "/usr/local/bin/node"
    And the environment of the native process has GATEWAY_DOCKER_MEMORY_MIB set to "512"
    And the environment of the native process has GATEWAY_DOCKER_PIDS set to "64"
    And the environment of the native process has GATEWAY_DOCKER_CHECK_MS set to "20000"
    When the native process is started and serving
    Then the host of the native process was asked for the sandboxes of exactly '{"means":"docker","image":"node@sha256:0000000000000000000000000000000000000000000000000000000000000000","node":"/usr/local/bin/node","memoryMiB":512,"pidsLimit":64,"checkTimeoutMs":20000}'

  Scenario: a host that refuses the sandboxes gives the code 1 and launches nothing
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the host of the native process throws "image without a digest" when asked for the sandboxes
    When the native process is started and its end is awaited
    Then the native process gave the code 1
    And the native process wrote on its standard error:
      """
      gateway: image without a digest
      """
    And the native process launched nothing
    And the host of the native process was called in the order "sandboxes"

  Scenario: a check that rejects gives the code 1 and launches nothing
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the sandboxes of the native process reject their check with "the daemon is not rootless"
    When the native process is started and its end is awaited
    Then the native process gave the code 1
    And the native process wrote on its standard error:
      """
      gateway: the daemon is not rootless
      """
    And the native process launched nothing
    And the host of the native process was called in the order "sandboxes, check"

  Scenario: served, it lists the tools for a client with a token, refuses one without, and listens on the loopback only
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    When the native process is started and serving
    Then the native process asked its launcher for the closed list "broker, data"
    And a client with the configured token lists the tools "recall, remember"
    And a client without a token calling "recall" is refused UNAUTHORIZED
    And the process listens for its clients on 127.0.0.1 and nowhere else

  Scenario: asked to stop, it ends the open task, closes its ports, then its children, and gives 0
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    And the native process is asked to stop
    Then the native process gave the code 0
    And the native process wrote nothing on its standard error
    And data opened one task, for the client "alice" under the profile "owner"
    And the open task was ended "cancelled" by data
    And the worker was started with the broker port 5099 and a task token, the module with the callback port
    And nothing listens on the port of the native process any more
    And nothing listens on the callback port of the native process any more
    And both children of the native process were closed
    And no server of the native process was listening when its children were closed

  Scenario: data that exits stops the process with 1
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    When the native process is started and serving
    And the data double of the native process exits by itself
    Then the native process gave the code 1
    And the native process wrote on its standard error:
      """
      gateway: data exited
      """
    And both children of the native process were closed
    And no server of the native process was listening when its children were closed
    And nothing listens on the port of the native process any more
    And nothing listens on the callback port of the native process any more

  Scenario: a broker that exits stops the process with 1
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    When the native process is started and serving
    And the broker double of the native process exits by itself
    Then the native process gave the code 1
    And the native process wrote on its standard error:
      """
      gateway: broker exited
      """
    And both children of the native process were closed
    And no server of the native process was listening when its children were closed
    And nothing listens on the port of the native process any more
    And nothing listens on the callback port of the native process any more

  Scenario: a child that does not speak MCP stops the start with 1, and both children are closed
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the broker double of the native process does not speak MCP
    When the native process is started and its end is awaited
    Then the native process gave the code 1
    And the native process wrote on its standard error a line matching "MCP error -32000: Connection closed"
    And both children of the native process were closed
    And nothing listens on the port of the native process any more

  Scenario: a port that is taken stops the start with 1, with the children and the callback port closed
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And another listener already holds the port of the native process
    When the native process is started and its end is awaited
    Then the native process gave the code 1
    And the native process wrote on its standard error a line matching "listen EADDRINUSE.*"
    And both children of the native process were closed
    And no server of the native process was listening when its children were closed
    And nothing listens on the callback port of the native process any more

  Scenario: a stop that does not end is bounded: the sandbox of the module is stopped, then the children are closed
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the data double of the native process holds its answer to the end of a task
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    And the native process is asked to stop, without waiting for its end
    Then the stop of the native process is not over
    When the bound of the stop passes
    Then the native process gave the code 0
    And the sandbox of the module of the native process was stopped, then both children were closed

  Scenario: at the bound, a sandbox that exited by itself is not stopped again
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the data double of the native process holds its answer to the end of a task
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    And the sandbox of the module "memory" of the native process exits by itself
    And the native process is asked to stop, without waiting for its end
    And the bound of the stop passes
    Then the native process gave the code 0
    And no sandbox of a module was stopped by the native process
    And both children of the native process were closed

  Scenario: a sandbox that refuses to stop at the bound makes the code 1, and the children are closed all the same
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the data double of the native process holds its answer to the end of a task
    And the sandbox of the module "memory" of the native process refuses to stop
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    And the native process is asked to stop, without waiting for its end
    And the bound of the stop passes
    Then the native process gave the code 1
    And both children of the native process were closed
    And the native process had written on its standard error, when it gave its code:
      """
      gateway: killing a sandbox: memory cannot be stopped
      """
    And the composition left behind has tried again to stop the module
    And the native process wrote on its standard error:
      """
      gateway: killing a sandbox: memory cannot be stopped
      gateway: after the bound: memory cannot be stopped
      """

  Scenario: a stop whose composition fails within the bound is reported, the sandbox it left is tried again, and the code is 1
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the sandbox of the module "memory" of the native process refuses to stop
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    And the native process is asked to stop
    Then the native process gave the code 1
    And the native process wrote on its standard error:
      """
      gateway: memory cannot be stopped
      gateway: killing a sandbox: memory cannot be stopped
      """
    And both children of the native process were closed

  Scenario: a sandbox whose launch ends after the bound is stopped by the composition left behind
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the sandboxes of the modules of the native process are held at their launch
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    And the native process is asked to stop, without waiting for its end
    And the bound of the stop passes
    Then the native process gave the code 0
    When the held launches of the native process go on
    Then the sandbox of the module started after the bound is stopped once it has started

  Scenario: the quota of the configuration is the one the clients meet
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    And the environment of the native process has GATEWAY_QUOTA_PER_MINUTE set to "1"
    When the native process is started and serving
    And a client with the configured token calls "recall" without waiting
    And the worker of that call has called the module "memory"
    Then a second call of "recall" by the client with the configured token is refused QUOTA_EXCEEDED
    When the native process is asked to stop
    Then the native process gave the code 0

  Scenario: what a child writes on its stderr reaches the process stderr, a line at a time, prefixed by its name
    Given a native process with doubles for data, the broker and the sandboxes, on a free port
    When the native process is started and serving
    And the data double of the native process writes "ready\nhalf of a li" on its standard error
    And the broker double of the native process writes "listening\n" on its standard error
    And the data double of the native process writes "ne\nlast, unfinished" on its standard error
    And the native process is asked to stop
    Then the native process wrote on its standard error:
      """
      data: ready
      broker: listening
      data: half of a line
      data: last, unfinished
      """

  Scenario Outline: the host of the real process stops on <signal>
    Given the host of a process whose entry is the built serve.js of the gateway of this repository
    Then the host of the process has the root of this repository, the node, the environment and the stderr of its process
    And the host of the process is not asked to stop
    When the process receives <signal>
    Then the host of the process is asked to stop
    And the process still listens to SIGTERM and to SIGINT: a second signal does not end it by default

    Examples:
      | signal  |
      | SIGTERM |
      | SIGINT  |

  Scenario: the host of the real process launches its children with the real launcher, and its sandboxes with srt
    Given the host of a process whose entry is the built serve.js of the gateway of this repository
    When the launcher of the host starts a child that writes "ready" on its stderr, then closes it
    Then the log of the launcher received "ready" from that child, and the child ended with the code 0
    And the sandboxes the host gives for srt run the srt runner for the variables '{"callbackPort":"4100"}', and their check resolves
    And the host of the process bounds the stop at 10000 ms and probes data every 1000 ms, on timers, with the audit log on stdout
