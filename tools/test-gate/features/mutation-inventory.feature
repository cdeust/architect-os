Feature: The inventory projects native mutants onto changed production lines

  Scenario: an edit inside a multiline node keeps its enclosing mutants and excludes unrelated mutations
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      const earlier = false;
      export function same(a, b) {
        return a ===
          a;
      }
      export const unrelated = true;
      """
    And the gate first parent is committed
    And the gate repository file "src/scoped.mjs" reads:
      """
      const earlier = false;
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
    Given the checked mutation projection is compact JSON
    When the gate checks its mutation inventory
    Then the gate exits with 0
    And the gate output is:
      """
      lots de mutation vérifiés : 1 lot(s)
      """
    And the mutation projection kept its original bytes

  Scenario Outline: a CallExpression with no selected active child stays out of the projected report
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      function call(a, b) { return a && b; }
      call(
        true,
        // Stryker disable next-line BooleanLiteral: equivalent fixture
        true,
      );
      """
    And the gate first parent is committed
    And the gate repository file "src/scoped.mjs" reads:
      """
      function call(a, b) { return a && b; }
      call(
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

  Scenario: an adjacent call on the same line stays outside a selected mutation span
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      const flag = true; call(
        false
      );
      """
    And the gate first parent is committed
    And the gate repository file "src/scoped.mjs" reads:
      """
      const flag = false; call(
        false
      );
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the native plugin instruments the inventory files
    And the gate projects the native report
    Then the verified projection contains only the inventory mutants

  Scenario: a canary is emitted in path order with the other production files
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = true;
      """
    And the gate repository file "aaa/probe.mjs" reads:
      """
      export const canary = true;
      """
    And the gate configuration declares the canary "aaa/probe.mjs" with:
      """
      {}
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the inventory files are "aaa/probe.mjs, src/scoped.mjs"

  Scenario: the source digest covers the byte-order mark preserved by inventory decoding
    Given a gate repository
    And the gate source "src/prefixed.mjs" begins with a byte-order mark
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the inventory source digest includes every byte of "src/prefixed.mjs"

  Scenario: a configured canary whose source is missing cannot produce an inventory
    Given a gate repository
    And the gate configuration declares the canary "zz/absent.mjs" with:
      """
      {}
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the mutation inventory is refused
    And the gate output is:
      """
      porte de test : zz/absent.mjs : source de mutation absente
      """

  Scenario: a whole-file lot keeps unlocated nodes and refuses an unplanned source
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = true;
      """
    And the gate configuration declares the canary "src/scoped.mjs" with:
      """
      {}
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the mutation plugin retains an unlocated node of "src/scoped.mjs"
    And the whole-file plugin retains the unmutated identifier of "src/scoped.mjs"
    And native instrumentation refuses the unplanned file "src/unlisted.mjs"

  Scenario: a partial lot keeps an upstream node without a native location
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the mutation plugin retains an unlocated node of "src/scoped.mjs"

  Scenario: separate native producers are both required and their local test IDs keep their exact scenario locations
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate mutation fixture declares its independent mutation profile
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
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
    When the gate inventories the mutation scope
    Then the inventory files are "src/a.mjs, src/b.mjs, zz/probe.mjs"
    And the inventory declares only the shard "none"
    And the gate output is:
      """
      inventaire linux : 3 lot(s) de mutations -> reports/mutation-inventory.json
      """
    When the gate inventories native shard "1"
    Then the inventory files are "src/a.mjs, zz/probe.mjs"
    And the inventory declares only the shard "1"
    And the gate output is:
      """
      inventaire linux : 2 lot(s) de mutations -> reports/mutation-inventory.json
      """
    When the native plugin instruments the inventory files
    And the native producer "1" publishes its raw proof
    And native producer "1" records a survivor in "src/a.mjs"
    And the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output includes "inventaire absent"
    When the gate inventories native shard "2"
    And the native plugin instruments the inventory files
    And the native producer "2" publishes its raw proof
    And the gate collects the two native production lots
    Then the gate exits with 0
    And the gate output is:
      """
      producteurs de mutation vérifiés : 2
      """
    And the native result from "src/a.mjs" is named "1/0" and covers "specs/green.feature:12"
    And the native result from "src/b.mjs" is named "2/0" and covers "specs/green.feature:12"
    And the aggregated report keeps the two certified canaries
    Given the gate configuration declares the replay
    When the gate replays mutation lot "1"
    Then the gate exits with 1
    And the replay receipt "1" contains only its own canary
    When the gate replays mutation lot "2"
    Then the gate exits with 1
    And replay lot "2" confirms a production survivor "1/0" in "src/a.mjs"
    Given the merged report has an unprefixed canary ID "x2/legacy"
    When the gate replays mutation lot "1"
    Then the gate exits with 1
    And replay lot "1" has a canary record for "x2/legacy"
    Given the second native proof has "a surviving canary"
    When the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : canari de mutation refusé dans le lot 2
      """
    And the gate repository holds no file "reports/mutation/mutation.json"
    When the native producer "2" publishes its raw proof
    Given the second native proof has "an unknown covering test"
    When the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : scénario de mutant absent du catalogue : unknown-identifier
      """
    And the gate repository holds no file "reports/mutation/mutation.json"
    When the native producer "2" publishes its raw proof
    Given the second native proof has "a missing scenario"
    When the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : catalogue des scénarios de mutation différent : specs/green.feature:20
      """
    And the gate repository holds no file "reports/mutation/mutation.json"
    When the native producer "2" publishes its raw proof
    Given the second native proof has "an unexpected scenario"
    When the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : catalogue des scénarios de mutation différent : specs/green.feature:999
      """
    And the gate repository holds no file "reports/mutation/mutation.json"
    When the native producer "2" publishes its raw proof
    Given the second native proof has "a duplicate scenario"
    When the gate collects the two native production lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : scénario de mutation répété
      """
    And the gate repository holds no file "reports/mutation/mutation.json"

  Scenario: Stryker discovers the inventory plugin under its registered name
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the registered native plugin reads the inventory from its working directory

  Scenario: the inventory plugin rejects invalid encoding before admitting any source
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    Then the native plugin refuses an inventory with invalid UTF-8 bytes or a byte-order mark

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

  Scenario Outline: unreadable debt cannot produce a valid inventory
    Given a gate repository
    And the gate head is committed
    And the debt registry is unreadable in the "<revision>"
    When the gate inventories the mutation scope
    Then the mutation inventory is refused
    And the gate output is:
      """
      <diagnostic>
      """

    Examples:
      | revision     | diagnostic                                                                                       |
      | working tree | porte de test : registre de dette illisible : mutation-debt.json absent                         |
      | first parent | porte de test : registre de dette illisible au premier parent : hors schéma : ✖ Unrecognized key: "extra" |

  Scenario: projection without a native report invalidates only the earlier projection
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = true;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the gate repository file "reports/mutation/mutation.json" reads:
      """
      {"previous":true}
      """
    When the gate projects the native report
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : rapport de mutation absent : reports/mutation/native.json
      """
    And the gate repository holds no file "reports/mutation/mutation.json"
    And the gate repository holds a file "reports/mutation-inventory.json"

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
      | case                   | result                                         |
      | exact identities       | pass                                           |
      | missing mutant         | mutant(s) du lot absents du rapport : 1        |
      | duplicate identity     | mutant du lot répété ou motif d’ignorance      |
      | outside active         | mutant actif hors lot                          |
      | outside ignored        | pass                                           |
      | wrong source           | source du rapport                              |
      | stale inventory        | périmètre                                      |
      | different file list    | fichiers du rapport différents des lots prévus |
      | substituted file list  | fichiers du rapport différents des lots prévus |
      | duplicated file list   | fichiers du rapport différents des lots prévus |
      | unexpected report file | fichier de mutation hors inventaire            |

  Scenario Outline: the mutation report includes every configured file and unique IDs, <case>
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
    And the gate receives a mutation lot report with "<case>"
    And the gate checks its mutation inventory
    Then the mutation inventory check returns "<result>"

    Examples:
      | case                                      | result                                         |
      | cross-file id collision                   | identifiant de mutant en double                |
      | repeated configuration omits another file | fichiers du rapport différents des lots prévus |

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

  Scenario: a configured source with no native mutants may be omitted from the report
    Given a gate repository
    And the gate repository file "src/scoped.mjs" reads:
      """
      export const value = Math.PI;
      """
    And the gate head is committed
    When the gate inventories the mutation scope
    And the gate receives a mutation lot report with "omitted native file"
    And the gate checks its mutation inventory
    Then the mutation inventory check returns "pass"

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
