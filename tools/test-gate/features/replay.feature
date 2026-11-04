Feature: Test gate, rule 7: the verdicts of the mutation tool are replayed, never trusted
  `test-gate replay` writes each mutant into the tree and runs the scenarios the tool named with cucumber-js itself.
  Killed, Timeout, RuntimeError (detections): the scenarios pass cleanly on the original (control) and not on the
  mutant, by a failed step, a crash, or a run past three times the control plus ten seconds; when the named killers
  of a Killed mutant pass, its covering scenarios decide. Survived: its covering scenarios pass cleanly on the mutant.
  Ignored and static: all the scenarios of the report. Any contradiction is a divergence; check makes it red.
  The replays below run the real cucumber-js on the fixture suite: in survivor.json, #1 and #3 are Killed by an
  edit (fixtures/README.md) while the real Stryker run let them survive. The replay finds both.

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate repository can run the fixture suite with cucumber-js
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate configuration declares the replay
    And the gate mutation report is the fixture "survivor"

  Scenario: every mutant is replayed: the two edited kills diverge, the file is written back
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate output is:
      """
      rejeu : 7 mutant(s), 2 divergence(s) -> reports/mutation/replay.json
      - src/math.mjs #1 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      - src/math.mjs #3 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      """
    And the gate replay record is:
      """
      src/math.mjs #0 Killed : confirmé
      src/math.mjs #1 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      src/math.mjs #2 Killed : confirmé
      src/math.mjs #3 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      src/math.mjs #4 Killed : confirmé
      src/math.mjs #5 Survived : confirmé
      src/math.mjs #6 Killed : confirmé
      """
    And the gate repository file "src/math.mjs" is the one of the mutation fixture "survivor"
    And the gate replay ran 11 cucumber-js runs

  Scenario: the control runs once per set of scenarios, a survivor needs none, a second replay starts afresh
    Given the gate mutation report keeps only the mutants "0, 2, 5"
    When the gate replays every mutant of the mutation report
    Then the gate exits with 0
    And the gate output is:
      """
      rejeu : 3 mutant(s), 0 divergence(s) -> reports/mutation/replay.json
      """
    And the gate replay ran 4 cucumber-js runs
    Given the gate mutation report keeps only the mutants "5"
    When the gate replays every mutant of the mutation report
    Then the gate replay ran 1 cucumber-js run

  Scenario: a survivor the scenarios kill diverges
    Given the gate mutation report keeps only the mutants "4"
    And mutant "4" of the gate mutation report has the status "Survived"
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate replay record is:
      """
      src/math.mjs #4 Survived : Survived selon l'outil, mais sur le mutant : ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]] : FAILED, ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["2"]] : FAILED, ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : FAILED
      """

  Scenario: a broken test command confirms no kill: the control fails on the original
    Given the gate mutation report keeps only the mutants "0"
    And the gate repository file "specs/steps/steps.mjs" is removed
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate replay record is:
      """
      src/math.mjs #0 Killed : témoin : ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]] : UNDEFINED
      """

  Scenario: a test command that writes no report confirms nothing
    Given the gate mutation report keeps only the mutants "0, 5"
    And the gate replay profile is "absent"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #0 Killed : témoin : cucumber-js n’a écrit aucun rapport : Error: Requested profile "absent" doesn't exist
      src/math.mjs #5 Survived : Survived selon l'outil, mais sur le mutant : cucumber-js n’a écrit aucun rapport : Error: Requested profile "absent" doesn't exist
      """

  Scenario: a file that differs from the report is never mutated
    Given the gate mutation report keeps only the mutants "0"
    And the gate repository file "src/math.mjs" reads:
      """
      export const changed = true;
      """
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #0 Killed : le fichier du dépôt diffère de celui du rapport de mutation
      """
    And the gate replay ran 0 cucumber-js runs

  Scenario Outline: a mutant whose scenarios cannot be named is a divergence: <case>
    Given the gate mutation report keeps only the mutants "<id>"
    And the <field> of mutant "<id>" of the gate mutation report are "<ids>"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #<id> <status> : <divergence>
      """
    And the gate replay ran 0 cucumber-js runs

    Examples:
      | case             | id | status   | field     | ids  | divergence                                 |
      | unknown test     | 0  | Killed   | killedBy  | 1, 9 | test(s) inconnu(s) du rapport : 9          |
      | no killer        | 0  | Killed   | killedBy  |      | Killed sans scénario nommé par l'outil     |
      | no covering test | 5  | Survived | coveredBy |      | Survived sans scénario nommé par l'outil   |

  Scenario: a static mutant is replayed against every scenario of the report
    Given the gate mutation report keeps only the mutants "5"
    And the coveredBy of mutant "5" of the gate mutation report are ""
    And mutant "5" of the gate mutation report is static
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #5 Survived : confirmé
      """

  Scenario Outline: a Killed mutant whose named killer passes is decided by its covering scenarios: <case>
    Given the gate mutation report keeps only the mutants "4"
    And the killedBy of mutant "4" of the gate mutation report are "0"
    And the coveredBy of mutant "4" of the gate mutation report are "<covering>"
    And mutant "4" of the gate mutation report <static>
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #4 Killed : <divergence>
      """
    And the gate replay ran <runs> cucumber-js runs

    Examples:
      | case                            | covering | static           | divergence                                                | runs |
      | one of them kills               | 0, 1     | is not static    | confirmé                                                  | 4    |
      | none kills                      | 0        | is not static    | Killed selon l'outil, les scénarios passent sur le mutant | 3    |
      | static: all the scenarios decide |         | is static        | confirmé                                                  | 4    |

  Scenario Outline: an Ignored mutant is replayed against every scenario of the report: <id>
    Given the gate mutation report keeps only the mutants "<id>"
    And mutant "<id>" of the gate mutation report has the status "Ignored"
    And the coveredBy of mutant "<id>" of the gate mutation report are ""
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #<id> Ignored : <divergence>
      """

    Examples:
      | id | divergence                                    |
      | 5  | confirmé                                      |
      | 6  | Ignored selon l'outil, mais sur le mutant : ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]] : FAILED, ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["2"]] : FAILED, ["specs/second.feature","Second green fixture",null,"another passing scenario",null,null] : FAILED |

  Scenario: a Timeout mutant whose run hangs is confirmed at three times its control plus ten seconds
    Given the gate mutation report keeps only the mutants "0"
    And mutant "0" of the gate mutation report has the status "Timeout"
    And mutant "0" of the gate mutation report is replaced by "{ const end = Date.now() + 60000; while (Date.now() < end); }"
    When the gate replays every mutant of the mutation report
    Then the gate exits with 0
    And the gate replay record is:
      """
      src/math.mjs #0 Timeout : confirmé
      """

  Scenario: a survivor whose run hangs past the limit of gate.json diverges: it has no control to bound it
    Given the gate mutation report keeps only the mutants "0"
    And mutant "0" of the gate mutation report has the status "Survived"
    And mutant "0" of the gate mutation report is replaced by "{ const end = Date.now() + 60000; while (Date.now() < end); }"
    And the gate replay limit is 3000 ms
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #0 Survived : Survived selon l'outil, mais sur le mutant : délai dépassé
      """
    And the gate replay took less than 9 seconds

  Scenario: without --all only the perimeter is replayed: the mutants that meet the changed lines
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate replays the mutation report
    Then the gate output is:
      """
      rejeu : 5 mutant(s), 1 divergence(s) -> reports/mutation/replay.json
      - src/math.mjs #3 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      """

  Scenario: without --all the canary is replayed too, and a wrong canary status fails the replay
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    When the gate replays the mutation report
    Then the gate exits with 1
    And the gate output is:
      """
      rejeu : 7 mutant(s), 2 divergence(s) -> reports/mutation/replay.json
      - src/math.mjs #1 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      - src/math.mjs #3 Killed : Killed selon l'outil, les scénarios passent sur le mutant
      - canari src/math.mjs:7 EqualityOperator #5 : Survived, Killed attendu (isPositive)
      """

  Scenario: a canary that holds and confirmed verdicts: exit 0
    Given the gate mutation report keeps only the mutants "0, 2, 4"
    And the gate configuration declares the canary "src/math.mjs" with:
      """
      { "sum": "Killed", "isPositive": "Killed" }
      """
    When the gate replays the mutation report
    Then the gate exits with 0

  Scenario Outline: replay refuses what it cannot read: <case>
    Given the gate repository file "<path>" <state>
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : <message>
      """
    And the gate replay record is absent

    Examples:
      | case             | path                           | state      | message                                                                |
      | no report        | reports/mutation/mutation.json | is removed | rapport de mutation illisible : reports/mutation/mutation.json absent |

  Scenario: replay refuses a malformed report
    Given the gate mutation report reads:
      """
      {"files": 1}
      """
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate output starts with "porte de test : rapport de mutation illisible : hors schéma : "

  Scenario: replay refuses a configuration without a replay
    Given the gate configuration reads:
      """
      {"production": {"include": ["src/**/*.mjs"], "exclude": []}, "features": {"include": ["specs/**/*.feature"], "exclude": []}, "jobs": {}, "debt": "mutation-debt.json", "reports": {"cucumber": "c", "mutation": "m", "base": "b", "plan": "p", "report": "r", "baseOut": "o"}}
      """
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : tools/test-gate/gate.json ne déclare pas de rejeu
      """

  Scenario: the mutant of a report is the text between its start and end replaced, across lines
    When the gate applies mutant "0" of the mutation fixture "survivor" to "src/math.mjs"
    Then the mutated source is:
      """
      // Production file of the fixture suite: the mutation fixtures are reports of Stryker runs on it.
      export function sum(a, b) {}

      export function isPositive(n) {
        return n > 0;
      }
      """
    When the gate applies mutant "5" of the mutation fixture "survivor" to "src/math.mjs"
    Then the mutated source is:
      """
      // Production file of the fixture suite: the mutation fixtures are reports of Stryker runs on it.
      export function sum(a, b) {
        return a + b;
      }

      export function isPositive(n) {
        return n >= 0;
      }
      """

  Scenario Outline: the limit of a run with a control is three times the control plus ten seconds, in whole ms: <control>
    Then the detect limit of a control of <control> ms is <limit> ms

    Examples:
      | control | limit |
      | 2000    | 16000 |
      | 0.5     | 10002 |

  Scenario: --all replays what lies outside the perimeter, the replay without it does not
    Given the gate first parent is committed
    And the gate head is committed
    And the gate mutation report keeps only the mutants "0, 5"
    When the gate replays the mutation report
    Then the gate output is:
      """
      rejeu : 0 mutant(s), 0 divergence(s) -> reports/mutation/replay.json
      """
    When the gate replays every mutant of the mutation report
    Then the gate output is:
      """
      rejeu : 2 mutant(s), 0 divergence(s) -> reports/mutation/replay.json
      """

  Scenario: a file of the report outside the perimeter is not replayed
    Given the gate mutation report keeps only the mutants "3"
    And the gate mutation report copies "src/math.mjs" to "src/other.mjs"
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And mutant "3" of the gate mutation report has the status "Survived"
    When the gate replays the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #3 Survived : confirmé
      """

  Scenario: a NoCoverage mutant is not replayed
    Given the gate mutation report is the fixture "nocoverage"
    And the gate mutation report keeps only the mutants "4, 5"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #4 Killed : confirmé
      """

  Scenario Outline: a RuntimeError mutant is replayed over its covering scenarios like a kill: #<id>
    Given the gate mutation report keeps only the mutants "<id>"
    And mutant "<id>" of the gate mutation report has the status "RuntimeError"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #<id> RuntimeError : <divergence>
      """
    And the gate replay ran 2 cucumber-js runs

    Examples:
      | id | divergence                                                      |
      | 4  | confirmé                                                        |
      | 5  | RuntimeError selon l'outil, les scénarios passent sur le mutant |

  Scenario: several unknown test ids are all named
    Given the gate mutation report keeps only the mutants "0"
    And the killedBy of mutant "0" of the gate mutation report are "8, 1, 9"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #0 Killed : test(s) inconnu(s) du rapport : 8, 9
      """

  Scenario Outline: a report written without the optional field <field> reads as none: <divergence>
    Given the gate mutation report keeps only the mutants "<id>"
    And mutant "<id>" of the gate mutation report has the status "<status>"
    And the coveredBy of mutant "<id>" of the gate mutation report are "0"
    And the <field> field of mutant "<id>" of the gate mutation report is absent
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #<id> <status> : <divergence>
      """

    Examples:
      | field     | id | status   | divergence                                 |
      | static    | 4  | Survived | confirmé                                   |
      | killedBy  | 0  | Killed   | Killed sans scénario nommé par l'outil     |
      | coveredBy | 5  | Survived | Survived sans scénario nommé par l'outil   |

  Scenario: a wrong canary fails the replay even when every verdict is confirmed
    Given the gate mutation report keeps only the mutants "5"
    And the gate configuration declares the canary "src/math.mjs" with:
      """
      { "isPositive": "Killed" }
      """
    When the gate replays every mutant of the mutation report
    Then the gate exits with 1
    And the gate output is:
      """
      rejeu : 1 mutant(s), 0 divergence(s) -> reports/mutation/replay.json
      - canari src/math.mjs : fonction isPositive sans bloc muté
      - canari src/math.mjs:7 EqualityOperator #5 : hors des fonctions déclarées
      """

  Scenario: a killed mutant that hangs is detected, its run stopped at three times its control plus ten seconds
    Given the gate mutation report keeps only the mutants "0"
    And mutant "0" of the gate mutation report is replaced by "{ const end = Date.now() + 60000; while (Date.now() < end); }"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #0 Killed : confirmé
      """
    And the gate replay took less than 40 seconds
    And the gate replay ran 3 cucumber-js runs

  Scenario: the replay runner measures each run and kills what the run left behind
    Given the gate repository holds a scenario that leaves a child process behind
    When the replay runner runs "specs/orphan.feature:3" once within 600000 ms
    Then the replay runner measured the run, within its wall time
    And the child process left behind is gone
    And the replay runner left no file descriptor open

  Scenario: a run that writes a megabyte to its standard output is not blocked by it
    Given the gate repository holds a scenario that writes a megabyte to its standard output
    When the replay runner runs "specs/chatty.feature:3" once within 20000 ms
    Then the replay run passed within its limit

  Scenario: a detection by a run that breaks the environment is not confirmed: the fresh control after it fails
    Given the gate mutation report keeps only the mutants "0"
    And mutant "0" of the gate mutation report is replaced by "{ process.getBuiltinModule('node:fs').rmSync('specs/steps/steps.mjs'); process.exit(3); }"
    When the gate replays every mutant of the mutation report
    Then the gate replay record is:
      """
      src/math.mjs #0 Killed : témoin après coup : ["specs/green.feature","Green fixture",null,"an outline with <value>","small values",["1"]] : UNDEFINED
      """
    And the gate replay ran 3 cucumber-js runs
