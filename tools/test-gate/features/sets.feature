Feature: Test gate, rules 1 and 3: unique identities, executed set equal to the static set
  The identity of a pickle is its path, Feature, Rule, Scenario, Examples name and the literal cells of its Examples
  row. The static set is compiled from the .feature files of the job scope as cucumber-js compiles them; the
  executed set comes from the report. Comparing ids, not counts, makes a filter, a missing step definition file
  and a renamed scenario all visible.

  Background:
    Given a gate repository
    And the gate first parent is committed

  Scenario: two pickles with the same identity are red: the count would be ambiguous
    Given the gate repository holds the fixture specs "duplicate.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "duplicate"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      1: ["specs/duplicate.feature","Duplicate fixture",null,"twice",null,null] : identité présente 2 fois dans l'ensemble statique
      4: exécutés 2 ≠ base 0 + ajoutés 1 − supprimés 0 = 1
      """

  Scenario: a filtered run is red, listing every pickle it did not execute
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "filtered"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      3: ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]] : attendu, non exécuté
      3: ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["2"]] : attendu, non exécuté
      3: ["specs/green.feature","Green fixture","a rule with a background","a scenario of the rule",null,null] : attendu, non exécuté
      4: exécutés 2 ≠ base 0 + ajoutés 5 − supprimés 0 = 5
      """

  Scenario: a scenario renamed after the run is red: its old identity is unexpected, its new one missing
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate repository file "specs/second.feature" reads:
      """
      Feature: Second green fixture

        Scenario: a renamed scenario
          Given a passing step
          And a step with value 3
      """
    And the gate cucumber report is the fixture "green"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      3: ["specs/second.feature","Second green fixture",null,"a renamed scenario",null,null] : attendu, non exécuté
      3: ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : exécuté, absent de l'ensemble statique
      """

  Scenario: a pickle run from a file the configuration does not count as a feature is unexpected
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate configuration reads:
      """
      {
        "production": { "include": ["src/**/*.mjs"], "exclude": [] },
        "features": { "include": ["specs/green.feature"], "exclude": [] },
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
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      3: ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : exécuté, absent de l'ensemble statique
      4: exécutés 5 ≠ base 0 + ajoutés 4 − supprimés 0 = 4
      """

  Scenario: a .feature file gherkin cannot parse is red
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository file "specs/broken.feature" reads:
      """
      this is not gherkin
      """
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      3: specs/broken.feature : Parser errors: (1:1): expected: #EOF, #Language, #TagLine, #FeatureLine, #Comment, #Empty, got 'this is not gherkin' : fichier .feature illisible
      """

  Scenario: a .feature file without a Feature holds no pickle
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository file "specs/nothing.feature" reads:
      """
      # only a comment
      """
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: the macos job leaves out of the first parent the features outside its scope
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate first parent is committed
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate report has the line "- +0 −0"

  Scenario: a cucumber report with lines of spaces between its envelopes is read
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green" with a line of spaces between its envelopes
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: the macos job counts and executes features/sandbox only, without mutation
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate report has the line "- exécutés : 0"
    And the gate mutation section reads:
      """
      ## Mutation

      Mutation désactivée pour ce job.
      """

  Scenario Outline: downstream verdict for independent Cucumber reports, <mode>
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the two Cucumber reports from fixture "green" are "<mode>"
    When the gate checks the Linux job with two Cucumber reports
    Then the gate verdict is "<verdict>"
    And the Cucumber lot outcome diagnostic is:
      """
      <diagnostic>
      """

    Examples:
      | mode                 | verdict | diagnostic                                                                                                                                                |
      | complete             | green   | none                                                                                                                                                      |
      | missing              | red     | rapport Cucumber illisible : lot Cucumber 2 absent                                                                                                        |
      | duplicate            | red     | rapport Cucumber illisible : lot Cucumber 2 : scénario exécuté plusieurs fois : ["specs/green.feature","Green fixture",null,"a plain scenario",null,null] |
      | incomplete           | red     | rapport Cucumber illisible : lot Cucumber 2 : lot Cucumber sans événement de fin unique                                                                   |
      | foreign terminal     | red     | rapport Cucumber illisible : lot Cucumber 2 : fin Cucumber rattachée à un autre lot                                                                       |
      | empty                | red     | rapport Cucumber illisible : lot Cucumber 2 : lot Cucumber sans événement de fin unique                                                                   |
      | no run start         | red     | rapport Cucumber illisible : lot Cucumber 2 : lot Cucumber sans événement de fin unique                                                                   |
      | duplicate run start  | red     | rapport Cucumber illisible : lot Cucumber 2 : lot Cucumber sans événement de fin unique                                                                   |
      | duplicate run finish | red     | rapport Cucumber illisible : lot Cucumber 2 : lot Cucumber sans événement de fin unique                                                                   |
      | nonterminal finish   | red     | rapport Cucumber illisible : lot Cucumber 2 : lot Cucumber sans événement de fin unique                                                                   |
      | failed run hook      | red     | hook specs/steps/steps.mjs:38 : FAILED                                                                                                                    |

  Scenario: an empty list of Cucumber lots has no outcome
    Then the Cucumber lot parser refuses an empty list with "aucun lot Cucumber"

  Scenario Outline: a configured Cucumber lot count is validated before looking for reports
    Given a gate repository
    And the gate head is committed
    When the gate checks the Linux job with Cucumber report count "<count>"
    Then the gate verdict is red
    And the Cucumber lot outcome diagnostic is:
      """
      rapport Cucumber illisible : <diagnostic>
      """

    Examples:
      | count | diagnostic                         |
      |       | nombre de lots Cucumber invalide   |
      | 0     | nombre de lots Cucumber invalide   |
      | 01    | nombre de lots Cucumber invalide   |
      | -1    | nombre de lots Cucumber invalide   |
      | 1.5   | nombre de lots Cucumber invalide   |
      | a1    | nombre de lots Cucumber invalide   |
      | 1a    | nombre de lots Cucumber invalide   |
      | 257   | nombre de lots Cucumber invalide   |
      | 12    | lot Cucumber 1 absent              |
      | 256   | lot Cucumber 1 absent              |

  Scenario: the same Cucumber report has the correct admission checks for each reader
    Then Cucumber Messages admission distinguishes legacy reads, strict lots and torn replay tails
