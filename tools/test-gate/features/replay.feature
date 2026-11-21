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

  Scenario Outline: the instrumented runner can exercise each replay selection decision
    When the instrumented runner exercises the replay selector with "<variant>"
    Then the replay selector exits with <status> and authorizes execution <calls> times with "<diagnostic>"

    Examples:
      | variant        | status | calls | diagnostic                         |
      | success        | 0      | 1     | AOS_REPLAY_PLAN_VALID               |
      | step failed    | 1      | 1     | AOS_REPLAY_PLAN_VALID               |
      | execution error | 1     | 1     | AOS_REPLAY_EXECUTION: Error: fixture execution failure |
      | missing format | 2      | 0     | rapport Messages de rejeu invalide |
      | wrong format   | 2      | 0     | rapport Messages de rejeu invalide |
      | extra format   | 2      | 0     | rapport Messages de rejeu invalide |
      | profile absent | 2      | 0     | précontrôle Cucumber impossible    |
      | no profile     | 2      | 0     | arguments de rejeu invalides       |
      | no report      | 2      | 0     | arguments de rejeu invalides       |
      | no locations   | 2      | 0     | arguments de rejeu invalides       |
      | extra          | 2      | 0     | scénario de rejeu inattendu        |
      | missing        | 2      | 0     | scénario de rejeu manquant         |
      | duplicate      | 2      | 0     | scénario de rejeu répété           |
      | syntax         | 2      | 0     | sources de rejeu illisibles        |
      | shard          | 2      | 0     | profil de rejeu invalide           |
      | retry          | 2      | 0     | profil de rejeu invalide           |
      | dryRun         | 2      | 0     | profil de rejeu invalide           |
      | failFast       | 2      | 0     | profil de rejeu invalide           |
      | parallel       | 2      | 0     | profil de rejeu invalide           |
      | plugins        | 2      | 0     | profil de rejeu invalide           |

  Scenario: a replay work directory outside the repository keeps using the installed engine
    When the replay writes its working files outside the repository
    Then the replay run passed within its limit

  Scenario: a truncated Messages file does not erase an execution error
    When the replay child fails after creating its Messages file
    Then the replay records the execution error from the child

  Scenario Outline: runner result reflects the actual Messages stream and process exit
    When the replay child returns "<variant>"
    Then the replay of the observed report records:
      """
      <result>
      """

    Examples:
      | variant                                 | result                                                                                                                                                                                               |
      | completed                               | {}                                                                                                                                                                                                   |
      | missing scenario                        | {"selection":"scénario de rejeu manquant : specs/second.feature:3"}                                                                                                                                  |
      | unexpected scenario                     | {"selection":"scénario de rejeu inattendu : specs/second.feature:3"}                                                                                                                                 |
      | repeated scenario                       | {"selection":"scénario de rejeu inattendu : specs/green.feature:4"}                                                                                                                                  |
      | foreign terminal                        | {"selection":"scénario de rejeu inattendu : null","failure":"fin Cucumber rattachée à un autre lot"}                                                                                                 |
      | duplicate completion                    | {"selection":"scénario de rejeu inattendu : null","failure":"lot Cucumber sans événement de fin unique"}                                                                                             |
      | unknown scenario location               | {"selection":"scénario de rejeu inattendu : null"}                                                                                                                                                   |
      | unfinished report                       | {"incomplete":true}                                                                                                                                                                                  |
      | unfinished report missing a scenario    | {"incomplete":true}                                                                                                                                                                                  |
      | non-zero exit after completion          | {"badExit":true}                                                                                                                                                                                     |
      | no preflight acknowledgement            | {"selection":"précontrôle Cucumber non confirmé"}                                                                                                                                                    |
      | explicit refusal                        | {"selection":"fixture refused","incomplete":true,"badExit":true,"failure":"cucumber-js n’a écrit aucun rapport : aucun diagnostic"}                                                                  |
      | two missing scenarios                   | {"selection":"scénario de rejeu manquant : specs/green.feature:12, specs/second.feature:3"}                                                                                                          |
      | refusal text with a different status    | {"selection":"précontrôle Cucumber non confirmé","incomplete":true,"badExit":true,"failure":"cucumber-js n’a écrit aucun rapport : aucun diagnostic"}                                                |
      | refusal with no diagnostic              | {"selection":"précontrôle Cucumber non confirmé","incomplete":true,"badExit":true,"failure":"cucumber-js n’a écrit aucun rapport : aucun diagnostic"}                                                |
      | crash without report                    | {"incomplete":true,"badExit":true,"failure":"cucumber-js n’a écrit aucun rapport : Error: fixture crash"}                                                                                            |
      | torn report with an unexpected scenario | {"selection":"scénario de rejeu inattendu : specs/second.feature:3","incomplete":true,"failure":"rapport Cucumber invalide : Expected property name or '}' in JSON at position 1 (line 1 column 2)"} |

  Scenario: replacing the worktree selector cannot sabotage the independent replay harness
    When the runner snapshots the selector and then the worktree copy is replaced
    Then the replay run passed within its limit

  Scenario: a static survivor is replayed in one lot and the collector verifies the exact union
    Given the gate mutation fixture declares its independent mutation profile
    And the gate mutation report keeps only the mutants "0, 5"
    And mutant "5" of the gate mutation report is static
    And the gate report includes a second file with one surviving mutant
    When the gate replays mutation lot "1"
    Then the gate exits with 0
    When the gate replays mutation lot "2"
    Then the gate exits with 0
    When the gate collects the mutation replay lots
    Then the gate exits with 0
    And the gate output includes "lots de rejeu vérifiés : 3 mutant(s)"
    And the gate replay record is:
      """
      src/math.mjs #0 Killed : confirmé
      src/math.mjs #5 Survived : confirmé
      src/other.mjs #other-5 Survived : confirmé
      """
    And replay lot "1" contains just "src/math.mjs"
    And replay lot "2" contains just "src/other.mjs"
    Given the gate copies the first replay receipt into the second lot
    When the gate collects the mutation replay lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : lot de rejeu 2 : src/other.mjs:7 EqualityOperator #other-5 : non rejoué
      src/math.mjs #0 : rejeu hors périmètre
      src/math.mjs #5 : rejeu hors périmètre
      """
    And the gate replay record is absent
    Given the gate removes replay lot "2"
    When the gate collects the mutation replay lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : lot de rejeu absent : 2
      """
    And the gate replay record is absent
    When the gate replays mutation lot "2"
    Then the gate exits with 0
    Given the gate appends a newline to the mutation report
    When the gate collects the mutation replay lots
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : lot de rejeu 1 : le rejeu porte sur un autre rapport de mutation
      """
    And the gate replay record is absent

  Scenario Outline: a replay lot with unreadable debt cannot retain an older receipt
    Given the gate mutation fixture declares its independent mutation profile
    And the gate mutation report keeps only the mutants "5"
    And the gate repository file "reports/replay-shards/1/replay.json" reads:
      """
      {"previous":true}
      """
    And the debt registry is unreadable in the "<revision>"
    When the gate replays mutation lot "1"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : registre de dette illisible
      """
    And the gate repository holds no file "reports/replay-shards/1/replay.json"

    Examples:
      | revision     |
      | working tree |
      | first parent |

  Scenario: a truncated static scenario catalogue is rejected before replay
    Given the gate mutation fixture declares its independent mutation profile
    And the gate mutation report keeps only the mutants "5"
    And mutant "5" of the gate mutation report is static
    And the gate removes a scenario from the mutation report catalogue
    When the gate replays mutation lot "1"
    Then the gate exits with 1
    And the gate output includes "catalogue des scénarios de mutation différent"

  Scenario: a static verdict must carry the activation mode
    Given the gate mutation fixture declares its independent mutation profile
    And the gate mutation report keeps only the mutants "5"
    And the static field of mutant "5" of the gate mutation report is absent
    When the gate replays mutation lot "1"
    Then the gate exits with 1
    And the gate output includes "marquage statique absent"

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
      src/math.mjs #0 Killed : témoin : précontrôle Cucumber impossible
      src/math.mjs #5 Survived : précontrôle Cucumber impossible
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

  Scenario: the replay refuses another scenario added by the Cucumber profile
    Given the gate repository file "cucumber.mjs" reads:
      """
      export default {};
      export const replay = { import: ['specs/steps/*.mjs'], paths: ['specs/second.feature'] };
      """
    When the replay runner runs "specs/green.feature:4" once within 20000 ms
    Then the replay refuses its scenario selection with "scénario de rejeu inattendu : specs/second.feature:3"

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

  Scenario: a completed replay that skipped a selected scenario cannot confirm a kill
    Given the gate repository file "cucumber.mjs" reads:
      """
      export default {};
      export const replay = { import: ['specs/steps/*.mjs'], tags: '@no-scenario-has-this-tag' };
      """
    When the replay runner runs "specs/green.feature:4" once within 20000 ms
    Then the replay refuses its scenario selection with "scénario de rejeu manquant : specs/green.feature:4"
