Feature: IntentService
  The memory service use case: validate the input, record the run, run the worker, validate its output, answer with a Result.

  Scenario: returns an ok Result with validated data, evidence and cost, and records the run
    Given an intent service over a worker that prints the ok recall output
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"ok","cost":{"input_tokens":10,"output_tokens":5,"usd":0.001},"evidence":[{"ref":"m1"}]}'
    And the recorded run events are "run.created, worker.started, worker.exited, output.validated, run.completed"
    And the recorded run status is "ok"

  Scenario Outline: records each event of a run with what it says: <case>
    Given an intent service over a worker that <worker>
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the recorded run events, with what each says, are '<events>'

    Examples:
      | case              | worker                              | events                                                                                                                                                                                                                                                                          |
      | an ok output      | prints the ok recall output         | [["run.created",{"tool":"recall"}],["worker.started",{}],["worker.exited",{"exit_code":0}],["output.validated",{}],["run.completed",{"status":"ok"}]]                                                                                                                    |
      | a non-zero exit   | exits with code 137 and prints ''   | [["run.created",{"tool":"recall"}],["worker.started",{}],["worker.exited",{"exit_code":137}],["run.completed",{"status":"failed"}]]                                                                                                                                      |
      | a timeout         | exceeds its timeout                 | [["run.created",{"tool":"recall"}],["worker.started",{}],["worker.exited",{"error":"WORKER_TIMEOUT"}],["run.completed",{"status":"failed"}]]                                                                                                                             |
      | no worker         | cannot start because 'no docker'    | [["run.created",{"tool":"recall"}],["worker.started",{}],["worker.exited",{"error":"WORKER_UNAVAILABLE"}],["run.completed",{"status":"failed"}]]                                                                                                                         |
      | an output not JSON | exits with code 0 and prints 'oops' | [["run.created",{"tool":"recall"}],["worker.started",{}],["worker.exited",{"exit_code":0}],["output.invalid",{"detail":"worker stdout is not JSON"}],["run.completed",{"status":"failed"}]]                                                                              |

  Scenario: rejects an invalid input without creating a run
    Given an intent service over a worker that prints the ok recall output
    When the intent service handles "recall" with input '{"query":""}'
    Then the intent result matches '{"status":"failed","run_id":null,"error":{"code":"INVALID_INPUT"}}'
    And the run registry holds 0 runs

  Scenario: fails with WORKER_OUTPUT_INVALID when the worker data violates the tool schema
    Given an intent service over a worker that exits with code 0 and prints '{"status":"ok","data":{"summary":42},"evidence":[],"cost":{"input_tokens":10,"output_tokens":5,"usd":0.001}}'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","data":null,"error":{"code":"WORKER_OUTPUT_INVALID"},"cost":{"input_tokens":10,"output_tokens":5,"usd":0.001}}'
    And the recorded run events include "output.invalid"
    And the recorded run status is "failed"

  Scenario Outline: fails with WORKER_OUTPUT_INVALID when stdout is <case>
    Given an intent service over a worker that exits with code 0 and prints '<stdout>'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result error code is "WORKER_OUTPUT_INVALID"
    And the intent result error message contains "<says>"

    Examples:
      | case             | stdout            | says                      |
      | not JSON         | oops              | worker stdout is not JSON |
      | wrong envelope   | {"hello":"world"} | evidence                  |

  Scenario: names a non-zero exit as WORKER_FAILED
    Given an intent service over a worker that exits with code 137 and prints ''
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","error":{"code":"WORKER_FAILED"}}'
    And the intent result error message contains "137"

  Scenario: names a timeout as WORKER_TIMEOUT and an unstartable worker as WORKER_UNAVAILABLE
    Given an intent service over a worker that exceeds its timeout
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result error code is "WORKER_TIMEOUT"
    Given an intent service over a worker that cannot start because 'no docker'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result error code is "WORKER_UNAVAILABLE"

  Scenario: passes through a worker-reported failure and a clarification request
    Given an intent service over a worker that exits with code 0 and prints '{"status":"failed","data":null,"evidence":[],"cost":{"input_tokens":10,"output_tokens":5,"usd":0.001},"error":{"code":"WORKER_FAILED","message":"agent stopped"}}'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","error":{"message":"agent stopped"}}'
    Given an intent service over a worker that exits with code 0 and prints '{"status":"needs_clarification","data":null,"evidence":[],"cost":{"input_tokens":10,"output_tokens":5,"usd":0.001},"error":{"code":"NEEDS_CLARIFICATION","message":"which project?"}}'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"needs_clarification","error":{"message":"which project?"}}'

  Scenario Outline: names what a worker reports without a code the service knows: <case>
    Given an intent service over a worker that exits with code 0 and prints '{"status":"<status>","data":null,"evidence":[],"cost":{"input_tokens":10,"output_tokens":5,"usd":0.001}<error>}'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"<status>","error":{"code":"<code>","message":"<message>"}}'

    Examples:
      | case                               | status              | error                                             | code                | message                    |
      | a failure with no error            | failed              |                                                   | WORKER_FAILED       | worker reported no message |
      | a clarification with no error      | needs_clarification |                                                   | NEEDS_CLARIFICATION | worker reported no message |
      | a failure with an unknown code     | failed              | ,"error":{"code":"NOPE","message":"it broke"}     | WORKER_FAILED       | it broke                   |
      | a clarification, an unknown code   | needs_clarification | ,"error":{"code":"NOPE","message":"which one?"}   | NEEDS_CLARIFICATION | which one?                 |
      | a failure with a code of the contract | failed           | ,"error":{"code":"WORKER_TIMEOUT","message":"late"} | WORKER_TIMEOUT    | late                       |

  Scenario: a runner that fails outside its contract ends the call as INTERNAL, with its token retired
    Given an intent service over a worker whose runner throws the plain error "boom"
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","data":null,"run_id":"run-1","error":{"code":"INTERNAL","message":"boom"}}'
    And the recorded run events are "run.created, worker.started"
    And the token of the run was retired once

  Scenario: a registry lost while the exit of the worker is recorded ends the call as DATA_UNAVAILABLE, and records nothing more
    Given an intent service over a run registry that fails once, when the exit of the worker is recorded
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","data":null,"run_id":"run-1","error":{"code":"DATA_UNAVAILABLE","message":"data down"}}'
    And the recorded run events are "run.created, worker.started"
    And the token of the run was retired once

  Scenario: answers DATA_UNAVAILABLE when the registry is down
    Given an intent service over a run registry that is down
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","run_id":null,"error":{"code":"DATA_UNAVAILABLE"}}'

  Scenario: passes the limits to the worker
    Given an intent service over a worker that records its request
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the worker request matches '{"timeoutMs":1000,"input":{"tool":"recall","limits":{"max_turns":4,"max_budget_usd":0.1}}}'

  Scenario: grants the token of the run before its worker starts, and gives it to the worker
    Given an intent service over a worker that records its request
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the token of the run was granted before its event "worker.started"
    And the worker input carries exactly the token granted for its run

  Scenario: retires the token of the run once the worker ended
    Given an intent service over a worker that records its request
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the token of the run was retired once, after the worker ran

  Scenario Outline: retires the token of the run once when <case>
    Given an intent service over a worker that <worker>
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the token of the run was retired once

    Examples:
      | case                    | worker                                                                            |
      | the worker timed out    | exceeds its timeout                                                               |
      | the worker cannot start | cannot start because 'no docker'                                                  |
      | the output is invalid   | exits with code 0 and prints 'oops'                                               |
      | the worker fails        | exits with code 137 and prints ''                                                 |

  Scenario: ends the run as WORKER_UNAVAILABLE, with no worker, when the token cannot be granted
    Given an intent service whose broker cannot grant a token because 'broker down'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"failed","error":{"code":"WORKER_UNAVAILABLE"}}'
    And the intent result error message contains "token of the run could not be granted: broker down"
    And the recorded run events are "run.created, run.completed"
    And no worker was started and no token retired

  Scenario: keeps the result of the run when the token cannot be retired
    Given an intent service whose broker cannot retire a token
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"ok","data":{"summary":"found"}}'
    And the recorded run events are "run.created, worker.started, worker.exited, output.validated, run.completed"
    And the token of the run was retired once

  Scenario: grants two different tokens to two runs
    Given an intent service over a worker that prints the ok recall output
    When the intent service handles "recall" with input '{"query":"q"}'
    And the intent service handles "recall" with input '{"query":"q"}'
    Then the two runs were granted two different tokens, each for its run

  Scenario Outline: puts the token in no event and no result: <case>
    Given an intent service over a worker that exits with code 0 and prints '<stdout>'
    When the intent service handles "recall" with input '{"query":"q"}'
    Then no event of the run and no result holds its token

    Examples:
      | case           | stdout                                                                                                                                                                         |
      | an ok output   | {"status":"ok","data":{"summary":"found","memories":[]},"evidence":[],"cost":{"input_tokens":1,"output_tokens":1,"usd":0.001}} |
      | an invalid one | oops                                                                                                                                                                           |
