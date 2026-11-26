Feature: The gate judges the merge GitHub would build, first parent the destination, not the last commit of the branch
  In CI the head is GitHub's merge commit and its first parent is the destination. On a workstation the head is the
  branch: its own first parent is only its last commit, or the branch side of a merge of the destination into it. The
  gate takes as first parent the destination as the local repository knows it (the key `destination` of gate.json,
  `refs/remotes/origin/main` in the fixture), when the destination is in the history of the head; then the tree of the
  merge is the tree of the head, which is the tree the scenarios and the mutation run on. Otherwise it refuses by name.
  The production lines of the branch are mutated, those the destination brought are not.

  Background:
    Given a gate repository
    And the gate repository holds the fixture specs "green.feature"
    And the gate repository holds "src/math.mjs" of the mutation fixture "survivor" with line 3 changed
    And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature"
    And the gate first parent is committed

  Rule: the destination in the history of the head is the first parent judged

    Scenario: one commit on the destination: the first parent of the head, as before
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      When the gate plans the "linux" job
      Then the gate exits with 0
      And the gate plan is:
        """
        { "job": "linux", "head": "<head>", "firstParent": "<destination>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 1 }, "mutate": ["src/math.mjs"] }
        """

    Scenario: several commits on the destination: every commit of the branch is judged, not only the last
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature" with line 1 changed
      And the gate branch is committed
      When the gate plans the "linux" job
      Then the gate exits with 0
      And the gate plan is:
        """
        { "job": "linux", "head": "<head>", "firstParent": "<destination>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 2 }, "mutate": ["mod/a/src/a.mjs", "src/math.mjs"] }
        """

    Scenario: the destination merged into the branch: the lines of the branch are mutated, those of the destination are not
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate destination gains a commit where "mod/a/src/a.mjs" is the mutation fixture "covered-by-feature" with line 1 changed
      And the gate head merges its destination
      When the gate plans the "linux" job
      Then the gate exits with 0
      And the gate plan is:
        """
        { "job": "linux", "head": "<head>", "firstParent": "<destination>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<destination>", "commits": 2 }, "mutate": ["src/math.mjs"] }
        """

    Scenario: the destination moved back to the first parent of the head: only the last commit is judged, and the plan says so
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate repository holds "mod/a/src/a.mjs" of the mutation fixture "covered-by-feature" with line 1 changed
      And the gate branch is committed
      And the gate destination is moved to the first parent of the head
      When the gate plans the "linux" job
      Then the gate exits with 0
      And the gate plan is:
        """
        { "job": "linux", "head": "<head>", "firstParent": "<parent>", "destination": { "reference": "refs/remotes/origin/main", "commit": "<parent>", "commits": 1 }, "mutate": ["mod/a/src/a.mjs"] }
        """

  Rule: a destination that does not let the gate judge that merge is refused by name

    Scenario: the destination has commits the head has not: integrate it first
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate destination gains a commit where "mod/a/src/a.mjs" is the mutation fixture "covered-by-feature" with line 1 changed
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output includes "GATE_DESTINATION_NOT_INTEGRATED : refs/remotes/origin/main a des commits que la tête n'a pas ; intégrer la destination d'abord"

    Scenario: the head does not merge into the destination without a conflict
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate destination gains a commit where "src/math.mjs" is the mutation fixture "survivor" with line 3 changed
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output includes "GATE_DESTINATION_CONFLICT : la tête ne se fusionne pas sans conflit dans refs/remotes/origin/main ; intégrer la destination d'abord"

    Scenario: the destination is absent from the repository
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate destination is deleted
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output includes "GATE_DESTINATION_MISSING : la destination refs/remotes/origin/main est absente du dépôt ; la récupérer avant la porte"

    Scenario: a destination moved to a commit made with the tree of the head, which would empty the diff, is refused
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate destination is moved to a commit made with the tree of the head
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output includes "GATE_DESTINATION_NOT_INTEGRATED"

    Scenario: a destination with a history unrelated to the head is not called a conflict: git's refusal stops the gate
      Given the gate repository holds "src/math.mjs" of the mutation fixture "survivor"
      And the gate branch is committed
      And the gate destination is moved to a root commit unrelated to the head
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output includes "merge-tree"
      And the gate output does not include "GATE_DESTINATION_CONFLICT"

  Rule: the decision on the facts git gives

    Scenario Outline: the refusal <refusal> says what to do
      Then the destination refusal "<refusal>" of "refs/remotes/origin/main" reads "<text>"

      Examples:
        | refusal                         | text                                                                                                                  |
        | GATE_DESTINATION_MISSING        | GATE_DESTINATION_MISSING : la destination refs/remotes/origin/main est absente du dépôt ; la récupérer avant la porte |
        | GATE_DESTINATION_CONFLICT       | GATE_DESTINATION_CONFLICT : la tête ne se fusionne pas sans conflit dans refs/remotes/origin/main ; intégrer la destination d'abord |
        | GATE_DESTINATION_NOT_INTEGRATED | GATE_DESTINATION_NOT_INTEGRATED : refs/remotes/origin/main a des commits que la tête n'a pas ; intégrer la destination d'abord |
        | GATE_DESTINATION_MISMATCH       | GATE_DESTINATION_MISMATCH : la fusion de refs/remotes/origin/main et de la tête n'a pas l'arbre de la tête |


    Scenario Outline: head "<head>", first parent "<parent>", destination "<destination>", behind <behind>, merge "<merged>": <decision>
      Then the gate decides, for these facts, "<decision>"
        | head   | parent   | destination   | behind   | ahead   | merged   | tree |
        | <head> | <parent> | <destination> | <behind> | <ahead> | <merged> | T    |

      Examples:
        | head | parent | destination | behind | ahead | merged   | decision                        |
        | H    | P      | H           | 0      | 0     | T        | P D=H 1                         |
        | H    | P      | P           | 0      | 1     | T        | P D=P 1                         |
        | H    | P      | D           | 0      | 3     | T        | D D=D 3                         |
        | H    | P      | D           | 0      | 3     | X        | GATE_DESTINATION_MISMATCH       |
        | H    | P      | D           | 2      | 3     | T        | GATE_DESTINATION_NOT_INTEGRATED |
        | H    | P      | D           | 1      | 3     | conflict | GATE_DESTINATION_CONFLICT       |
        | H    | P      |             | 0      | 0     | T        | GATE_DESTINATION_MISSING        |
        | H    |        |             | 0      | 0     | T        | none D=none 1                   |
        | H    |        | H           | 0      | 0     | T        | none D=H 1                      |

  Rule: in CI, the step of the workflow points the destination at the first parent of the commit the event judges

    No fetch: the live branch may have moved since GitHub built its merge commit, or since the push. The checkout is
    of depth 2, as actions/checkout leaves it; main of the forge has moved on by one commit after the merge commit.

    Scenario Outline: on <event>, after the step of gate.yml, the gate judges the first parent of the head, 1 commit
      Given a forge repository whose main has two commits and a pull request of one commit, with GitHub's merge commit
      And main of the forge has moved on since, and a trial branch is two commits ahead of the second commit of main
      And a checkout of depth 2 of <checkout>, as actions/checkout leaves it
      When the step of gate.yml that points the destination runs in that checkout
      Then the gate of that checkout takes <judged> as its first parent, the destination at it, 1 commit judged

      Examples:
        | event                    | checkout                  | judged                       |
        | a pull request           | the merge commit          | the second commit of main    |
        | a push to main           | the second commit of main | the first commit of main     |
        | a push to a trial branch | the trial branch          | the first commit of the trial |
