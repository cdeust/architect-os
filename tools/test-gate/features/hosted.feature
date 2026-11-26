Feature: Hosted mutation slices retain exhaustive producer and replay proof

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

  Scenario: native planning respects span nesting and deep fallback
    Then hosted planning keeps peers together and preserves a deeply nested file
    And hosted planning balances measured spans and contains only within the same source

  Scenario: an empty perimeter is judged on the one receipt of the lane that ran its canary
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
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
    When the one hosted lane of an empty perimeter completes with the proof of its canary
    Then the hosted collector judges the empty perimeter on that one receipt
    And the hosted collector rejects an active mutant without static metadata
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

  Scenario: the hosted replay independently confirms a RuntimeError with one named scenario
    Given a gate repository
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
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
    And the gate first parent is committed
    Then the hosted lane independently confirms its runtime witness against the original

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

  Scenario: the judge accepts the receipts of the plan it derived, no more and no fewer, bound to its head
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
    And a plan announced with fewer lanes, more lanes, another order, another spelling or nothing is refused
    And a planned lane without its producer or without its receipt is refused
    And a receipt for a lane outside the plan is refused
    And the receipt or the producer of one lane presented for another is refused
    And lanes whose reports hold no canary are refused, whether they name it or not
    And receipts of another plan are refused
    And the hosted verdict has all independently replayed mutations
    And receipts of another head are refused, the plan being the same

  Scenario: a lane report without static metadata is refused for that before the verdict of its canary is read
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
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
    When the one hosted lane of an empty perimeter completes with the proof of its canary
    Then the hosted collector names the missing static metadata of a lane before the verdict of its canary
