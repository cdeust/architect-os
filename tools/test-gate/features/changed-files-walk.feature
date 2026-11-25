Feature: The gate walks only the paths of a change when the commit has a first parent
  A commit with a first parent is judged by its diff and its untracked files: a tracked file the diff does not name is
  not read, and a path the diff deletes is no longer in the checkout. Each path is still asked whether it is a link
  where a directory of production sources could be, and that question needs a path that exists.

  Scenario: a link committed at the first parent where sources could be, unchanged since, is not asked again, whatever the globs start with
    Given a gate repository
    And the gate configuration reads:
      """
      {
        "production": { "include": ["src/**/*.mjs", "*/src/**/*.mjs"], "exclude": ["**/specs/**"] },
        "features": { "include": ["specs/**/*.feature"], "exclude": ["**/node_modules/**"] },
        "jobs": { "linux": { "features": ["**/*.feature"], "mutation": true } },
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
    And the directory "lib/src" may hold a production file of the gate configuration: yes
    And the gate first parent is committed
    And the gate repository file "src/leaf.mjs" reads:
      """
      export const witness = 2;
      """
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 0
    And the gate output is:
      """
      plan linux : 1 motif(s) à muter -> reports/gate-plan.json
      """

  Scenario: a deleted file where a module directory could be is not asked whether it is a link
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
