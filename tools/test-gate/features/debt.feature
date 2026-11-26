Feature: Test gate, rule 6: the mutation debt registry only shrinks
  gate.json `debt` names the registry of the surviving mutants of the code that predates brick 1a. A Survived or
  NoCoverage mutant of the rule 5 perimeter whose identity (`file:l:c-l:c mutator "original" -> "replacement"`) is in
  the registry is accepted; rule 6 asks the registry to be readable, to be created once and then only shrink, a
  removal to be proved by the mutation report, and every entry to still match a surviving mutant. The mutation
  fixtures derive from a real Stryker 10.1.1 report of tools/test-gate/fixtures/suite/src/math.mjs, the registries
  from them (fixtures/README.md). Every disposable repository starts with the empty registry at the `debt` path.

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"

  Scenario: a surviving mutant of the perimeter that the registry holds is accepted
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
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

  Scenario: a surviving mutant of the perimeter that the empty registry does not hold stays red by rule 5
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
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario Outline: a registered mutant is accepted when NoCoverage and never when Pending: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is "<verdict>"
    And the gate violations are:
      """
      <rule 5>
      <rule 6>
      """

    Examples:
      | status     | verdict | rule 5                                            | rule 6                                                                                                                                      |
      | NoCoverage | green   |                                                   |                                                                                                                                             |
      | Pending    | red     | 5: src/math.mjs:7 EqualityOperator #5 : Pending   |                                                                                                                                             |

  Scenario Outline: an entry that differs from the surviving mutant by one field does not accept it: <field>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor" with "<field>" of its entry 1 set to "<value>"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : Survived
      6: <identity> : introuvable (code supprimé ou déplacé), à retirer dans la même PR
      """

    Examples:
      | field        | value                | identity                                                           |
      | replacement  | n >= 1               | src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 1"       |
      | mutator      | RelationalOperator   | src/math.mjs:7:10-7:15 RelationalOperator "n > 0" -> "n >= 0"      |

  Scenario Outline: an entry whose text is not between its start and its end is misaligned, and by no other check: <field>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor" with "<field>" of its entry 1 set to "<value>"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: src/math.mjs:7 EqualityOperator #5 : Survived
      6: <identity> : désalignée (le code a bougé), lancer « test-gate debt realign »
      """

    Examples:
      | field        | value | identity                                                     |
      | end.column   | 16                   | src/math.mjs:7:10-7:16 EqualityOperator "n > 0" -> "n >= 0"       |
      | start.column | 9                    | src/math.mjs:7:9-7:15 EqualityOperator "n > 0" -> "n >= 0"        |
      | start.line   | 6                    | src/math.mjs:6:10-7:15 EqualityOperator "n > 0" -> "n >= 0"        |
      | end.line     | 8                    | src/math.mjs:7:10-8:15 EqualityOperator "n > 0" -> "n >= 0"        |
      | original     | n > 1                | src/math.mjs:7:10-7:15 EqualityOperator "n > 1" -> "n >= 0"       |
      | start.line   | 40    | src/math.mjs:40:10-7:15 EqualityOperator "n > 0" -> "n >= 0" |

  Scenario Outline: the original of a multi-line mutant is the text between its start and its end, lines included: <mutant>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line <line> changed
    And the gate debt registry is the fixture "<registry>"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "<mutant>" of the gate mutation report has the status "Survived"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

    Examples:
      | mutant | line | registry |
      | 0      | 3    | block-0  |
      | 2      | 6    | block-2  |

  Scenario: a multi-line mutant that ends before the end of its last line has only the text up to its end as original
    Given the gate repository holds "src/math.mjs" of the mutation fixture "partial-line" with line 3 changed
    And the gate debt registry is the fixture "partial-line"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "partial-line"
    And the gate head is committed
    And the gate mutation report is the fixture "partial-line"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate output includes "mutant actif hors lot : 9"
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: native whole-file instrumentation does not claim to cover debt outside the changed lines
    Given the gate repository holds "src/math.mjs" of the mutation fixture "partial-line" with line 1 changed
    And the gate debt registry is the fixture "partial-line"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "partial-line"
    And the gate head is committed
    And the gate mutation report is the fixture "partial-line"
    And the projected native report has no mutants on the changed line
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation

  Scenario: an earlier partial projection of the same file cannot prove debt retirement
    Given the gate repository holds "src/math.mjs" of the mutation fixture "partial-line"
    And the gate debt registry is the fixture "partial-line"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate repository file "reports/mutation/mutation.json" reads:
      """
      {"files":{},"config":{"mutate":["src/math.mjs"]},"gateNativeScope":[{"file":"src/math.mjs","whole":false,"lines":[1]}]}
      """
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate output includes "retrait non prouvé"

  Scenario: a single-line mutant on the first line of its file is identified from the first line of the source
    Given the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature" with line 1 changed
    And the gate debt registry is the fixture "a-survivor"
    And the gate first parent is committed
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate head is committed
    And the gate mutation report is the fixture "covered-by-feature"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an entry added to the registry is red by rule 6 alone, although the mutant it names really survives
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : entrée ajoutée au registre, le registre ne peut que rétrécir
      """
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      """

  Scenario: the diff that creates the registry is green and says so
    Given the gate debt registry is absent
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      - création du registre par ce diff (le premier parent n'en a pas)
      """

  Scenario: a repository of one commit creates the registry too
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      - création du registre par ce diff (le premier parent n'en a pas)
      """

  Scenario: the registry is absent from the working tree and held by the first parent: unreadable
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is absent
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible : mutation-debt.json absent
      """

  Scenario: the registry is absent from the working tree and from the first parent: unreadable
    Given the gate debt registry is absent
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible : mutation-debt.json absent
      """

  Scenario: a registry that is not JSON is unreadable
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry reads:
      """
      {"survivors": [
      """
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations of rule 6 start with "registre de dette illisible : JSON invalide : "

  Scenario Outline: a registry that does not match its schema is unreadable: <registry>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "<registry>"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible : hors schéma : <failure>
      """

    Examples:
      | registry        | failure                                                                           |
      | unknown-key     | ✖ Unrecognized key: "extra"                                                       |
      | negative-column | ✖ Too small: expected number to be >=0   → at survivors[0].start.column          |

  Scenario: a registry of the first parent that does not match its schema is red, the current one being fine
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "unknown-key"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: registre de dette illisible au premier parent : hors schéma : ✖ Unrecognized key: "extra"
      """

  Scenario: a registry of the first parent that is not JSON is red, the current one being fine
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry reads:
      """
      not json
      """
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations of rule 6 start with "registre de dette illisible au premier parent : JSON invalide : "

  Scenario: an entry removed because the debt is paid is green once the report shows its mutant killed
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "Killed"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 1
      """

  Scenario: the plan of a diff that only removes an entry holds the file of that entry
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 1 }, "mutate": ["src/math.mjs"] }
      """

  Scenario: a changed file that also loses an entry is planned whole, not by its changed lines
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 1 }, "mutate": ["src/math.mjs"] }
      """

  Scenario Outline: an entry is judged only where the run mutated its lines: <mutate>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And the gate mutation report keeps only the mutants "1"
    And the gate mutation report mutated "<mutate>"
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      <violation>
      """

    Examples:
      | mutate                    | violation                                                                                                                   |
      | src/math.mjs:3-3          |                                                                                                                             |
      | src/math.mjs:3-3, src/math.mjs:7-7 | 6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé ou déplacé), à retirer dans la même PR |
      | src/**/*.mjs              | 6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé ou déplacé), à retirer dans la même PR |
      | src/math.mjs:6-7          | 6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé ou déplacé), à retirer dans la même PR |
      | src/math.mjs:7-8          | 6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé ou déplacé), à retirer dans la même PR |
      | src/math.mjs:8-9          |                                                                                                                             |
      | !src/math.mjs             |                                                                                                                             |

  Scenario: the plan holds the file of the removed entry only, not the other file that the registry still holds
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate debt registry is the fixture "a-and-survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "a-survivor"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 1 }, "mutate": ["src/math.mjs"] }
      """

  Scenario: the plan does not hold the file of a removed entry that the diff deleted
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" is removed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate plan is:
      """
      { "job": "linux", "head": "<head>", "firstParent": "<parent>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 1 }, "mutate": [] }
      """

  Scenario: the plan of the macos job holds no file, whatever the registry removed
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate plans the "macos" job
    Then the gate plan is:
      """
      { "job": "macos", "head": "<head>", "firstParent": "<parent>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 1 }, "mutate": [] }
      """

  Scenario Outline: a removed entry whose mutant still is not killed is refused: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait refusé, le survivant existe toujours
      """

    Examples:
      | status     |
      | Survived   |
      | NoCoverage |
      | Pending    |

  Scenario Outline: a removed entry whose mutant is still there undetected is refused: <status>
    A removal is proved by a detection of its mutant, or by its mutant gone: a mutant the tool ignored or could not
    compile was not detected.

    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations of rule 6 are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait refusé, le mutant n'est pas détecté
      """

    Examples:
      | status       |
      | Ignored      |
      | CompileError |

  Scenario Outline: a removed entry whose mutant is detected is proved: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate reports no violation of rule 6

    Examples:
      | status       |
      | Killed       |
      | Timeout      |
      | RuntimeError |

  Scenario: a removed entry whose file the mutation report does not speak of is not proved
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: fichiers du rapport différents des lots prévus
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait non prouvé, le fichier n'est pas dans le rapport de mutation
      """

  Scenario: a removed entry whose file Stryker mutated without finding a mutant is proved
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" reads:
      """
      // The old implementation has been removed.
      """
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "no-mutant"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation

  Scenario: an entry removed with its deleted file needs no proof
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" is removed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 0
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 1
      """

  Scenario: an entry kept in the registry while its file is deleted is red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src/math.mjs" is removed
    And the gate head is committed
    And the gate mutation report is the fixture "missing-file"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : fichier absent, entrée à retirer dans la même PR
      """

  Scenario: an entry whose code moved by one line is misaligned, and the registry says to realign
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate mutation report is the fixture "survivor"
    And the code of "src/math.mjs" moves down by one line from line 7 in the gate mutation report and in the working tree
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : désalignée (le code a bougé), lancer « test-gate debt realign »
      """

  Scenario: an entry whose code moved is misaligned although the run mutated nothing of its lines
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate mutation report is the fixture "survivor"
    And the code of "src/math.mjs" moves down by one line from line 1 in the gate mutation report and in the working tree
    And the gate head is committed
    And the gate mutation report keeps only the mutants "1"
    And the gate mutation report mutated "src/math.mjs:4-4"
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : désalignée (le code a bougé), lancer « test-gate debt realign »
      """

  Scenario: after debt realign the same tree is green, and the realigned entry is not an entry added
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate mutation report is the fixture "survivor"
    And the code of "src/math.mjs" moves down by one line from line 7 in the gate mutation report and in the working tree
    And the gate runs with the arguments "debt realign"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: a misaligned entry that the diff adds is reported as misaligned only
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "survivor" with "start.line" of its entry 1 set to "6"
    And the gate mutation report is the fixture "survivor"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:6:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : désalignée (le code a bougé), lancer « test-gate debt realign »
      """
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an entry added next to an entry of the same kind that the first parent holds is the one reported
    Given the gate repository file "src/math.mjs" reads:
      """
      // Production file of the fixture suite: the mutation fixtures are reports of Stryker runs on it.
      export function sum(a, b) {
        return a + b;
      }

      export function isPositive(n) {
        return n > 0;
      }

      export function isStrictlyPositive(n) {
        return n > 0;
      }
      """
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry holds these entries:
      | file         | start | end   | mutator          | original | replacement |
      | src/math.mjs | 7:10  | 7:15  | EqualityOperator | n > 0    | n >= 0      |
      | src/math.mjs | 11:10 | 11:15 | EqualityOperator | n > 0    | n >= 0      |
    And the gate mutation report is the fixture "survivor"
    And the gate mutation report mutated "src/math.mjs:7-7"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:11:10-11:15 EqualityOperator "n > 0" -> "n >= 0" : entrée ajoutée au registre, le registre ne peut que rétrécir
      """

  Scenario: an entry added in place of an entry of another kind is reported, and the removal of the other is judged
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry holds these entries:
      | file         | start | end  | mutator            | original | replacement |
      | src/math.mjs | 3:10  | 3:15 | ArithmeticOperator | a + b    | a - b       |
    And the gate mutation report is the fixture "survivor"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:3:10-3:15 ArithmeticOperator "a + b" -> "a - b" : entrée ajoutée au registre, le registre ne peut que rétrécir
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait refusé, le survivant existe toujours
      """

  Scenario: two entries added next to one of the same kind are both reported
    Given the gate repository file "src/math.mjs" reads:
      """
      // Production file of the fixture suite: the mutation fixtures are reports of Stryker runs on it.
      export function sum(a, b) {
        return a + b;
      }

      export function isPositive(n) {
        return n > 0;
      }

      export function isStrictlyPositive(n) {
        return n > 0;
      }

      export function isAbove(n) {
        return n > 0;
      }
      """
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry holds these entries:
      | file         | start | end   | mutator          | original | replacement |
      | src/math.mjs | 7:10  | 7:15  | EqualityOperator | n > 0    | n >= 0      |
      | src/math.mjs | 11:10 | 11:15 | EqualityOperator | n > 0    | n >= 0      |
      | src/math.mjs | 15:10 | 15:15 | EqualityOperator | n > 0    | n >= 0      |
    And the gate mutation report is the fixture "survivor"
    And the gate mutation report mutated "src/math.mjs:7-7"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:11:10-11:15 EqualityOperator "n > 0" -> "n >= 0" : entrée ajoutée au registre, le registre ne peut que rétrécir
      6: src/math.mjs:15:10-15:15 EqualityOperator "n > 0" -> "n >= 0" : entrée ajoutée au registre, le registre ne peut que rétrécir
      """

  Scenario: two entries at other places than the one entry of the first parent are one entry added
    Given the gate repository file "src/math.mjs" reads:
      """
      // Production file of the fixture suite: the mutation fixtures are reports of Stryker runs on it.
      export function sum(a, b) {
        return a + b;
      }

      export function isPositive(n) {
        return n > 0;
        return n > 0;
        return n > 0;
      }
      """
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry holds these entries:
      | file         | start | end  | mutator          | original | replacement |
      | src/math.mjs | 8:10  | 8:15 | EqualityOperator | n > 0    | n >= 0      |
      | src/math.mjs | 9:10  | 9:15 | EqualityOperator | n > 0    | n >= 0      |
    And the gate mutation report is the fixture "survivor"
    And the gate mutation report mutated "src/math.mjs:7-7"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:8:10-8:15 EqualityOperator "n > 0" -> "n >= 0" : entrée ajoutée au registre, le registre ne peut que rétrécir
      """

  Scenario: two entries of the first parent at other places than the one entry kept are one entry removed
    Given the gate repository file "src/math.mjs" reads:
      """
      // Production file of the fixture suite: the mutation fixtures are reports of Stryker runs on it.
      export function sum(a, b) {
        return a + b;
      }

      export function isPositive(n) {
        return n > 0;
        return n > 0;
        return n > 0;
        return n > 0;
        return n > 0;
        return n > 0;
      }
      """
    And the gate debt registry holds these entries:
      | file         | start | end   | mutator          | original | replacement |
      | src/math.mjs | 7:10  | 7:15  | EqualityOperator | n > 0    | n >= 0      |
      | src/math.mjs | 11:10 | 11:15 | EqualityOperator | n > 0    | n >= 0      |
    And the gate first parent is committed
    And the gate debt registry holds these entries:
      | file         | start | end   | mutator          | original | replacement |
      | src/math.mjs | 12:10 | 12:15 | EqualityOperator | n > 0    | n >= 0      |
    And the gate mutation report is the fixture "survivor"
    And the gate mutation report mutated "src/math.mjs:7-7"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate violations of rule 6 are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : retrait refusé, le survivant existe toujours
      """

  Scenario: an entry whose mutant is now killed is green and counted: survivors vary from one run to the next
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "Killed"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 1 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario Outline: an entry whose mutant did not survive this run is green and counted: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 1 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

    Examples:
      | status       |
      | Killed       |
      | Timeout      |
      | RuntimeError |
      | CompileError |
      | Ignored      |

  Scenario Outline: an entry whose mutant is still Survived, NoCoverage or Pending is found and not counted: <status>
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    And mutant "5" of the gate mutation report has the status "<status>"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

    Examples:
      | status       |
      | Survived     |
      | NoCoverage   |
      | Pending      |

  Scenario: an entry whose file is not in the mutation report is not judged
    Given the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate debt registry is the fixture "a-survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "nocoverage"
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 0
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an entry whose file Stryker mutated without finding a mutant is not found
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate head is committed
    And the gate mutation report is the fixture "no-mutant"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : introuvable (code supprimé ou déplacé), à retirer dans la même PR
      """

  Scenario: two entries with the same identity are red
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "duplicate"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    And the gate mutation report is the fixture "survivor"
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      6: src/math.mjs:7:10-7:15 EqualityOperator "n > 0" -> "n >= 0" : identité en double dans le registre
      """
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 2
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 0
      - entrées retirées par ce diff : 0
      """

  Scenario: an unreadable mutation report with a removal reports the report once, and no removal violation
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: an unreadable mutation report is red when the diff only removes an entry: the removal cannot be proved
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate debt registry is the fixture "empty"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: an unreadable mutation report judges no entry of the registry: the report is the only violation
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      """

  Scenario: an unreadable mutation report and an unreadable registry are both reported, rule 5 first
    Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 7 changed
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is absent
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate violations are:
      """
      5: rapport de mutation illisible : reports/mutation/mutation.json absent
      6: registre de dette illisible : mutation-debt.json absent
      """

  Scenario: the macos job does not read the registry
    Given the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate report has no debt section

  Scenario: the macos job ignores an absent registry
    Given the gate debt registry is absent
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate report has no debt section

  Scenario: the macos job ignores a registry that is not JSON, in the working tree and at the first parent
    Given the gate debt registry reads:
      """
      not json
      """
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate first parent is committed
    And the gate debt registry reads:
      """
      {"survivors": [
      """
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate report has no debt section

  Scenario Outline: the macos job ignores a registry that does not match its schema: <registry>
    Given the gate debt registry is the fixture "<registry>"
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate head is committed
    And the gate cucumber report is the fixture "green"
    When the gate checks the "macos" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate report has no debt section

    Examples:
      | registry        |
      | unknown-key     |
      | negative-column |

  Scenario: debt writes the registry sorted by file, line, column, mutator and replacement, Survived and NoCoverage only
    Given the gate debt registry is absent
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "debt"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette écrit : mutation-debt.json
      - mod : 1
      - src : 6
      - total : 7
      """
    And the gate repository file "mutation-debt.json" is the fixture "debt/unsorted.json"

  Scenario: debt writes the survivors of production files only: the canary keeps its survivors out of the registry
    Given the gate debt registry is absent
    And the gate mutation report is the fixture "unsorted"
    And the file "src/math.mjs" of the gate mutation report is renamed "canary/math.mjs"
    When the gate runs with the arguments "debt"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette écrit : mutation-debt.json
      - mod : 1
      - total : 1
      """

  Scenario: full mutation compares the generated registry without changing the tracked file
    Given the gate debt registry is absent
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "debt"
    Then the gate exits with 0
    Given the gate head is committed
    When the gate runs with the arguments "debt compare"
    Then the gate exits with 0
    Given a different debt registry is staged without touching the working copy
    When the gate runs with the arguments "debt compare"
    Then the gate exits with 0
    And the gate output includes "registre de dette écrit : reports/mutation-debt.computed.json"
    And both comparison reports match the tracked debt registry
    Given the gate mutation report is the fixture "no-mutant"
    When the gate runs with the arguments "debt compare"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : registre de dette différent du rapport complet
      """
    And the committed comparison report matches the untouched tracked debt registry
    Given the gate repository file "reports/mutation/mutation.json" is removed
    When the gate runs with the arguments "debt compare"
    Then the gate exits with 1
    And the gate output includes "rapport de mutation illisible : reports/mutation/mutation.json absent"
    And the gate repository holds no file "reports/mutation-debt.computed.json"
    And the committed comparison report matches the untouched tracked debt registry

  Scenario: a missing committed registry cannot reuse either prior comparison file
    Given the gate debt registry is absent
    And the gate head is committed
    And the gate repository file "reports/mutation-debt.committed.json" reads:
      """
      stale
      """
    And the gate repository file "reports/mutation-debt.computed.json" reads:
      """
      stale
      """
    When the gate runs with the arguments "debt compare"
    Then the gate exits with 1
    And the gate output includes "HEAD:mutation-debt.json"
    And the gate repository holds no file "reports/mutation-debt.committed.json"
    And the gate repository holds no file "reports/mutation-debt.computed.json"

  Scenario: debt does not regenerate an existing registry
    Given the gate debt registry is the fixture "survivor"
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "debt"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : le registre ne peut que rétrécir : on ne le régénère pas (mutation-debt.json existe déjà)
      """
    And the gate repository file "mutation-debt.json" is the fixture "debt/survivor.json"

  Scenario: debt refuses an absent mutation report and writes nothing
    Given the gate debt registry is absent
    When the gate runs with the arguments "debt"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : rapport de mutation illisible : reports/mutation/mutation.json absent
      """
    And the gate repository holds no file "mutation-debt.json"

  Scenario: debt refuses an unreadable mutation report and writes nothing
    Given the gate debt registry is absent
    And the gate mutation report reads:
      """
      []
      """
    When the gate runs with the arguments "debt"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : rapport de mutation illisible : hors schéma : ✖ Invalid input: expected object, received array
      """
    And the gate repository holds no file "mutation-debt.json"

  Scenario Outline: debt accepts only realign or compare, alone: <arguments>
    Given the gate debt registry is absent
    And the gate mutation report is the fixture "unsorted"
    When the gate runs with the arguments "<arguments>"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : usage : test-gate plan|check|inventory|inventory-check|inventory-project|inventory-collect [--job <nom>] (inventory|inventory-project --shard <1|2>) | debt [realign|compare] | replay [--all | --shard <1|2>] | replay-collect
      """
    And the gate repository holds no file "mutation-debt.json"

    Examples:
      | arguments       |
      | debt now        |
      | debt compare now |
      | debt --job macos |
      | debt realign now |

  Scenario: the registry that debt writes from a mutation report is accepted as it is by check on that same report
    Given the gate debt registry is absent
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate mutation report is the fixture "survivor"
    And the gate runs with the arguments "debt"
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is green
    And the gate reports no violation
    And the gate debt section reads:
      """
      ## Dette de mutation

      - registre : mutation-debt.json
      - survivants au registre : 1
      - rencontrés dans le périmètre de ce run : 1
      - entrées dont le mutant n'a pas survécu à ce run : 0 (à retirer du registre quand la dette est payée)
      - entrées ajoutées par ce diff : 1
      - entrées retirées par ce diff : 0
      - création du registre par ce diff (le premier parent n'en a pas)
      """

  Scenario: debt realign moves an entry whose lines moved down
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      // two
      const total = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:15  | 1:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 1
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:15  | 3:20 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign moves an entry whose lines moved up
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      // two
      const total = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 6:15  | 6:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:15  | 3:20 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign leaves the registry byte for byte as it was when no entry is misaligned
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      // two
      const total = a + b;
      """
    And the gate debt registry reads:
      """
      {"survivors": [{"file": "src/lines.mjs", "start": {"line": 3, "column": 15}, "end": {"line": 3, "column": 20}, "mutator": "ArithmeticOperator", "original": "a + b", "replacement": "a - b"}]}
      """
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 0
      """
    And the gate repository file "mutation-debt.json" now reads:
      """
      {"survivors": [{"file": "src/lines.mjs", "start": {"line": 3, "column": 15}, "end": {"line": 3, "column": 20}, "mutator": "ArithmeticOperator", "original": "a + b", "replacement": "a - b"}]}
      """

  Scenario: debt realign writes the registry in the format debt writes
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const total = a + b;
      """
    And the gate debt registry reads:
      """
      {"survivors": [{"file": "src/lines.mjs", "start": {"line": 1, "column": 15}, "end": {"line": 1, "column": 20}, "mutator": "ArithmeticOperator", "original": "a + b", "replacement": "a - b"}]}
      """
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate repository file "mutation-debt.json" now reads:
      """
      {
        "survivors": [
          {
            "file": "src/lines.mjs",
            "start": {
              "line": 2,
              "column": 15
            },
            "end": {
              "line": 2,
              "column": 20
            },
            "mutator": "ArithmeticOperator",
            "original": "a + b",
            "replacement": "a - b"
          }
        ]
      }
      """

  Scenario: debt realign moves an entry of several lines by the same columns and the same number of lines
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const sum = [
        a,
        b,
      ];
      """
    And the gate debt registry holds these entries:
      | file          | start | end | mutator          | original        | replacement |
      | src/lines.mjs | 1:13  | 4:2 | ArrayDeclaration | [\n  a,\n  b,\n] | []          |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate debt registry now holds these entries:
      | file          | start | end | mutator          | original        | replacement |
      | src/lines.mjs | 2:13  | 5:2 | ArrayDeclaration | [\n  a,\n  b,\n] | []          |

  Scenario: debt realign does not move an entry whose text is gone from its file, and exits 1 naming it
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const total = a * b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:15  | 1:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 0
      - non déplacée : src/lines.mjs:1:15-1:20 ArithmeticOperator "a + b" -> "a - b"
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:15  | 1:20 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign does not move an entry whose file is gone, and exits 1 naming it
    Given the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:15  | 1:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 0
      - non déplacée : src/lines.mjs:1:15-1:20 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario: debt realign moves neither of two identical entries that have two places and no neighbour
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      // two
      const p = a + b;
      const q = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:11  | 1:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 0
      - non déplacée : src/lines.mjs:1:11-1:16 ArithmeticOperator "a + b" -> "a - b"
      - non déplacée : src/lines.mjs:2:11-2:16 ArithmeticOperator "a + b" -> "a - b"
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:11  | 1:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign gives a misaligned entry the only place that an aligned entry of the same identity does not hold
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const p = a + b;
      const q = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 1:11  | 1:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign moves none of three entries that have the same two places and no neighbour
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const p = a + b;
      const q = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 4:11  | 4:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 5:11  | 5:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 6:11  | 6:16 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 0
      - non déplacée : src/lines.mjs:4:11-4:16 ArithmeticOperator "a + b" -> "a - b"
      - non déplacée : src/lines.mjs:5:11-5:16 ArithmeticOperator "a + b" -> "a - b"
      - non déplacée : src/lines.mjs:6:11-6:16 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario: debt realign puts an entry on its own code when a decoy of the same text stands above it, the block having moved up by one line
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const d = f(true);
      const a = one();
      const t = g(true);
      const b = two();
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 4:11  | 4:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 5:13  | 5:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 6:11  | 6:16 | CallRemoval    | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 3
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 4:13  | 4:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 5:11  | 5:16 | CallRemoval    | two()    | undefined   |

  Scenario: debt realign puts an entry on its own code when a decoy of the same text stands above it, the block having moved down by two lines
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const d = f(true);
      // pad
      // pad
      const a = one();
      const t = g(true);
      const b = two();
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 4:13  | 4:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 5:11  | 5:16 | CallRemoval    | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 3
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 5:11  | 5:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 6:13  | 6:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 7:11  | 7:16 | CallRemoval    | two()    | undefined   |

  Scenario: debt realign moves no entry that has two places when its neighbours above and below name two different ones
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const a = one();
      const t = g(true);
      // pad
      // pad
      const u = h(true);
      const b = two();
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 4:11  | 4:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 5:13  | 5:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 6:11  | 6:16 | CallRemoval    | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 2
      - non déplacée : src/lines.mjs:5:13-5:17 BooleanLiteral "true" -> "false"
      """

  Scenario: debt realign gives to neither a place that the neighbours name for two entries of one kind
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const d = f(true);
      // pad
      // pad
      // pad
      const m = mid();
      const a = one();
      // pad
      const t = g(true);
      // pad
      const b = two();
      """
    And the gate debt registry holds these entries:
      | file          | start | end   | mutator        | original | replacement |
      | src/lines.mjs | 3:11  | 3:16  | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 5:13  | 5:17  | BooleanLiteral | true     | false       |
      | src/lines.mjs | 6:11  | 6:16  | CallRemoval    | mid()    | undefined   |
      | src/lines.mjs | 8:13  | 8:17  | BooleanLiteral | true     | false       |
      | src/lines.mjs | 10:11 | 10:16 | CallRemoval    | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 2
      - non déplacée : src/lines.mjs:5:13-5:17 BooleanLiteral "true" -> "false"
      - non déplacée : src/lines.mjs:8:13-8:17 BooleanLiteral "true" -> "false"
      """

  Scenario: debt realign moves an entry that has two places by the nearest neighbour above, not by a farther one
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      // pad
      const a = one();
      // pad
      const b = two();
      // pad
      const t = g(true);
      // pad
      // pad
      // pad
      const c = three();
      const u = h(true);
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 1:11  | 1:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 8:11  | 8:16 | CallRemoval    | two()    | undefined   |
      | src/lines.mjs | 10:13 | 10:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 11:11 | 11:18 | CallRemoval    | three()  | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 3
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 5:11  | 5:16 | CallRemoval    | two()    | undefined   |
      | src/lines.mjs | 7:13  | 7:17 | BooleanLiteral | true     | false       |
      | src/lines.mjs | 11:11 | 11:18 | CallRemoval    | three()  | undefined   |

  Scenario: debt realign moves an entry that has two places by the nearest neighbour below, not by a farther one
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      // pad
      const u = h(true);
      // pad
      const c = three();
      // pad
      // pad
      // pad
      const t = g(true);
      const b = two();
      const a = one();
      """
    And the gate debt registry holds these entries:
      | file          | start | end   | mutator        | original | replacement |
      | src/lines.mjs | 5:11  | 5:18  | CallRemoval    | three()  | undefined   |
      | src/lines.mjs | 6:13  | 6:17  | BooleanLiteral | true     | false       |
      | src/lines.mjs | 8:11  | 8:16  | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 13:11 | 13:16 | CallRemoval    | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 3
      """
    And the gate debt registry now holds these entries:
      | file          | start | end   | mutator        | original | replacement |
      | src/lines.mjs | 5:11  | 5:18  | CallRemoval    | three()  | undefined   |
      | src/lines.mjs | 9:13  | 9:17  | BooleanLiteral | true     | false       |
      | src/lines.mjs | 11:11 | 11:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 10:11 | 10:16 | CallRemoval    | two()    | undefined   |

  Scenario: debt realign takes no evidence from an entry of the same line, nor from another file
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const p = a + b;
      const q = a + b; one()
      """
    And the gate repository file "src/other.mjs" reads:
      """
      two()
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 5:11  | 5:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 5:18  | 5:23 | CallRemoval        | one()    | undefined   |
      | src/other.mjs | 4:1   | 4:6  | CallRemoval        | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 2
      - non déplacée : src/lines.mjs:5:11-5:16 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario: debt realign moves neither of two entries that have the same only place, whatever their neighbours say
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const a = one();
      const p = a + b;
      const b = two();
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | CallRemoval        | one()    | undefined   |
      | src/lines.mjs | 4:11  | 4:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 5:11  | 5:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 6:11  | 6:16 | CallRemoval        | two()    | undefined   |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 2
      - non déplacée : src/lines.mjs:4:11-4:16 ArithmeticOperator "a + b" -> "a - b"
      - non déplacée : src/lines.mjs:5:11-5:16 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario: debt realign moves neither of two entries that have the same only place, even when a neighbour names it for one alone
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      const a = one();
      const p = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | CallRemoval        | one()    | undefined   |
      | src/lines.mjs | 4:11  | 4:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 5:11  | 5:16 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 1
      - non déplacée : src/lines.mjs:4:11-4:16 ArithmeticOperator "a + b" -> "a - b"
      - non déplacée : src/lines.mjs:5:11-5:16 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario: debt realign takes no evidence from an entry that stays misaligned
    Given the gate repository file "src/lines.mjs" reads:
      """
      // head
      // pad
      const a = one();
      // pad
      // pad
      // pad
      const t = g(true);
      // pad
      const u = h(true);
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 1:11  | 1:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 3:11  | 3:17 | CallRemoval    | gone()   | undefined   |
      | src/lines.mjs | 5:13  | 5:17 | BooleanLiteral | true     | false       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 2
      - non déplacée : src/lines.mjs:3:11-3:17 CallRemoval "gone()" -> "undefined"
      """
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator        | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | CallRemoval    | one()    | undefined   |
      | src/lines.mjs | 3:11  | 3:17 | CallRemoval    | gone()   | undefined   |
      | src/lines.mjs | 7:13  | 7:17 | BooleanLiteral | true     | false       |

  Scenario: debt realign never moves an aligned entry, even when its text also stands elsewhere
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const p = a + b;
      const q = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 3:11  | 3:16 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign makes no move that needs another column
    Given the gate repository file "src/lines.mjs" reads:
      """
        const total = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 5:15  | 5:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 0
      - non déplacée : src/lines.mjs:5:15-5:20 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario: debt realign moves entries of one kind at different columns each to its own columns
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const p = a + b;
      const total = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 7:11  | 7:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 8:15  | 8:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 3:15  | 3:20 | ArithmeticOperator | a + b    | a - b       |

  Scenario: debt realign moves entries of one kind that differ by the mutator or the replacement each to its own
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const p = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 7:11  | 7:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 8:11  | 8:16 | ArithmeticOperator | a + b    | a * b       |
      | src/lines.mjs | 9:11  | 9:16 | OtherOperator      | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 0
    And the gate debt registry now holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 2:11  | 2:16 | ArithmeticOperator | a + b    | a * b       |
      | src/lines.mjs | 2:11  | 2:16 | OtherOperator      | a + b    | a - b       |

  Scenario: debt realign does not let an entry that spans other lines than its text hold back another
    Given the gate repository file "src/lines.mjs" reads:
      """
      // one
      const total = a + b;
      """
    And the gate debt registry holds these entries:
      | file          | start | end  | mutator            | original | replacement |
      | src/lines.mjs | 7:15  | 8:20 | ArithmeticOperator | a + b    | a - b       |
      | src/lines.mjs | 9:15  | 9:20 | ArithmeticOperator | a + b    | a - b       |
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      registre de dette réaligné : mutation-debt.json
      - entrées déplacées : 1
      - non déplacée : src/lines.mjs:7:15-8:20 ArithmeticOperator "a + b" -> "a - b"
      """

  Scenario Outline: debt realign refuses an unusable registry and writes nothing: <registry>
    Given the gate debt registry reads:
      """
      <registry>
      """
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : registre de dette illisible : <reason>
      """

    Examples:
      | registry | reason                                                                  |
      | []       | hors schéma : ✖ Invalid input: expected object, received array |

  Scenario: debt realign refuses an absent registry
    Given the gate debt registry is absent
    When the gate runs with the arguments "debt realign"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : registre de dette illisible : mutation-debt.json absent
      """
    And the gate repository holds no file "mutation-debt.json"

  Scenario: replacing the source directory with a regular file makes its old debt source absent
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature, second.feature"
    And the gate cucumber report is the fixture "green"
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
    And the gate debt registry is the fixture "survivor"
    And the gate first parent is committed
    And the gate repository file "src" is removed
    And the gate repository file "src" reads:
      """
      a regular file now
      """
    And the gate head is committed
    When the gate checks the "linux" job
    Then the gate verdict is red
    And the gate output includes "fichier absent, entrée à retirer dans la même PR"
