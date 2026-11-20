Feature: The inventory projects native mutants onto changed production lines

  Scenario: an edit inside a multiline node keeps its enclosing mutants and excludes unrelated mutations
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export function same(a, b) {
        return a ===
          a;
      }
      export const unrelated = true;
      """
    And the gate first parent is committed
    And the gate repository file "src/scoped.mjs" reads:
      """
      export function same(a, b) {
        return a ===
          b;
      }
      export const unrelated = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the mutation inventory retains the scoped multiline nodes

  Scenario: a configured canary is inventoried whole with zero mutations
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = 1;
      """
    And the gate configuration declares the canary "src/scoped.mjs" with:
      """
      {}
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the inventory marks "src/scoped.mjs" as whole

  Scenario: an absent current debt registry cannot produce a valid inventory
    Given a gate repository
    And the gate head is committed
    And the gate debt registry is absent
    When the gate inventories the mutation scope
    Then the mutation inventory is refused

  Scenario: an invalid configuration invalidates a previous inventory
    Given a gate repository
    And the gate head is committed
    And the gate repository file "reports/mutation-inventory.json" reads:
      """
      {"previous":true}
      """
    And the gate configuration is absent
    When the gate inventories the mutation scope
    Then the mutation inventory is refused

  Scenario: an ignored native mutant retains its reason for future scope validation
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      // Stryker disable next-line BooleanLiteral: fixture reason
      export const flag = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the inventory retains the native ignore reason
