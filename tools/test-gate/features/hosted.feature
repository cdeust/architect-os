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
    And the gate head is committed
    When the hosted mutation chains complete independently
    Then the hosted verdict has all independently replayed mutations
    And a replaced producer or a missing receipt cannot reuse the hosted verdict
