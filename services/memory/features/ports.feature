Feature: Memory service ports

  Scenario: names adapter failures with the Result error code they stand for
    Then a worker timeout error of 250 ms matches '{"code":"WORKER_TIMEOUT","message":"worker exceeded 250 ms"}'
    And a ServiceError with code "DATA_UNAVAILABLE" and message "down" matches '{"name":"ServiceError","code":"DATA_UNAVAILABLE"}'

  Scenario Outline: grants and retires the tokens of the runs: <adapter>
    Given the "<adapter>" run tokens
    When the run tokens grant a token for the run "run-a" and another for the run "run-b"
    Then each granted token has at least 32 characters
    And the two granted tokens differ
    When the run tokens retire the first granted token
    Then the run tokens recorded the first granted token as retired once

    Examples:
      | adapter   |
      | in-memory |

  Scenario: the in-memory run registry names its runs in order, and refuses an event for a run it does not hold
    When the in-memory run registry creates 2 runs
    Then the in-memory run registry named them "run-1, run-2"
    And the in-memory run registry refuses an event for the run "run-9" with "unknown run run-9"

  Scenario: the in-memory data port names what it inserts in order, searches by content whatever the case, and bounds what it gives
    Given an in-memory data port holding the memories "Alpha one; beta; ALPHA two"
    Then the in-memory data port named them "mem-1, mem-2, mem-3"
    And the in-memory data port finds "mem-1, mem-3" for "alpha" with a limit of 5
    And the in-memory data port finds "mem-1" for "alpha" with a limit of 1
    And the in-memory data port refuses the operation "runs.get" with "InMemoryDataPort does not serve runs.get"
