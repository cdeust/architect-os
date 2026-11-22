Feature: The Gate host invokes the installed native lease protocol

  Scenario Outline: Each authority crosses the fixed host adapter with its exact arguments
    Then the native Gate adapter performs "<command>" through the fixed interpreter

    Examples:
      | command |
      | local |
      | hosted |
      | begin |
      | restore |
      | discard |
      | verify |

  Scenario Outline: The Gate adapter refuses a failed native operation
    Then the native Gate adapter refuses "<case>"

    Examples:
      | case |
      | begin |
      | restore |
      | discard |
      | verify |
      | spawn |
      | signal |
      | non-directory |
      | invalid descriptor |

  Scenario Outline: The receipt authorizes only a complete checked job
    Then the receipt publisher exercises "<case>" in a private Git checkout

    Examples:
      | case |
      | linux |
      | mutation off |
      | no linux job |
      | no canary |
      | no replay |
      | no plan |
      | macos plan |
      | missing head |
      | wrong type |
      | no base |
      | no markdown |
      | wrong HEAD |

  Scenario: A real admitted full Gate publishes only its checked commit and revokes it on a red rerun
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate configuration declares the replay
    And the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "Killed"
    And the gate replay record of the mutation report confirms the mutants "0, 1, 2, 3, 4, 5, 6"
    Then a real full Gate publishes the checked commit, preserves it on plan and revokes it on red

  Scenario: Both public Gate entrypoints propagate the lease result
    Then both public Gate entries propagate the native lease status and arguments
