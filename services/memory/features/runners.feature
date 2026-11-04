Feature: ContainerRunner adapters
  Every ContainerRunner adapter satisfies one contract. The sandbox adapter runs the worker through the SandboxRunner
  port of packages/sandbox (here a scripted fake port): it writes the input on stdin, reads a bounded output, and
  stops the sandbox on a timeout or an output beyond the bound. It launches no process itself.

  Scenario Outline: ContainerRunner contract: returns the worker stdout and exit code
    Given the "<adapter>" container runner whose worker prints '{"a":1}' and exits with 0
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner returned exit code 0 and stdout '{"a":1}'

    Examples:
      | adapter            |
      | in-process         |
      | sandbox (fake port) |

  Scenario Outline: ContainerRunner contract: reports a non-zero exit code without throwing
    Given the "<adapter>" container runner whose worker prints '' and exits with 3
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner exit code is 3

    Examples:
      | adapter            |
      | in-process         |
      | sandbox (fake port) |

  Scenario Outline: ContainerRunner contract: rejects with WORKER_TIMEOUT when the worker exceeds the timeout
    Given the "<adapter>" container runner whose worker never finishes
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner is rejected with code "WORKER_TIMEOUT"

    Examples:
      | adapter            |
      | in-process         |
      | sandbox (fake port) |

  Scenario: the sandbox runner starts the configured profile in the configured directory, input on stdin
    Given the "sandbox (fake port)" container runner whose worker prints '{}' and exits with 0
    When the container runner runs a recall request with a timeout of 50 ms
    Then the fake port was asked for the profile "memory-worker" in "/work" with an empty argv
    And the fake port received on stdin '{"run_id":"r1","tool":"recall","input":{"query":"q"},"limits":{"max_turns":1,"max_budget_usd":0.1}}'
    And the fake port was not stopped
    And the run left no timer behind

  Scenario: a worker that never finishes is stopped at the timeout
    Given the "sandbox (fake port)" container runner whose worker never finishes
    When the container runner runs a recall request with a timeout of 50 ms
    Then the fake port was stopped

  Scenario Outline: an output beyond the bound is refused and the worker stopped: <stream>
    Given the sandbox container runner whose worker writes <bytes> bytes on <stream>, bounded at 1000
    When the container runner runs a recall request with a timeout of 1000 ms
    Then the container runner is rejected with code "WORKER_OUTPUT_INVALID"
    And the container runner is rejected with the message "worker output refused: OUTPUT_TOO_LARGE: sortie au-delà de 1000 octets"
    And the fake port was stopped
    And the run left no timer behind

    Examples:
      | stream | bytes |
      | stdout | 1001  |
      | stderr | 1001  |

  Scenario: an output at the bound is read whole
    Given the sandbox container runner whose worker writes 1000 bytes on stdout, bounded at 1000
    When the container runner runs a recall request with a timeout of 1000 ms
    Then the container runner returned 1000 bytes of stdout
    And the fake port was not stopped

  Scenario: a port that refuses to start is WORKER_UNAVAILABLE
    Given the sandbox container runner whose port refuses to start with "ISOLATION_UNAVAILABLE: canari"
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner is rejected with code "WORKER_UNAVAILABLE"
    And the container runner is rejected with the message "cannot start worker: Error: ISOLATION_UNAVAILABLE: canari"

  Scenario Outline: any other failure of the output passes through unchanged and stops the worker: <error>
    Given the sandbox container runner whose port fails its stdout with "<error>"
    When the container runner runs a recall request with a timeout of 1000 ms
    Then the container runner is rejected with code "<code>"
    And the fake port was stopped
    And the run left no timer behind

    Examples:
      | error                                 | code                  |
      | a sandbox error ISOLATION_UNAVAILABLE | ISOLATION_UNAVAILABLE |
      | a plain error coded OUTPUT_TOO_LARGE  | OUTPUT_TOO_LARGE      |
