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
    When the native plugin instruments the inventory files
    And the gate projects the native report
    Then the verified projection contains only the inventory mutants
    When the gate checks its mutation inventory
    Then the mutation inventory check returns "pass"

  Scenario Outline: a CallExpression with no selected active child stays out of the projected report
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      function call(a, b) { return a && b; }
      export const value = call(
        true,
        // Stryker disable next-line BooleanLiteral: equivalent fixture
        true,
      );
      """
    And the gate first parent is committed
    And the gate repository file "src/scoped.mjs" reads:
      """
      function call(a, b) { return a && b; }
      export const value = call(
        true,
        // Stryker disable next-line BooleanLiteral: equivalent fixture<comment>
        <value>,
      );
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the native plugin instruments the inventory files
    And the gate projects the native report
    Then the verified projection contains only the inventory mutants
    When the gate checks its mutation inventory
    Then the mutation inventory check returns "pass"

    Examples:
      | comment   | value |
      |           | false |
      | corrected | true  |

  Scenario: separate native producers are both required and their local test IDs keep their exact scenario locations
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
    And the gate repository file "src/a.mjs" reads:
      """
      export const first = true;
      """
    And the gate repository file "src/b.mjs" reads:
      """
      export const second = false;
      """
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Killed"}
      """
    And the gate head is committed
    When the gate inventories native shard "1"
    And the native plugin instruments the inventory files
    And the native producer "1" publishes its raw proof
    And the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output includes "inventaire absent"
    When the gate inventories native shard "2"
    And the native plugin instruments the inventory files
    And the native producer "2" publishes its raw proof
    And the gate collects the two native production lots
    Then the gate exits with 0
    And the native result from "src/a.mjs" is named "1/0" and covers "specs/green.feature:12"
    And the native result from "src/b.mjs" is named "2/0" and covers "specs/green.feature:12"
    And the aggregated report keeps the two certified canaries
    Given the gate configuration declares the replay
    When the gate replays mutation lot "1"
    Then the gate exits with 1
    And the replay receipt "1" contains only its own canary
    When the gate replays mutation lot "2"
    Then the gate exits with 1
    And the replay receipt "2" contains only its own canary

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

  Scenario Outline: Gate checks the report against the exact native inventory, <case>
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
    And the gate receives a mutation lot report with "<case>"
    And the gate checks its mutation inventory
    Then the mutation inventory check returns "<result>"

    Examples:
      | case                | result   |
      | exact identities    | pass     |
      | missing mutant      | absent   |
      | duplicate identity  | répété   |
      | outside active      | hors lot |
      | outside ignored     | pass     |
      | wrong source        | source   |
      | stale inventory     | périmètre |
      | different file list | fichiers |

  Scenario: mutation report identifiers are unique across files of a single producer
    Given a gate repository
    And the gate repository file "src/first.mjs" reads:
      """
      export const first = true;
      """
    And the gate repository file "src/second.mjs" reads:
      """
      export const second = false;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the gate receives a mutation lot report with "cross-file id collision"
    And the gate checks its mutation inventory
    Then the mutation inventory check returns "identifiant de mutant en double"

  Scenario: an empty projected lot still requires source proof when the whole file has a mutant
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      // old
      export const value = true;
      """
    And the gate first parent is committed
    And the gate repository file "src/scoped.mjs" reads:
      """
      // new
      export const value = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the gate receives a mutation lot report with "omitted native file"
    And the gate checks its mutation inventory
    Then the mutation inventory check returns "lot absent"

  Scenario Outline: an expected ignored mutant retains its exact evidence, <case>
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      // Stryker disable next-line BooleanLiteral: fixture �
      export const value = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the gate receives a mutation lot report with "<case>"
    And the gate checks its mutation inventory
    Then the mutation inventory check returns "<result>"

    Examples:
      | case                    | result    |
      | exact identities        | pass      |
      | native ignore drift     | ignorance |
      | invalid UTF-8 inventory | périmètre |
      | invalid UTF-8 report    | utf-8     |
      | lone surrogate in source | source du rapport |
