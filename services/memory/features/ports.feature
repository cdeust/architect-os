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
