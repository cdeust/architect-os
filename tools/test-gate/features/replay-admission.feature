Feature: Replay admission rejects invalid selection before the independent runner can supply evidence

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate configuration declares the replay
    And the gate mutation report is the fixture "survivor"

  Scenario: every replay candidate belongs to exactly one prepared lot
    Then replay assignment identifies its lot and refuses missing or repeated membership

  Scenario Outline: the replay refuses an invalid scenario list before launching Cucumber
    When the replay runner is given the following scenario list:
      """
      <locations>
      """
    Then the invalid replay selection creates no run artifacts

    Examples:
      | locations                                         |
      | []                                                |
      | ["specs/green.feature"]                           |
      | ["specs/green.feature:4","specs/green.feature:4"] |
      | ["specs/green.feature:4","specs/*.feature:4"]     |
      | ["specs/../specs/green.feature:4"]                |
      | ["/specs/green.feature:4"]                        |
      | ["../specs/green.feature:4"]                      |
      | ["-specs/green.feature:4"]                        |
      | ["specs/@green.feature:4"]                        |
      | ["specs/green.feature:0"]                         |
      | ["specs/green.feature:04"]                        |
      | ["specs/green.feature:٤"]                         |
      | ["specs/green.feature:9007199254740992"]          |
      | ["prefix:specs/green.feature:4"]                  |
      | ["specs/green.feature:4suffix"]                   |

  Scenario: replay admission rejects incomplete and duplicate scenario or mutant identities
    Then the independent replay rejects a missing attempt, zero steps or duplicate native identity

  Scenario Outline: the instrumented runner can exercise each replay selection decision
    When the instrumented runner exercises the replay selector with "<variant>"
    Then the replay selector exits with <status> and authorizes execution <calls> times with "<diagnostic>"

    Examples:
      | variant        | status | calls | diagnostic                         |
      | success        | 0      | 1     | AOS_REPLAY_PLAN_VALID               |
      | discovery      | 0      | 1     | AOS_REPLAY_PLAN_VALID              |
      | step failed    | 1      | 1     | AOS_REPLAY_PLAN_VALID               |
      | execution error | 1     | 1     | AOS_REPLAY_EXECUTION: Error: fixture execution failure |
      | missing format | 2      | 0     | rapport Messages de rejeu invalide |
      | wrong format   | 2      | 0     | rapport Messages de rejeu invalide |
      | extra format   | 2      | 0     | rapport Messages de rejeu invalide |
      | profile absent | 2      | 0     | précontrôle Cucumber impossible    |
      | no profile     | 2      | 0     | arguments de rejeu invalides       |
      | no report      | 2      | 0     | arguments de rejeu invalides       |
      | no locations   | 2      | 0     | arguments de rejeu invalides       |
      | extra          | 2      | 0     | scénario de rejeu inattendu : specs/second.feature:3 |
      | missing        | 2      | 0     | scénario de rejeu manquant : specs/green.feature:9999 |
      | duplicate      | 2      | 0     | scénario de rejeu répété           |
      | syntax         | 2      | 0     | sources de rejeu illisibles        |
      | shard          | 2      | 0     | profil de rejeu invalide           |
      | retry          | 2      | 0     | profil de rejeu invalide           |
      | dryRun         | 2      | 0     | profil de rejeu invalide           |
      | failFast       | 2      | 0     | profil de rejeu invalide           |
      | parallel       | 2      | 0     | profil de rejeu invalide           |
      | plugins        | 2      | 0     | profil de rejeu invalide           |

  Scenario: discovery requires the same original scenario and Gherkin failure step
    Then discovery cannot substitute another original identity or failing step

  Scenario: discovery honors the smaller command limit
    Then discovery stops a delayed child at the requested limit

  Scenario: a non-zero exit with fully successful steps supplies no discovery witness
    When the replay child returns "non-zero exit after completion"
    Then the replay of the observed report records:
      """
      {"badExit":true}
      """
