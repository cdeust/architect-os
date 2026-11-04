Feature: Canary of the mutation tool (rule 7)
  tools/test-gate/canary/canary.ts has a known answer: every mutant of sum and greet is killed by the scenarios
  below, every mutant of twice survives them (run, never asserted), no scenario reaches thrice.

  Scenario: the canary sum adds
    When the canary sums 2 and 3
    Then the canary result is 5

  Scenario: the canary greet greets
    When the canary greets "ada"
    Then the canary result is "hello ada"

  Scenario: the canary twice runs without an assertion
    When the canary doubles 4
