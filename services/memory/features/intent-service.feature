Feature: IntentService
  The memory service use case: validate the input, record the run, run the worker, validate its output, answer with a Result.

  Scenario: returns an ok Result with validated data, evidence and cost, and records the run
    Given an intent service over a worker that prints the ok recall output
    When the intent service handles "recall" with input '{"query":"q"}'
    Then the intent result matches '{"status":"ok","cost":{"input_tokens":10,"output_tokens":5,"usd":0.001},"evidence":[{"ref":"m1"}]}'
    And the recorded run events are "run.created, worker.started, worker.exited, output.validated, run.completed"
    And the recorded run status is "ok"

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

    Examples:
      | case             | stdout            |
      | not JSON         | oops              |
      | wrong envelope   | {"hello":"world"} |

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
