Feature: The delivery command over in-memory ports (the six phases, each reason, the acts in order)
  The doubles record every call. The commit "h1" is ahead of "main" at "p0", and records the record of the step "step".
  The trial branch is "sentinel/gate-1a-step", the work branch "deliver/step"; the remote has no work branch yet.

  Background:
    Given a delivery over the in-memory ports, the commit "h1" ahead of the destination at "p0"

  Rule: a delivery goes through the six phases for the one commit, and ends with a pull request to the destination

    Scenario: the whole delivery, with a gate that runs
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 deliver/step
        pullRequest deliver/step main h1
        delete sentinel/gate-1a-step
        log delivered
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        rangement
        """
      And the delivery calls named "isClean, head, remoteHead, isAncestor, committedFile, verdict, gate, deletedLines" are:
        """
        isClean
        head
        remoteHead deliver/step
        committedFile h1 steps/step/record.json
        verdict
        gate
        verdict
        deletedLines p0 h1 docs/design/journal.md
        remoteHead deliver/step
        """
      And the delivery calls named "verdict, gate, ci" are:
        """
        verdict
        gate
        verdict
        ci h1 gate sentinel/gate-1a-step
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["deliver/step"],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """
      And the delivery log holds exactly the result
      And the delivery clock slept 0 seconds
      And the delivery forge holds 1 pull request, none a draft
      And the delivery pull request was asked from "deliver/step" to "main" with the title "Deliver the step step" and the body of the record

    Scenario: the destination is never pushed, whatever the run does
      When I deliver "step" until "end"
      And I deliver "step" until "end"
      Then the delivery calls named "push" are:
        """
        push h1 sentinel/gate-1a-step
        push h1 deliver/step
        push h1 sentinel/gate-1a-step
        """

    Scenario: the same delivery again: the work branch is not pushed again, and the pull request is found, not doubled
      When I deliver "step" until "end"
      And I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 deliver/step
        pullRequest deliver/step main h1
        delete sentinel/gate-1a-step
        log delivered
        fetch
        push h1 sentinel/gate-1a-step
        fetch
        pullRequest deliver/step main h1
        delete sentinel/gate-1a-step
        log delivered
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"reused","published":[],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":false,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """
      And the delivery forge holds 1 pull request, none a draft

    Scenario: a run stopped after the push of the work branch opens the pull request when it is started again
      Given the forge of the delivery sequence refuses every new pull request
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "la forge a refusé la pull request"
      And the delivery forge holds 0 pull requests, none a draft
      Given the forge of the delivery sequence opens pull requests again
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"reused","published":[],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """
      And the delivery forge holds 1 pull request, none a draft

    Scenario: a later commit of the same work branch: the work branch is pushed forward, and its pull request found
      When I deliver "step" until "end"
      Given the delivery commit "h2" follows "h1", records the record of the step, and is the one to deliver
      When I deliver "step" until "end"
      Then the delivery calls named "push, pullRequest" are:
        """
        push h1 sentinel/gate-1a-step
        push h1 deliver/step
        pullRequest deliver/step main h1
        push h2 sentinel/gate-1a-step
        push h2 deliver/step
        pullRequest deliver/step main h2
        """
      And the delivery outcome is "delivered"
      And the delivery forge holds 1 pull request, none a draft

    Scenario: a verdict that already names the commit: the gate is not run again
      Given the delivery gate verdict already names "h1"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        fetch
        push h1 deliver/step
        pullRequest deliver/step main h1
        delete sentinel/gate-1a-step
        log delivered
        """
      And the delivery calls named "verdict, gate" are:
        """
        verdict
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"reused","published":["deliver/step"],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """
      And the delivery log holds exactly the result

    Scenario: a verdict that names another commit: the gate runs
      Given the delivery gate verdict already names "h0"
      When I deliver "step" until "end"
      Then the delivery calls named "verdict, gate" are:
        """
        verdict
        gate
        verdict
        """
      And the delivery outcome is "delivered"

    Scenario: until the CI: no push of the work branch, no pull request, the trial branch kept
      When I deliver "step" until "ci"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        log ready
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """
      And the delivery result is:
        """
        {"outcome":"ready","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"base":"p0"}
        """
      And the delivery log holds exactly the result
      And the delivery forge holds 0 pull requests, none a draft

    Scenario: until the CI, a CI that is red still stops the run
      Given the delivery CI answers "failed"
      When I deliver "step" until "ci"
      Then the delivery stopped at the phase "CI" because "CI rouge"

    Scenario: no append-only file to watch
      Given the delivery append-only files are ""
      When I deliver "step" until "end"
      Then the delivery calls named "deletedLines" are:
        """
        """
      And the delivery outcome is "delivered"

  Rule: a precondition that fails ends the run before any act of the later phases, and logs nothing

    Scenario: a tree that holds a nested repository: asked first, and nothing else is asked of git
      Given the delivery tree holds a nested repository
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"stopped","phase":"préalables","reason":"dépôt imbriqué dans l'arbre"}
        """
      And the delivery acts are:
        """
        """
      And the delivery calls named "holdsNestedRepository, isClean, head, fetch, remoteHead" are:
        """
        holdsNestedRepository
        """
      And the delivery log holds no entry

    Scenario: a tree that is not clean
      Given the delivery tree is not clean
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"stopped","phase":"préalables","reason":"arbre non propre"}
        """
      And the delivery acts are:
        """
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery calls named "isClean, head, remoteHead" are:
        """
        isClean
        """
      And the delivery log holds no entry

    Scenario: the destination is neither read nor compared with the commit
      Given the delivery remote branch "main" is absent
      When I deliver "step" until "end"
      Then the delivery outcome is "delivered"
      And the delivery calls named "remoteHead, isAncestor" are:
        """
        remoteHead deliver/step
        remoteHead deliver/step
        """

    Scenario: a work branch that is not an ancestor of the commit
      Given the delivery remote branch "deliver/step" is at "x9"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "la branche distante n'est pas un ancêtre du commit"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery calls named "isAncestor, committedFile" are:
        """
        isAncestor x9 h1
        """
      And the delivery log holds no entry

    Scenario: a work branch at an ancestor of the commit is pushed forward
      Given the delivery remote branch "deliver/step" is at "p0"
      When I deliver "step" until "end"
      Then the delivery calls named "isAncestor, push" are:
        """
        isAncestor p0 h1
        push h1 sentinel/gate-1a-step
        push h1 deliver/step
        """
      And the delivery outcome is "delivered"

    Scenario: a commit that records no record of the step
      Given the delivery commit records no record of the step
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "enregistrement d'étape absent"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery log holds no entry

    Scenario Outline: a record of the step that is refused: <case>
      Given the delivery commit records as the record of the step <record>
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "enregistrement d'étape refusé"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery log holds no entry

      Examples:
        | case                        | record                                         |
        | not JSON                    | the text "not JSON"                            |
        | JSON its schema refuses     | the text "{\"step\":\"step\"}"                 |
        | the record of another step  | the record of the step "other"                 |

    Scenario Outline: a name that is not a branch name: nothing is fetched
      When I deliver "<name>" until "end"
      Then the delivery stopped at the phase "préalables" because "nom de branche d'essai refusé"
      And the delivery acts are:
        """
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery log holds no entry

      Examples:
        | name    |
        | --force |
        | Step    |

    Scenario: a trial branch that is the work branch
      Given the delivery setting "workPrefix" is the text "sentinel/gate-1a-"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "nom de branche d'essai refusé"
      And the delivery acts are:
        """
        """
      And the delivery log holds no entry

    Scenario Outline: a <branch> branch that would be the destination: the destination is never pushed
      Given the delivery setting "destination" is the text "<destination>"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "la destination n'accepte qu'une pull request"
      And the delivery acts are:
        """
        """
      And the delivery calls named "push" are:
        """
        """
      And the delivery log holds no entry

      Examples:
        | branch | destination           |
        | trial  | sentinel/gate-1a-step |
        | work   | deliver/step          |

    Scenario Outline: a commit that is not a full lower-case hash stops the run before any act
      Given the delivery commit to deliver is "<hash>"
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"stopped","phase":"préalables","reason":"empreinte de commit invalide"}
        """
      And the delivery acts are:
        """
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery calls named "remoteHead" are:
        """
        """
      And the delivery log holds no entry

      Examples:
        | hash                                      |
        | 111111111111111111111111111111111111111   |
        | 11111111111111111111111111111111111111111 |
        | 111111111111111111111111111111111111111A  |
        | 111111111111111111111111111111111111111g  |
        | HEAD                                      |
        | refs/heads/main                           |
        |                                           |

  Rule: the trial branch

    Scenario: a push of the trial branch that is refused
      Given the delivery push to "sentinel/gate-1a-step" is refused
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "branche d'essai" because "push de la branche d'essai refusé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"attempts":0,"polls":0},"published":[],"phase":"branche d'essai","reason":"push de la branche d'essai refusé"}
        """
      And the delivery log holds exactly the result

  Rule: the gate

    Scenario: the append-only files grew since the destination the gate judged: the run goes on
      Given the delivery history holds "p1" as an ancestor of "h1"
      And the receipt of the delivery gate names the destination "p1"
      When I deliver "step" until "end"
      Then the delivery outcome is "delivered"
      And the delivery calls named "deletedLines" are:
        """
        deletedLines p1 h1 docs/design/journal.md
        """

    Scenario: an append-only file that lost a line since the destination the gate judged: stopped after the gate, nothing published
      Given the delivery file "docs/design/journal.md" lost 1 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "un fichier en ajout seul a perdu des lignes"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        log stopped
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"porte","reason":"un fichier en ajout seul a perdu des lignes","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"attempts":0,"polls":0},"gate":"ran","published":[],"base":"p0"}
        """
      And the delivery log holds exactly the result

    Scenario: a reused verdict gives the base of the append-only files too
      Given the delivery gate verdict already names "h1"
      And the delivery file "docs/design/journal.md" lost 1 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "un fichier en ajout seul a perdu des lignes"
      And the delivery calls named "gate, deletedLines" are:
        """
        deletedLines p0 h1 docs/design/journal.md
        """

    Scenario: the first append-only file lost lines: the second is not read
      Given the delivery append-only files are "a.md, b.md"
      And the delivery file "a.md" lost 2 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "un fichier en ajout seul a perdu des lignes"
      And the delivery calls named "deletedLines" are:
        """
        deletedLines p0 h1 a.md
        """

    Scenario: the second append-only file lost lines
      Given the delivery append-only files are "a.md, b.md"
      And the delivery file "b.md" lost 5 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "un fichier en ajout seul a perdu des lignes"
      And the delivery calls named "deletedLines" are:
        """
        deletedLines p0 h1 a.md
        deletedLines p0 h1 b.md
        """

    Scenario Outline: a receipt of the gate that names no destination: stopped, <verdict>
      Given <given>
      And the receipt of the delivery gate names no destination
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "le verdict de la porte ne nomme pas de destination"
      And the delivery calls named "deletedLines, push" are:
        """
        push h1 sentinel/gate-1a-step
        """
      And the delivery log holds exactly the result

      Examples:
        | verdict             | given                                         |
        | the gate played     | the delivery append-only files are "a.md"     |
        | the verdict reused  | the delivery gate verdict already names "h1"  |

    Scenario: a gate that is red
      Given the delivery gate exits 1 and then leaves the verdict "none"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "porte rouge"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        """
      And the delivery calls named "ci" are:
        """
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"attempts":0,"polls":0},"gate":"ran","published":[],"phase":"porte","reason":"porte rouge"}
        """
      And the delivery log holds exactly the result

    Scenario: a gate that is red and leaves a verdict naming the commit
      Given the delivery gate exits 1 and then leaves the verdict "h1"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "porte rouge"
      And the delivery calls named "verdict" are:
        """
        verdict
        """

    Scenario: a gate that exits 0 and leaves a verdict naming another commit
      Given the delivery gate exits 0 and then leaves the verdict "h0"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "le verdict de la porte ne nomme pas ce commit"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        """
      And the delivery calls named "ci" are:
        """
        """

    Scenario: a gate that exits 0 and leaves no verdict
      Given the delivery gate exits 0 and then leaves the verdict "none"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "porte" because "le verdict de la porte ne nomme pas ce commit"

  Rule: the CI

    Scenario: a CI that failed on a step
      Given the delivery CI answers "failed"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "CI rouge"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"base":"p0","phase":"CI","reason":"CI rouge"}
        """
      And the delivery log holds exactly the result

    Scenario: a CI that is waiting twice then green: two sleeps, none before the first poll
      Given the delivery setting "ciPolls" is 3
      And the delivery CI answers "waiting, waiting, green"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        sleep 30
        sleep 30
        fetch
        push h1 deliver/step
        pullRequest deliver/step main h1
        delete sentinel/gate-1a-step
        log delivered
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        rangement
        """
      And the delivery calls named "ci" are:
        """
        ci h1 gate sentinel/gate-1a-step
        ci h1 gate sentinel/gate-1a-step
        ci h1 gate sentinel/gate-1a-step
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":3},"gate":"ran","published":["deliver/step"],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """
      And the delivery clock slept 60 seconds

    Scenario: a CI with no run yet, then green
      Given the delivery CI answers "missing, green"
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":2},"gate":"ran","published":["deliver/step"],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """

    Scenario: a CI that never answers within the polls
      Given the delivery setting "ciPolls" is 3
      And the delivery CI answers "waiting"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "CI sans réponse"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        sleep 30
        sleep 30
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """
      And the delivery calls named "ci" are:
        """
        ci h1 gate sentinel/gate-1a-step
        ci h1 gate sentinel/gate-1a-step
        ci h1 gate sentinel/gate-1a-step
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":3},"gate":"ran","published":[],"base":"p0","phase":"CI","reason":"CI sans réponse"}
        """

    Scenario: a CI with no run at all within the polls
      Given the delivery setting "ciPolls" is 2
      And the delivery CI answers "missing"
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"attempts":0,"polls":2},"gate":"ran","published":[],"base":"p0","phase":"CI","reason":"CI sans réponse"}
        """

    Scenario: a single poll allowed
      Given the delivery setting "ciPolls" is 1
      And the delivery CI answers "waiting"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "CI sans réponse"
      And the delivery clock slept 0 seconds

    Scenario: a repeated observation of the rejected attempt does not spend another rerun
      Given the delivery Linux gate has a required producer
      And the delivery setting "ciAttempts" is 2
      And the delivery CI answers "admission-1, admission-1, accepted-2"
      When I deliver "step" until "ci"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        rerun 42
        sleep 30
        sleep 30
        sleep 30
        log ready
        """

    Scenario Outline: a rerun request remains pending through an incomplete forge timeline
      Given the delivery Linux gate has a required producer
      And the delivery setting "ciAttempts" is 2
      And the delivery CI follows "<timeline>" exactly across a rerun request
      When I deliver "step" until "ci"
      Then delivery is ready after 2 attempts and <polls> polls, with one rerun

      Examples:
        | timeline                                                        | polls |
        | admission-1, missing, accepted-2                                | 3     |
        | admission-unnumbered, admission-unnumbered, waiting, accepted-2 | 4     |

    Scenario: no runner twice then green, with three attempts: two reruns, each followed by a run still waiting
      Given the delivery setting "ciAttempts" is 3
      And the delivery CI answers "no-runner, no-runner, green"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        rerun 42
        sleep 30
        sleep 30
        rerun 42
        sleep 30
        sleep 30
        fetch
        push h1 deliver/step
        pullRequest deliver/step main h1
        delete sentinel/gate-1a-step
        log delivered
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        rangement
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":3,"polls":5},"gate":"ran","published":["deliver/step"],"base":"p0","pullRequest":{"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true,"body":"c84e7ea5eebd72d354680525d104a6ca78bb55a4ebe2d5cc1ba8cb7cd9bde496"}}
        """

    Scenario: no runner at the last permitted attempt: no rerun, stopped
      Given the delivery setting "ciAttempts" is 3
      And the delivery CI answers "no-runner"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "aucun runner après le nombre de tentatives permis"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        rerun 42
        sleep 30
        sleep 30
        rerun 42
        sleep 30
        sleep 30
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":3,"polls":5},"gate":"ran","published":[],"base":"p0","phase":"CI","reason":"aucun runner après le nombre de tentatives permis"}
        """

    Scenario: no runner with a single attempt allowed: no rerun at all
      Given the delivery setting "ciAttempts" is 1
      And the delivery CI answers "no-runner"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "aucun runner après le nombre de tentatives permis"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """

    Scenario: no runner, then a job that failed on a step
      Given the delivery CI answers "no-runner, failed"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "CI rouge"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        rerun 42
        sleep 30
        sleep 30
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """

    Scenario: no runner on the last poll: no rerun nobody would watch
      Given the delivery setting "ciPolls" is 3
      And the delivery setting "ciAttempts" is 5
      And the delivery CI answers "no-runner"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "CI sans réponse"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        rerun 42
        sleep 30
        sleep 30
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":2,"polls":3},"gate":"ran","published":[],"base":"p0","phase":"CI","reason":"CI sans réponse"}
        """

    Scenario: no runner on the only poll: no rerun at all
      Given the delivery setting "ciPolls" is 1
      And the delivery setting "ciAttempts" is 5
      And the delivery CI answers "no-runner"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "CI" because "CI sans réponse"
      And the delivery calls named "rerun" are:
        """
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"base":"p0","phase":"CI","reason":"CI sans réponse"}
        """

    Scenario: the seconds between two polls are the ones of the file
      Given the delivery setting "pollSeconds" is 7
      And the delivery CI answers "waiting, green"
      When I deliver "step" until "end"
      Then the delivery clock slept 7 seconds

  Rule: the publication

    Scenario: a work branch that appeared on the remote since the first fetch
      Given the delivery remote branch "deliver/step" moves to "p0" after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery calls named "push, pullRequest" are:
        """
        push h1 sentinel/gate-1a-step
        """

    Scenario: a work branch found at the commit that was deleted since: nothing is pushed, no pull request
      Given the delivery remote branch "deliver/step" is at "h1"
      And the delivery remote branch "deliver/step" is deleted after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery calls named "push, pullRequest" are:
        """
        push h1 sentinel/gate-1a-step
        """

    Scenario: a work branch found at the commit is not pushed again
      Given the delivery remote branch "deliver/step" is at "h1"
      When I deliver "step" until "end"
      Then the delivery calls named "push, pullRequest" are:
        """
        push h1 sentinel/gate-1a-step
        pullRequest deliver/step main h1
        """
      And the delivery outcome is "delivered"

    Scenario: a push of the work branch that is refused: no pull request, the trial branch kept
      Given the delivery push to "deliver/step" is refused
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "push refusé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 deliver/step
        log stopped
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"base":"p0","phase":"publication","reason":"push refusé"}
        """

    Scenario: a pull request the forge refuses: the trial branch kept, the work branch pushed
      Given the forge of the delivery sequence refuses every new pull request
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 deliver/step
        pullRequest deliver/step main h1
        log stopped
        """
      And the delivery result is:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["deliver/step"],"base":"p0","phase":"publication","reason":"la forge a refusé la pull request"}
        """
      And the delivery log holds exactly the result

    Scenario: a draft pull request already open for the work branch is not taken, and nothing else is opened
      Given a draft pull request from "deliver/step" to "main" is open on the forge of the delivery sequence
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une pull request en brouillon est ouverte pour cette tête"
      And the delivery forge holds only the draft pull request

    Scenario: the title of the pull request is the template of the file with the name
      Given the delivery setting "pullRequestTitle" is the text "Step ${name}, delivered"
      When I deliver "step" until "end"
      Then the delivery pull request was asked from "deliver/step" to "main" with the title "Step step, delivered" and the body of the record

  Rule: the doubles

    Scenario: a journal of a scenario that made no call is empty
      Then the delivery journal is empty
