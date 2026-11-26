Feature: The gate walks only the paths of a change, and names first what it checks first
  A commit with a first parent is judged by its diff and its untracked files: a tracked file the diff does not name is
  not read, and a path the diff deletes is no longer in the checkout. Links are another matter: the directories that
  can hold production sources are walked on disk, whatever git lists, ignores or kept from the first parent.

  Scenario: a link committed at the first parent where sources could be, unchanged since, is still refused, whatever the globs start with
    Its target can change without any path of the diff changing: the tests would load sources no perimeter holds.

    Given a gate repository
    And the gate configuration reads:
      """
      {
        "production": { "include": ["src/**/*.mjs", "*/src/**/*.mjs"], "exclude": ["**/specs/**"] },
        "features": { "include": ["specs/**/*.feature"], "exclude": ["**/node_modules/**"] },
        "jobs": { "linux": { "features": ["**/*.feature"], "mutation": true } },
        "destination": "refs/remotes/origin/main",
        "debt": "mutation-debt.json",
        "reports": {
          "cucumber": "reports/cucumber.ndjson",
          "mutation": "reports/mutation/mutation.json",
          "base": "reports/base/gate-base.json",
          "plan": "reports/gate-plan.json",
          "report": "reports/gate-report.md",
          "baseOut": "reports/gate-base.json"
        }
      }
      """
    And the gate repository has a source with a LF separator at "src/leaf.mjs"
    And the gate repository replaces "lib/src" with a directory link to a disposable sibling
    And the gate first parent is committed
    And the gate repository file "src/leaf.mjs" reads:
      """
      export const witness = 2;
      """
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : GATE_SOURCE_LINK : lib/src
      """

  Scenario: a deleted file where a module directory could be is not read
    Given a gate repository
    And the gate repository file "mod/notes" reads:
      """
      a note
      """
    And the gate first parent is committed
    And the gate repository file "mod/notes" is removed
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 0
    And the gate output is:
      """
      plan linux : 0 motif(s) à muter -> reports/gate-plan.json
      """

  Scenario Outline: under a glob of the root, "<path>" may hold a production file: <may>
    Given a gate repository
    And the gate configuration takes the production files of the root as well
    Then the directory "<path>" may hold a production file of the gate configuration: <may>

    Examples:
      | path          | may | reason                                                   |
      | leaf.mjs      | no  | the last segment of *.mjs names files, not a directory   |
      | lib.mjs/inner | no  | nothing lies under a file segment of *.mjs               |
      | src           | yes | the first segment of src/**/*.mjs, beside the root glob  |
