Feature: Test gate, rule 7 in check: the canary, then the replay record of every verdict check reads
  With a canary in gate.json, the mutants of each declared function must have its status, before any verdict on the
  code is read. With a replay in gate.json, every replayable mutant of the perimeter and of the canary needs an entry
  without divergence in the replay record of this very mutation report (SHA-256 of its text).

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"

  Scenario: a canary whose mutants have their declared status is green
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    And mutant "5" of the gate mutation report has the status "Killed"
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: a canary mutant with another status is red
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      7: canari src/math.mjs:7 EqualityOperator #5 : Survived, Killed attendu (isPositive)
      """

  Scenario: a canary mutant outside the declared functions is red
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed" }
      """
    And the gate mutation report keeps only the mutants "0, 1, 6"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: canari src/math.mjs:7 EqualityOperator #6 : hors des fonctions déclarées
      """

  Scenario: a declared function whose body has no BlockStatement mutant is red: its span is unknown
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    And the gate mutation report keeps only the mutants "0"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: canari src/math.mjs : fonction isPositive sans bloc muté
      """

  Scenario: a declared function absent from the canary is red
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed", "missing": "Killed" }
      """
    And mutant "5" of the gate mutation report has the status "Killed"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: canari src/math.mjs : fonction missing sans bloc muté
      """

  Scenario: a canary absent from the mutation report is red
    Given the gate configuration declares the canary "src/other.mjs" with:
      """
      { "sum": "Killed" }
      """
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: canari src/other.mjs absent du rapport de mutation
      """

  Scenario: an unreadable mutation report with rule 7 declared names it
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed" }
      """
    And the gate repository file "reports/mutation/mutation.json" is removed
    When the gate checks the "linux" job
    Then the gate violations of rule 7 are:
      """
      7: rapport de mutation illisible : ni canari ni rejeu
      """

  Scenario: the replay record of the report confirming every verdict is green
    Given the gate configuration declares the replay
    And the gate replay record of the mutation report confirms the mutants "0, 1"
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: the canary is replayed too: its verdicts need entries
    Given the gate configuration declares the replay
    And the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    And mutant "5" of the gate mutation report has the status "Killed"
    And the gate replay record of the mutation report confirms the mutants "0, 1, 2, 3, 4, 6"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: src/math.mjs:7 EqualityOperator #5 : non rejoué
      """

  Scenario Outline: the replay record decides: <case>
    Given the gate configuration declares the replay
    And the gate replay record <record>
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      7: <violation>
      """

    Examples:
      | case               | record                                                               | violation                                                                 |
      | absent             | is absent                                                            | rejeu des verdicts absent                                                 |
      | unreadable | reads "x" | rejeu des verdicts illisible : JSON invalide : Unexpected token 'x', "x" is not valid JSON |
      | of another report  | reads "{\"report\": \"0\", \"mutants\": []}"                       | le rejeu porte sur un autre rapport de mutation                           |
      | without the mutant | of the mutation report confirms the mutants "0"                      | src/math.mjs:3 ArithmeticOperator #1 : non rejoué                         |
      | with a divergence  | of the mutation report confirms every mutant but "1", with the divergence "écart" | src/math.mjs:3 ArithmeticOperator #1 : écart                              |

  Scenario: a perimeter without a replayable mutant needs no replay record
    Given the gate configuration declares the replay
    And the gate mutation report keeps only the mutants "5"
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: a NoCoverage mutant of the perimeter is red by rule 5 only: rule 7 has nothing to replay
    Given the gate configuration declares the replay
    And mutant "0" of the gate mutation report has the status "NoCoverage"
    And mutant "1" of the gate mutation report has the status "NoCoverage"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      5: src/math.mjs:2 BlockStatement #0 : NoCoverage
      5: src/math.mjs:3 ArithmeticOperator #1 : NoCoverage
      """

  Scenario: a replay record whose ids have several characters loads
    Given the gate configuration declares the replay
    And the gate replay record reads "{\"report\": \"0\", \"mutants\": [{\"file\": \"src/math.mjs\", \"id\": \"10\", \"status\": \"Killed\", \"divergence\": null}]}"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: le rejeu porte sur un autre rapport de mutation
      """

  Scenario: an absent mutation report with a replay declared names the report, not the replay
    Given the gate configuration declares the replay
    And the gate repository file "reports/mutation/mutation.json" is removed
    When the gate checks the "linux" job
    Then the gate violations of rule 7 are:
      """
      7: rapport de mutation illisible : ni canari ni rejeu
      """

  Scenario: the span of a function is its BlockStatement mutant, not the first mutant on its line
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    And mutant "5" of the gate mutation report has the status "Killed"
    And the gate mutation report has first a Killed StringLiteral mutant "9" on line 6 of "src/math.mjs"
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: a canary mutant before the declared function is outside it
    Given the gate configuration declares the canary "src/math.mjs" with:
      """
      { "isPositive": "Killed" }
      """
    And the gate mutation report keeps only the mutants "0, 2, 4"
    When the gate checks the "linux" job
    Then the gate violations are:
      """
      7: canari src/math.mjs:2 BlockStatement #0 : hors des fonctions déclarées
      """
