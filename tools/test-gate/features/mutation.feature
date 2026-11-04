Feature: Test gate, rule 5: no surviving mutant in the perimeter
  The perimeter holds the mutants of production files whose location meets a line changed since the first parent.
  A changed test extends nothing: the full run off the path of a change sees what it stops killing.
  Survived, NoCoverage and Pending are red; Killed, Timeout and RuntimeError pass (rule 7 replays them);
  CompileError has no verdict and is red; Ignored passes only under a justified next-line directive. The mutation fixtures derive from a real
  Stryker 10.1.1 report of tools/test-gate/fixtures/suite/src/math.mjs (fixtures/README.md).

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"

  Scenario: a surviving mutant on a changed line is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : Survived
      """
    And the gate mutation section reads:
      """
      ## Mutation

      - fichiers du périmètre : 1
      - mutants du périmètre : 5
        - Killed : 4
        - Survived : 1
      - mutants sans verdict (rouges) :
        - aucun
      """

  Scenario: a surviving mutant outside the changed lines is not in the perimeter: green
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate mutation section reads:
      """
      ## Mutation

      - fichiers du périmètre : 1
      - mutants du périmètre : 2
        - Killed : 2
      - mutants sans verdict (rouges) :
        - aucun
      """

  Scenario: a mutant no test covers, on a changed line, is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "nocoverage" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "nocoverage"
    And the gate head is committed
    And the gate mutation report is the fixture "nocoverage"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : NoCoverage
      """

  Scenario Outline: the status of a mutant in the perimeter decides: <status> is <verdict>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is "<verdict>"
    And the gate violations of rule 5 are:
      """
      <violation>
      """

    Examples:
      | status     | verdict | violation                                                                                                  |
      | Survived   | red     | 5: src/math.mjs:7 EqualityOperator #5 : Survived                                                           |
      | NoCoverage | red     | 5: src/math.mjs:7 EqualityOperator #5 : NoCoverage                                                         |
      | Pending    | red     | 5: src/math.mjs:7 EqualityOperator #5 : Pending                                                            |
      | Killed     | green   |                                                                                                            |
      | Timeout    | green   |                                                                                                            |
      | Ignored    | red     | 5: src/math.mjs:7 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |

  Scenario Outline: a mutant the tool could not compile, in the perimeter, is red: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : <status>, mutant sans verdict
      """
    And the gate mutation section reads:
      """
      ## Mutation

      - fichiers du périmètre : 1
      - mutants du périmètre : 5
        - <first>
        - <second>
      - mutants sans verdict (rouges) :
        - src/math.mjs:7 EqualityOperator #5 : <status>
      """

    Examples:
      | status       | first            | second     |
      | CompileError | CompileError : 1 | Killed : 4 |

  Scenario: a RuntimeError mutant in the perimeter is not red by rule 5: the replay of rule 7 decides
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "RuntimeError"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate mutation section reads:
      """
      ## Mutation

      - fichiers du périmètre : 1
      - mutants du périmètre : 5
        - Killed : 4
        - RuntimeError : 1
      - mutants sans verdict (rouges) :
        - aucun
      """

  Scenario: a Stryker disable all directive in a production file of the perimeter is red, and so is every mutant it hides
    Given the gate repository holds "src/math.mjs" of the mutation fixture "disable-all" with line 8 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "disable-all"
    And the gate head is committed
    And the gate mutation report is the fixture "disable-all"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:2 : directive Stryker refusée : // Stryker disable all
      5: src/math.mjs:7 BlockStatement #2 : Ignored sans justification « équivalent » sur la ligne précédente
      5: src/math.mjs:8 ConditionalExpression #3 : Ignored sans justification « équivalent » sur la ligne précédente
      5: src/math.mjs:8 ConditionalExpression #4 : Ignored sans justification « équivalent » sur la ligne précédente
      5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente
      5: src/math.mjs:8 EqualityOperator #6 : Ignored sans justification « équivalent » sur la ligne précédente
      """

  Scenario: a next-line directive without the équivalent justification is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "disable-unjustified" with line 8 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "disable-unjustified"
    And the gate head is committed
    And the gate mutation report is the fixture "disable-unjustified"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 : directive Stryker refusée : // Stryker disable next-line EqualityOperator: n is never 0
      5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente
      """

  Scenario: a justified equivalent mutant is green: the gate judges the form, the review the equivalence
    Given the gate repository holds "src/math.mjs" of the mutation fixture "equivalent" with line 8 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "equivalent"
    And the gate head is committed
    And the gate mutation report is the fixture "equivalent"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "  - Ignored : 1"

  Scenario Outline: the form of the line above an ignored mutant: <form>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "equivalent" with line 8 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "equivalent"
    And the gate head is committed
    And the gate mutation report is the fixture "equivalent"
    And line 7 of "src/math.mjs" reads "<line>" in the gate mutation report and in the working tree
    When the gate checks the "linux" job
    Then the gate verdict is "<verdict>"
    And the gate violations are:
      """
      <directive>
      <ignored>
      """

    Examples:
      | form                         | line                                                                                    | verdict | directive                                                                                                             | ignored                                                                                          |
      | one mutator                  |     // Stryker disable next-line EqualityOperator: équivalent: n > 0 et n >= 0 coïncident ici | green   |                                                                                                                       |                                                                                                  |
      | not indented, two mutators   | // Stryker disable next-line ConditionalExpression,EqualityOperator: équivalent: idem    | green   |                                                                                                                       |                                                                                                  |
      | another mutator              |   // Stryker disable next-line ConditionalExpression: équivalent: idem                  | red     |                                                                                                                       | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |
      | no mutator                   |   // Stryker disable next-line : équivalent: idem                                       | red     | 5: src/math.mjs:7 : directive Stryker refusée : // Stryker disable next-line : équivalent: idem                       | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |
      | no invariant                 |   // Stryker disable next-line EqualityOperator: équivalent:                            | red     | 5: src/math.mjs:7 : directive Stryker refusée : // Stryker disable next-line EqualityOperator: équivalent:            | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |
      | no next-line                 |   // Stryker disable EqualityOperator: équivalent: idem                                 | red     | 5: src/math.mjs:7 : directive Stryker refusée : // Stryker disable EqualityOperator: équivalent: idem                 | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |
      | block comment                |   /* Stryker disable next-line EqualityOperator: équivalent: idem */                    | red     | 5: src/math.mjs:7 : directive Stryker refusée : /* Stryker disable next-line EqualityOperator: équivalent: idem */    | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |
      | code before the comment      |   void 0; // Stryker disable next-line EqualityOperator: équivalent: idem               | red     | 5: src/math.mjs:7 : directive Stryker refusée : void 0; // Stryker disable next-line EqualityOperator: équivalent: idem | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |
      | no directive at all          |   // nothing to see here                                                                | red     |                                                                                                                       | 5: src/math.mjs:8 EqualityOperator #5 : Ignored sans justification « équivalent » sur la ligne précédente |

  Scenario: an ignored mutant on the first line has no line above: red
    Given the gate first parent is committed
    And the gate head is committed
    And the gate mutation report reads:
      """
      {"files":{"src/first.mjs":{"language":"javascript","source":"export const twice = (n) => n + n;","mutants":[{"id":"0","mutatorName":"ArithmeticOperator","replacement":"x","status":"Ignored","location":{"start":{"line":1,"column":29},"end":{"line":1,"column":34}}}]}},"testFiles":{},"config":{"mutate":["src/first.mjs"]}}
      """
    And the gate repository file "src/first.mjs" reads:
      """
      export const twice = (n) => n + n;
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/first.mjs:1 ArithmeticOperator #0 : Ignored sans justification « équivalent » sur la ligne précédente
      """

  Scenario: an untracked production file is wholly changed, up to its last line without newline
    Given the gate first parent is committed
    And the gate head is committed
    And the gate mutation report reads:
      """
      {"files":{"src/first.mjs":{"language":"javascript","source":"export const twice = (n) => n + n;","mutants":[{"id":"0","mutatorName":"ArithmeticOperator","replacement":"x","status":"Survived","coveredBy":[],"location":{"start":{"line":1,"column":29},"end":{"line":1,"column":34}}}]}},"testFiles":{},"config":{"mutate":["src/first.mjs"]}}
      """
    And the gate repository file "src/first.mjs" reads:
      """
      export const twice = (n) => n + n;
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/first.mjs:1 ArithmeticOperator #0 : Survived
      """

  Scenario: a production file of the perimeter missing from the mutation report is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs : fichier du périmètre absent du rapport de mutation
      """

  Scenario: a file Stryker was asked to mutate and found no mutant in is not missing
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "no-mutant"
    When the gate checks the "linux" job
    Then the gate verdict is green

  Scenario: an absent mutation report is red when the perimeter is not empty
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: a mutation report out of its schema is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report reads:
      """
      {"files":{"src/math.mjs":{"source":"","mutants":[{"id":"0","mutatorName":"X","replacement":"x","status":"Lost","location":{"start":{"line":1,"column":1},"end":{"line":1,"column":2}}}]}},"testFiles":{},"config":{"mutate":[]}}
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : hors schéma : ✖ Invalid option: expected one of "Killed"|"Survived"|"NoCoverage"|"CompileError"|"RuntimeError"|"Timeout"|"Ignored"|"Pending"   → at files["src/math.mjs"].mutants[0].status
      """

  Scenario: a mutant without replacement makes the mutation report unreadable
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report reads:
      """
      {"files":{"src/math.mjs":{"source":"","mutants":[{"id":"0","mutatorName":"X","status":"Killed","location":{"start":{"line":1,"column":1},"end":{"line":1,"column":2}}}]}},"testFiles":{},"config":{"mutate":[]}}
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : hors schéma : ✖ Invalid input: expected string, received undefined   → at files["src/math.mjs"].mutants[0].replacement
      """

  Scenario Outline: a mutant whose position leaves the text of its file makes the mutation report unreadable: the <edge> line is <line>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And the <edge> line of mutant "5" of the gate mutation report is <line>
    When the gate checks the "linux" job
    Then the gate verdict is "<verdict>"
    And the gate violations are:
      """
      <violation>
      """

    Examples:
      | edge  | line | verdict | violation                                                                                                      |
      | end   | 9    | red     | 5: src/math.mjs:7 EqualityOperator #5 : Survived                                                                |
      | end   | 10   | red     | 5: rapport de mutation illisible : hors schéma : ✖ un mutant sort du texte de son fichier   → at files["src/math.mjs"] |
      | start | 9    | green   |                                                                                                                  |
      | start | 10   | red     | 5: rapport de mutation illisible : hors schéma : ✖ un mutant sort du texte de son fichier   → at files["src/math.mjs"] |

  Scenario: nothing changed in production nor in tests: an empty perimeter needs no mutation report
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- fichiers du périmètre : 0"

  Scenario: a deleted .feature touches no test: the perimeter stays empty
    Given the gate repository holds the fixture specs "green.feature, second.feature, duplicate.feature"
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- fichiers du périmètre : 0"

  Scenario: a changed .feature extends nothing: the perimeter stays empty
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds the fixture specs "green.feature"
    And the gate first parent is committed
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate report has the line "- fichiers du périmètre : 0"
    And the gate violations of rule 5 are:
      """
      """

  Scenario: changed step definitions extend nothing: the perimeter stays empty
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository file "specs/steps/steps.mjs" reads:
      """
      export const version = 1;
      """
    And the gate first parent is committed
    And the gate repository file "specs/steps/steps.mjs" reads:
      """
      export const version = 2;
      """
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate report has the line "- fichiers du périmètre : 0"
