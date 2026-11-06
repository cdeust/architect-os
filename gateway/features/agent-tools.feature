Feature: the gateway runs the worker of an agent tool for its call, and relays its calls (docs/design/platform-v3-srt.md, §2 and §3, brick 1b.5)
  A tool of kind agent is served by a worker under srt, launched once for the call and never relaunched. The gateway
  serves it, on its streams, the input of the call, the relay of its calls under the identifier of the call it serves,
  and the place of its output. Its deadline is the shortest of the deadline of its parent, the timeout_ms of its module
  and that of its agent; its max_turns goes with its input. The output is validated against the worker contract, its
  evidence bounded (decision 3), and against the data contract of the tool: what breaks them is a failed Result, never
  routed as data. A worker stopped at its max_turns ends the task, as a bound does. Here the worker is the in-memory
  adapter of its port, following the script of each scenario.

  Background:
    Given the gateway over the topology gateway/features/fixtures/topology.json
    And the client "cli" opened the task "task-1" with the profile "local"

  Scenario: the worker runs once for the call, with its input and max_turns, and its output validated is the Result
    Given the worker gives the output '{"status":"ok","data":{"summary":"s","memories":[]},"evidence":[{"source":"memory","ref":"m1"}],"cost":{"input_tokens":1,"output_tokens":2,"usd":0.5}}'
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the call answers the Result '{"status":"ok","data":{"summary":"s","memories":[]},"evidence":[{"source":"memory","ref":"m1"}],"run_id":"task-1","cost":{"input_tokens":1,"output_tokens":2,"usd":0.5}}'
    And the worker ran once: '{"task":"task-1","token":"token-1","module":"agent","tool":"recall","call":"call-1","timeoutMs":1500}'
    And the worker was given '{"tool":"recall","input":{"query":"q"},"limits":{"max_turns":3}}'
    And the audit log holds "task-1 client agent.recall ok"
    And the task "task-1" is open

  Scenario: the worker calls a module of its calls_allowed under the identifier of its call, one level deeper
    Given the worker calls "judge.grade" with '{"x":1}', then gives the output '{"status":"ok","data":{"summary":"s","memories":[]},"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}'
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the worker got 'judge/grade {"x":1}'
    And the module "judge" was called with "call-2" for "task-1", at depth 2, with a timeout of 1500 ms
    And the audit log holds "task-1 agent judge.grade ok, task-1 client agent.recall ok"

  Scenario: a call of the worker outside its calls_allowed is refused and logged; the worker goes on
    Given the worker calls "scout.explore" with '{}', then gives the output '{"status":"ok","data":{"summary":"s","memories":[]},"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}'
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the worker got the refusal "FORBIDDEN_CALL"
    And the audit log holds "task-1 agent scout.explore FORBIDDEN_CALL, task-1 client agent.recall ok"

  Scenario Outline: an output that breaks a contract is a failed Result, never data: <defect>
    Given the worker gives the output '<output>'
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the call answers a failed Result "<code>" saying "<message>", for "task-1" at a cost of <cost>
    And the task "task-1" is open

    Examples:
      | defect                       | output                                                                                                          | code                  | message                              | cost                                             |
      | not a worker output          | {"status":"ok"}                                                                                                 | WORKER_OUTPUT_INVALID | evidence                             | {"input_tokens":0,"output_tokens":0,"usd":0}     |
      | data outside the tool        | {"status":"ok","data":{"summary":1},"evidence":[],"cost":{"input_tokens":4,"output_tokens":5,"usd":0.25}}       | WORKER_OUTPUT_INVALID | summary                              | {"input_tokens":4,"output_tokens":5,"usd":0.25}  |
      | a failure of a named cause   | {"status":"failed","data":null,"evidence":[],"cost":{"input_tokens":4,"output_tokens":5,"usd":0.25},"error":{"code":"WORKER_TIMEOUT","message":"slow"}} | WORKER_TIMEOUT | slow | {"input_tokens":4,"output_tokens":5,"usd":0.25} |
      | a failure of no named cause  | {"status":"failed","data":null,"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0},"error":{"code":"BECAUSE","message":"m"}} | WORKER_FAILED | m | {"input_tokens":0,"output_tokens":0,"usd":0} |
      | a failure without its error  | {"status":"failed","data":null,"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}               | WORKER_FAILED         | the worker gave no message           | {"input_tokens":0,"output_tokens":0,"usd":0}     |
      | a question of no named cause | {"status":"needs_clarification","data":null,"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0},"error":{"code":"WHICH","message":"which?"}} | NEEDS_CLARIFICATION | which? | {"input_tokens":0,"output_tokens":0,"usd":0} |

  Scenario Outline: evidence beyond its bound is rejected (decision 3): <count> evidence
    Given the worker gives an output of <count> evidence
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the call answers a Result "<status>" for "task-1"

    Examples:
      | count | status |
      | 50    | ok     |
      | 51    | failed |

  Scenario: a worker that ends without its output is a failed Result
    Given the worker ends without its output
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the call answers a failed Result "WORKER_FAILED" saying "the worker ended without its output", for "task-1" at a cost of {"input_tokens":0,"output_tokens":0,"usd":0}

  Scenario: the output of a worker is taken once
    Given the worker gives the output '{"status":"ok","data":{"summary":"first","memories":[]},"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}' twice
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the worker got the refusal "FORBIDDEN_CALL" saying "the output of task-1 recall is already given"
    And the call answers the Result '{"status":"ok","data":{"summary":"first","memories":[]},"evidence":[],"run_id":"task-1","cost":{"input_tokens":0,"output_tokens":0,"usd":0}}'

  Scenario: a worker stopped at its max_turns ends the task, as a bound does
    Given the worker gives the output '{"status":"failed","data":null,"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0},"error":{"code":"MAX_TURNS_EXCEEDED","message":"error_max_turns"}}'
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the call is refused with "MAX_TURNS_EXCEEDED"
    And the refusal says "agent.recall reached 3 turns"
    And the task "task-1" ended with "error": its identifiers invalid, its token retired, its sandboxes stopped
    And the audit log holds "task-1 gateway task.end:error ok, task-1 client agent.recall MAX_TURNS_EXCEEDED"

  Scenario: a worker past its deadline is cancelled, and its call refused
    Given the worker waits until its run is cancelled
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}' without waiting
    And 1499 ms pass
    Then the worker has its run in flight
    When 1 ms passes
    Then the call is refused with "DEADLINE_EXCEEDED"
    And the worker saw its run cancelled
    And the task "task-1" is open

  Scenario: a worker that cannot start leaves its call unavailable
    Given the worker cannot start
    When the client calls "agent.recall" for "task-1" with '{"query":"q"}'
    Then the call is refused with "SERVICE_UNAVAILABLE"
    And the audit log holds "task-1 client agent.recall SERVICE_UNAVAILABLE"

  Scenario: a stable tool of a module that has an agent is served by the module, not by a worker
    When the client calls "agent.summarise" for "task-1" with '{"text":"t"}'
    Then the call answers 'agent/summarise {"text":"t"}'
    And the worker never ran

  Scenario: an agent tool of no data contract gives a failed Result, never its data
    Given the worker gives the output '{"status":"ok","data":{"any":1},"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}'
    When the client calls "agent.draft" for "task-1" with '{}'
    Then the call answers a failed Result "WORKER_OUTPUT_INVALID" saying "no contract for draft", for "task-1" at a cost of {"input_tokens":0,"output_tokens":0,"usd":0}
