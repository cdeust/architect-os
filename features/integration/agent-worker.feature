Feature: An agent tool served by its worker through the Agent SDK (docs/design/platform-v3-srt.md, §2, brick 1b.5)
  The gateway serves task_input, call and task_complete on the streams of the worker; the worker runs the task profile
  agents/memory.md as the main thread of the Agent SDK, with the real Claude Code binary, against a fake model on the
  loopback: no real call, no real key. Here both ends run in this process over streams; the same path under a real srt,
  with the broker, the module memory and data, is features/sandbox/recall.feature.

  Scenario: a recall runs the task profile through the Agent SDK and gives its output once
    Given a fake model that searches the memory for "alpha" then answers '{"summary":"one fact","memories":[{"id":"m1","content":"alpha","tags":[],"score":1}]}'
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 4 turns, its calls answered '[{"id":"m1","content":"alpha"}]'
    Then the worker ended with the exit code 0
    And the call ended "ok" with the data '{"summary":"one fact","memories":[{"id":"m1","content":"alpha","tags":[],"score":1}]}'
    And the call has the evidence '[{"source":"memory","ref":"m1","excerpt":"alpha"}]'
    And the worker relayed "memory.search" with '{"query":"alpha","limit":5}'
    And the fake model was asked by the model "haiku" with the key of the task
    And the fake model was offered exactly the tools "mcp__platform__memory_search,mcp__platform__memory_insert,StructuredOutput" among others
    And the fake model got the prompt of the task profile memory
    And the fake model was first asked the tool "recall" with the input '{"query":"alpha"}'
    And the fake model got back the answer '[{"id":"m1","content":"alpha"}]' of the search, flagged as an error: false
    And the worker was the MCP client "architect-os-worker" version "0.1.0"
    And the worker let go of its stdin
    And the worker left no session transcript

  Scenario: a relay refused by the gateway is read by the agent as an error, and gives no evidence
    Given a fake model that searches the memory for "alpha" then answers '{"summary":"nothing","memories":[]}'
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 4 turns, its calls refused with "FORBIDDEN_CALL"
    Then the call ended "ok" with the data '{"summary":"nothing","memories":[]}'
    And the call has the evidence '[]'
    And the fake model got back the answer 'FORBIDDEN_CALL' of the search, flagged as an error: true

  Scenario: an answer flagged as an error gives no evidence, whatever records it names
    Given a fake model that searches the memory for "alpha" then answers '{"summary":"nothing","memories":[]}'
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 4 turns, its calls answered '[{"id":"m1","content":"alpha"}]' flagged as an error
    Then the call ended "ok" with the data '{"summary":"nothing","memories":[]}'
    And the call has the evidence '[]'

  Scenario: the model is offered the platform tools of the task profile only
    Given the task profile memory narrowed to the tool "mcp__platform__memory_search"
    And a fake model that searches the memory for "alpha" then answers '{"summary":"s","memories":[]}'
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 4 turns, its calls answered '[]'
    Then the fake model was offered the platform tools "mcp__platform__memory_search" only

  Scenario: the agent stopped at its max_turns gives the code the gateway reads; the router then ends the task
    The Result of the call keeps WORKER_FAILED, MAX_TURNS_EXCEEDED being no ErrorCode of a Result: the refusal
    MAX_TURNS_EXCEEDED and the end of the task are the router's (gateway/features/agent-tools.feature).
    Given a fake model that searches the memory for "alpha" then answers '{"summary":"late","memories":[]}'
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 1 turns, its calls answered '[]'
    Then the call ended "failed" with the code "WORKER_FAILED" saying "stopped at 1 turns"
    And the gateway read that the worker reached its max_turns

  Scenario Outline: a run that gives no output is WORKER_FAILED: <case>
    Given a fake model that <behaviour>
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 8 turns, its calls answered '[]'
    Then the call ended "failed" with the code "WORKER_FAILED" saying "<message>"

    Examples:
      | case                         | behaviour                         | message                         |
      | the model gives no structure | answers only the text "no idea"   | agent gave no structured output |
      | the API refuses              | answers only the HTTP error 400   | agent failed                    |
      | the output keeps breaking its schema | answers an invalid structured output every time | agent stopped: error_max_structured_output_retries |

  Scenario: a Claude Code that ends without a result is WORKER_FAILED
    Given a fake model that answers only the text "unused"
    And a Claude Code binary that exits without a word
    When the gateway serves the worker of "recall" with '{"query":"alpha"}' and 4 turns, its calls answered '[]'
    Then the call ended "failed" with the code "WORKER_FAILED" saying "agent produced no result message"

  Scenario: a worker launched without its task profile does not start: exit code 2
    When the worker is served without its agent file
    Then the worker ended with the exit code 2
    And the worker wrote "usage: task-serve.js <agent file>" on its stderr
