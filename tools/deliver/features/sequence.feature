Feature: The delivery command over in-memory ports (the six phases, each reason, the acts in order)
  The doubles record every call. The trial branch is "sentinel/gate-1a-step", the commit "h1", both branches at "p0".

  Background:
    Given a delivery over the in-memory ports, the commit "h1" ahead of both branches at "p0"

  Rule: a delivery goes through the six phases for the one commit

    Scenario: the whole delivery, with a gate that runs
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
        push h1 main
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
      And the delivery calls named "isClean, head, remoteHead, isAncestor, deletedLines" are:
        """
        isClean
        head
        remoteHead feat/gate-1a
        remoteHead main
        isAncestor p0 h1
        isAncestor p0 h1
        deletedLines p0 h1 docs/design/journal.md
        remoteHead feat/gate-1a
        remoteHead main
        """
      And the delivery calls named "verdict, gate, ci" are:
        """
        verdict
        gate
        verdict
        ci h1 gate
        """
      And the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        push h1 feat/gate-1a
        ruleSuite feat/gate-1a h1
        push h1 main
        ruleSuite main h1
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
        """
      And the delivery log holds exactly the result
      And the delivery clock slept 0 seconds

    Scenario: a verdict that already names the commit: the gate is not run again
      Given the delivery gate verdict already names "h1"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        fetch
        push h1 feat/gate-1a
        push h1 main
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
      And the delivery calls named "verdict, gate" are:
        """
        verdict
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"reused","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
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

    Scenario: until the CI: no push to a branch, the trial branch kept
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
        {"outcome":"ready","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
        """
      And the delivery log holds exactly the result

    Scenario: until the CI, a CI that is red still stops the run
      Given the delivery CI answers "failed"
      When I deliver "step" until "ci"
      Then the delivery stopped at the phase "CI" because "CI rouge"

    Scenario: a delivery resumed when the first branch is already at the hash: only the second is pushed, the first is still read
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 main
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
      And the delivery calls named "ruleSuite" are:
        """
        ruleSuite feat/gate-1a h1
        ruleSuite main h1
        """
      And the delivery calls named "isAncestor, deletedLines" are:
        """
        isAncestor p0 h1
        deletedLines p0 h1 docs/design/journal.md
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
        """
      And the delivery log holds exactly the result

    Scenario: a delivery of a single branch
      Given the delivery branches are "main"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 main
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

    Scenario: no append-only file to watch
      Given the delivery append-only files are ""
      When I deliver "step" until "end"
      Then the delivery calls named "deletedLines" are:
        """
        """
      And the delivery outcome is "delivered"

  Rule: a precondition that fails ends the run before any act of the later phases, and logs nothing

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

    Scenario: a branch that is absent from the remote
      Given the delivery remote branch "main" is absent
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "branche distante absente"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery calls named "isAncestor, deletedLines" are:
        """
        """
      And the delivery log holds no entry

    Scenario: an absent branch is told before a branch that is not an ancestor
      Given the delivery remote branch "main" is absent
      And the delivery remote branch "feat/gate-1a" is at "x9"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "branche distante absente"
      And the delivery calls named "isAncestor" are:
        """
        """

    Scenario: a remote branch that is not an ancestor of the commit
      Given the delivery remote branch "feat/gate-1a" is at "x9"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "la branche distante n'est pas un ancêtre du commit"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery log holds no entry

    Scenario: the second branch is not an ancestor of the commit
      Given the delivery remote branch "main" is at "p2"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "la branche distante n'est pas un ancêtre du commit"
      And the delivery calls named "isAncestor" are:
        """
        isAncestor p0 h1
        isAncestor p2 h1
        """

    Scenario: two branches at two different parents
      Given the delivery remote branch "main" is at "p1"
      And the delivery history holds "p1" as an ancestor of "h1"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "les branches distantes diffèrent"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery calls named "deletedLines" are:
        """
        """
      And the delivery log holds no entry

    Scenario: every branch already at the commit: nothing to deliver
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery remote branch "main" is at "h1"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "rien à livrer"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery calls named "isAncestor, deletedLines, ruleSuite" are:
        """
        """
      And the delivery log holds no entry

    Scenario: an append-only file that lost one line
      Given the delivery file "docs/design/journal.md" lost 1 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "un fichier en ajout seul a perdu des lignes"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery calls named "deletedLines" are:
        """
        deletedLines p0 h1 docs/design/journal.md
        """
      And the delivery log holds no entry

    Scenario: the first append-only file lost lines: the second is not read
      Given the delivery append-only files are "a.md, b.md"
      And the delivery file "a.md" lost 2 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "un fichier en ajout seul a perdu des lignes"
      And the delivery calls named "deletedLines" are:
        """
        deletedLines p0 h1 a.md
        """

    Scenario: the second append-only file lost lines
      Given the delivery append-only files are "a.md, b.md"
      And the delivery file "b.md" lost 5 lines
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "un fichier en ajout seul a perdu des lignes"
      And the delivery calls named "deletedLines" are:
        """
        deletedLines p0 h1 a.md
        deletedLines p0 h1 b.md
        """

    Scenario: a name that is not a branch name
      When I deliver "--force" until "end"
      Then the delivery stopped at the phase "préalables" because "nom de branche d'essai refusé"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery log holds no entry

    Scenario: a trial branch that is one of the branches to publish
      Given the delivery branches are "feat/gate-1a, sentinel/gate-1a-step"
      And the delivery remote branch "sentinel/gate-1a-step" is at "p0"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "préalables" because "nom de branche d'essai refusé"
      And the delivery acts are:
        """
        fetch
        """
      And the delivery phases reported are:
        """
        préalables
        """
      And the delivery log holds no entry

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
        {"outcome":"stopped","phase":"branche d'essai","reason":"push de la branche d'essai refusé","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":0,"polls":0},"published":[],"ruleSuites":{}}
        """
      And the delivery log holds exactly the result

  Rule: the gate

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
        {"outcome":"stopped","phase":"porte","reason":"porte rouge","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":0,"polls":0},"gate":"ran","published":[],"ruleSuites":{}}
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
        {"outcome":"stopped","phase":"CI","reason":"CI rouge","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
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
        push h1 feat/gate-1a
        push h1 main
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
        ci h1 gate
        ci h1 gate
        ci h1 gate
        """
      And the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":3},"gate":"ran","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
        """
      And the delivery clock slept 60 seconds

    Scenario: a CI with no run yet, then green
      Given the delivery CI answers "missing, green"
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":2},"gate":"ran","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
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
        ci h1 gate
        ci h1 gate
        ci h1 gate
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"CI","reason":"CI sans réponse","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":3},"gate":"ran","published":[],"ruleSuites":{}}
        """

    Scenario: a CI with no run at all within the polls
      Given the delivery setting "ciPolls" is 2
      And the delivery CI answers "missing"
      When I deliver "step" until "end"
      Then the delivery result is:
        """
        {"outcome":"stopped","phase":"CI","reason":"CI sans réponse","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":0,"polls":2},"gate":"ran","published":[],"ruleSuites":{}}
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
        push h1 feat/gate-1a
        push h1 main
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
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":3,"polls":5},"gate":"ran","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
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
        {"outcome":"stopped","phase":"CI","reason":"aucun runner après le nombre de tentatives permis","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":3,"polls":5},"gate":"ran","published":[],"ruleSuites":{}}
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
        {"outcome":"stopped","phase":"CI","reason":"CI sans réponse","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":2,"polls":3},"gate":"ran","published":[],"ruleSuites":{}}
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
        {"outcome":"stopped","phase":"CI","reason":"CI sans réponse","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
        """

    Scenario: the seconds between two polls are the ones of the file
      Given the delivery setting "pollSeconds" is 7
      And the delivery CI answers "waiting, green"
      When I deliver "step" until "end"
      Then the delivery clock slept 7 seconds

  Rule: the publication

    Scenario: the first branch moved on the remote since the first fetch
      Given the delivery remote branch "feat/gate-1a" moves to "p9" after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"une branche distante a bougé","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
        """
      And the delivery log holds exactly the result

    Scenario: the last branch moved on the remote since the first fetch
      Given the delivery remote branch "main" moves to "p9" after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """

    Scenario: every branch is read again before publication: the one at the hash too
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      When I deliver "step" until "end"
      Then the delivery outcome is "delivered"
      And the delivery calls named "remoteHead" are:
        """
        remoteHead feat/gate-1a
        remoteHead main
        remoteHead feat/gate-1a
        remoteHead main
        """

    Scenario: a branch found at the hash that moved to another commit: nothing is pushed, no rule suite is read
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery remote branch "feat/gate-1a" moves to "p9" after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery calls named "ruleSuite" are:
        """
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"une branche distante a bougé","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
        """

    Scenario: a branch found at the hash that was deleted: nothing is pushed, no rule suite is read
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery remote branch "feat/gate-1a" is deleted after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery calls named "ruleSuite" are:
        """
        """

    Scenario: a branch found at the parent that moved, the other being at the hash: nothing is pushed, no rule suite is read
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery remote branch "main" moves to "p9" after the first fetch
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "une branche distante a bougé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery calls named "ruleSuite" are:
        """
        """

    Scenario: a push of the first branch that is refused
      Given the delivery push to "feat/gate-1a" is refused
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "push refusé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"push refusé","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
        """

    Scenario: a push of the second branch that is refused
      Given the delivery push to "main" is refused
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "push refusé"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
        push h1 main
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"push refusé","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["feat/gate-1a"],"ruleSuites":{"feat/gate-1a":"pass"}}
        """

    Scenario: a rule suite that is not found twice, then pass: the second branch waits for it
      Given the delivery rule suite of "feat/gate-1a" answers "none, none, pass"
      When I deliver "step" until "end"
      Then the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
        sleep 30
        sleep 30
        push h1 main
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
      And the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        push h1 feat/gate-1a
        ruleSuite feat/gate-1a h1
        ruleSuite feat/gate-1a h1
        ruleSuite feat/gate-1a h1
        push h1 main
        ruleSuite main h1
        """
      And the delivery clock slept 60 seconds

    Scenario: a rule suite that is never found
      Given the delivery rule suite of "feat/gate-1a" answers "none"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "évaluation du ruleset introuvable"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
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
        publication
        """
      And the delivery calls named "ruleSuite" are:
        """
        ruleSuite feat/gate-1a h1
        ruleSuite feat/gate-1a h1
        ruleSuite feat/gate-1a h1
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"évaluation du ruleset introuvable","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["feat/gate-1a"],"ruleSuites":{}}
        """

    Scenario: a single read of the rule suite allowed
      Given the delivery setting "ruleSuitePolls" is 1
      And the delivery rule suite of "feat/gate-1a" answers "none, pass"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "évaluation du ruleset introuvable"
      And the delivery clock slept 0 seconds

    Scenario: a rule suite that bypassed on the first branch: the second is never pushed and the trial branch is kept
      Given the delivery rule suite of "feat/gate-1a" answers "bypass"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "le ruleset n'a pas rendu pass"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"le ruleset n'a pas rendu pass","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["feat/gate-1a"],"ruleSuites":{"feat/gate-1a":"bypass"}}
        """
      And the delivery log holds exactly the result

    Scenario: a rule suite that failed on the first branch
      Given the delivery rule suite of "feat/gate-1a" answers "fail"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "le ruleset n'a pas rendu pass"
      And the delivery calls named "push" are:
        """
        push h1 sentinel/gate-1a-step
        push h1 feat/gate-1a
        """

    Scenario: a rule suite that is not found, then bypassed
      Given the delivery rule suite of "feat/gate-1a" answers "none, bypass"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "le ruleset n'a pas rendu pass"
      And the delivery clock slept 30 seconds

    Scenario: a rule suite that failed on the second branch: the trial branch is kept
      Given the delivery rule suite of "main" answers "fail"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "le ruleset n'a pas rendu pass"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        push h1 feat/gate-1a
        push h1 main
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"le ruleset n'a pas rendu pass","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"fail"}}
        """

    Scenario: a first branch already at the hash is read and passes: the second is pushed
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      When I deliver "step" until "end"
      Then the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        ruleSuite feat/gate-1a h1
        push h1 main
        ruleSuite main h1
        """
      And the delivery outcome is "delivered"

    Scenario: a first branch already at the hash whose rule suite bypassed: the second is never pushed, the trial branch is kept
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery rule suite of "feat/gate-1a" answers "bypass"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "le ruleset n'a pas rendu pass"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        ruleSuite feat/gate-1a h1
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"le ruleset n'a pas rendu pass","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{"feat/gate-1a":"bypass"}}
        """

    Scenario: a first branch already at the hash whose rule suite failed
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery rule suite of "feat/gate-1a" answers "fail"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "le ruleset n'a pas rendu pass"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
        log stopped
        """
      And the delivery phases reported are:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        """
      And the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        ruleSuite feat/gate-1a h1
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"le ruleset n'a pas rendu pass","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{"feat/gate-1a":"fail"}}
        """

    Scenario: a first branch already at the hash whose rule suite is never found
      Given the delivery remote branch "feat/gate-1a" is at "h1"
      And the delivery rule suite of "feat/gate-1a" answers "none"
      When I deliver "step" until "end"
      Then the delivery stopped at the phase "publication" because "évaluation du ruleset introuvable"
      And the delivery acts are:
        """
        fetch
        push h1 sentinel/gate-1a-step
        gate
        fetch
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
        publication
        """
      And the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        ruleSuite feat/gate-1a h1
        ruleSuite feat/gate-1a h1
        ruleSuite feat/gate-1a h1
        """
      And the delivery result is:
        """
        {"outcome":"stopped","phase":"publication","reason":"évaluation du ruleset introuvable","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"run":42,"attempts":1,"polls":1},"gate":"ran","published":[],"ruleSuites":{}}
        """

    Scenario: a second branch already at the hash is read after the first is pushed and read
      Given the delivery remote branch "main" is at "h1"
      When I deliver "step" until "end"
      Then the delivery calls named "push, ruleSuite" are:
        """
        push h1 sentinel/gate-1a-step
        push h1 feat/gate-1a
        ruleSuite feat/gate-1a h1
        ruleSuite main h1
        """
      And the delivery outcome is "delivered"

  Rule: the doubles

    Scenario: a journal of a scenario that made no call is empty
      Then the delivery journal is empty

    Scenario: the forge evaluates only a push that left the branch at the commit
      Then the delivery forge gives no rule suite of the branch "main" at "h1"
      When the delivery repository pushes "h1" to "main"
      Then the delivery forge gives the rule suite "pass" of the branch "main" at "h1"
