Feature: Workers of the agent tools under their sandbox (docs/design/platform-v3-srt.md, §2, Un seul transport, brick 1b.5)
  The gateway launches the worker of an agent tool once per run, from the server of its module in
  topology/modules.mcp.json, in a sandbox of the profile worker whose variable is the token of its task, kept with its
  task. The worker is the MCP client on its own stdio; the gateway serves task_input, call and task_complete on its
  streams, a refusal being an answer flagged as an error. Here the sandbox is a pair of streams and the worker an MCP
  client of the test: the real srt is in features/sandbox.

  Background:
    Given a worker host over the servers '{"mcpServers":{"agent":{"command":"node","args":["/p/worker.js","/p/agents/memory.md"]}}}' for the profile "worker" in "/p"

  Scenario: a run launches its worker once, with the token of its task, and keeps its sandbox with its task
    When the worker of "agent" runs for the task "task-1" with the token "tok-1"
    Then the runner was made with the variables '{"taskToken":"tok-1"}' and started '{"profile":"worker","cwd":"/p","command":["node","/p/worker.js","/p/agents/memory.md"]}'
    And the sandbox of the run is kept with the task "task-1"
    And the worker is served by "architect-os-gateway" version "0.1.0"
    And the worker sees exactly the tools:
      """
      [
        { "name": "task_input", "description": "The input of the call this worker serves.", "inputSchema": { "type": "object", "properties": {} } },
        {
          "name": "call",
          "description": "Calls the module tool at its address <domain>.<tool>, under the identifier of the call served.",
          "inputSchema": { "type": "object", "properties": { "address": { "type": "string" }, "arguments": { "type": "object" } }, "required": ["address", "arguments"] }
        },
        {
          "name": "task_complete",
          "description": "Gives the output of the call served, once.",
          "inputSchema": { "type": "object", "properties": { "output": { "type": "object" } }, "required": ["output"] }
        }
      ]
      """
    And the worker reads its input '{"tool":"recall","input":{"query":"q"},"limits":{"max_turns":3}}'
    When the worker exits
    Then the run ends

  Scenario: the worker relays its calls through its channel, which answers or refuses
    When the worker of "agent" runs for the task "task-1" with the token "tok-1"
    Then the worker calls "memory.search" with '{"query":"q"}' and gets '[{"id":"m1"}]' with the structured content '{"items":1}'
    And the channel relayed "memory.search" with '{"query":"q"}'
    And the worker calls "memory.forbidden" with '{}' and gets the error '{"code":"FORBIDDEN_CALL","message":"agent may not call forbidden"}'
    And the worker calls "memory.broken" with '{}' and gets the error '{"code":"SERVICE_UNAVAILABLE","message":"socket hang up"}'
    And the worker calls the tool "call" with '{"address":"memory.search"}' and gets an error "INVALID_ARGUMENTS"
    And the worker calls the tool "call" with '{"address":"memory.search","arguments":{},"task":"task-9"}' and gets an error "INVALID_ARGUMENTS"
    And the worker calls the tool "teleport" with '{}' and gets the error '{"code":"UNKNOWN_TOOL","message":"no tool teleport on the streams of a worker"}'

  Scenario: the worker gives its output once through its channel
    When the worker of "agent" runs for the task "task-1" with the token "tok-1"
    Then the worker gives the output '{"status":"ok"}' and gets "ok"
    And the channel took the output '{"status":"ok"}'
    And the worker gives the output '{"status":"ok"}' and gets the error '{"code":"FORBIDDEN_CALL","message":"the output is already given"}'

  Scenario: a cancelled call stops the worker once, however often its signal fires, and its run ends
    When the worker of "agent" runs for the task "task-1" with the token "tok-1"
    And the call of the run is cancelled
    And the call of the run is cancelled again
    Then the sandbox of the run was stopped 1 time
    And the run ends

  Scenario: a call cancelled once its worker exited stops nothing
    When the worker of "agent" runs for the task "task-1" with the token "tok-1"
    And the worker exits
    Then the run ends
    When the call of the run is cancelled
    Then the sandbox of the run was stopped 0 times

  Scenario: a run whose call is already cancelled stops its worker at once
    When the worker of "agent" runs for the task "task-1" with the token "tok-1" and a call already cancelled
    Then the sandbox of the run was stopped 1 time
    And the run ends

  Scenario: a run after its worker exited closes its server: the worker's streams carry nothing more
    When the worker of "agent" runs for the task "task-1" with the token "tok-1"
    And the worker exits
    Then the run ends
    And the server of the run is closed

  Scenario Outline: a worker that cannot start is SERVICE_UNAVAILABLE: <case>
    When the worker of "<module>" runs for the task "task-1" with the token "tok-1"<launch>
    Then the run is refused with "SERVICE_UNAVAILABLE" saying "<message>"
    And no sandbox is kept with the task "task-1"

    Examples:
      | case                     | module | launch                                    | message                                                       |
      | no server for its module | ghost  |                                           | no server for ghost                                           |
      | its runner refuses       | agent  | , its runner refusing "ISOLATION_UNAVAILABLE" | the worker of agent cannot start: Error: ISOLATION_UNAVAILABLE |
