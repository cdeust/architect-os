Feature: Hosted mutation slices retain exhaustive producer and replay proof

  Scenario: separately produced nested spans require the exact independently replayed union
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/nested.mjs" reads:
      """
      export function pick(value) {
        return value && true;
      }
      """
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And only the second fixture exercises the nested return value
    And the gate head is committed
    When the hosted mutation chains complete independently in "changed lines" mode
    Then the hosted verdict has all independently replayed mutations
    And each hosted producer must match its committed inventory and canary
    And the static mutant contradicts a limited coverage claim
    And the hosted collector reports both independent divergences on separate lines
    And a replaced producer or a missing receipt cannot reuse the hosted verdict

  Scenario: debt retirement preserves native scope while replay follows changed lines
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the hosted mutation chains complete independently in "debt retirement" mode
    Then the retirement retains whole-file proof and replays only the canary
    When the gate checks the "linux" job
    Then the gate verdict is green
    And a second collection without a canary invalidates the old verdict

  Scenario: native planning respects span nesting and deep fallback
    Then hosted planning keeps peers together and preserves a deeply nested file
    And hosted planning balances measured spans and contains only within the same source

  Scenario: lane admission is strict and replay invalidates only its own receipt
    Given a gate repository
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And the gate head is committed
    Then hosted admission preserves unrelated receipts and rejects invalid lane arguments
    And the actual hosted entrypoint passes its arguments into Gate

  Scenario: invalid configuration or debt cannot produce a hosted manifest
    Given a gate repository
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And the gate head is committed
    Then hosted admission refuses broken configuration and debt at either revision
