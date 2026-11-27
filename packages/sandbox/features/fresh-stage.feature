Feature: the stage of the fresh inputs: where the host puts their scenarios while the runner plays them
  The host creates one folder at the root of the worktree after the build, writes there the scenarios it named, and
  removes it at the end of the phase; the phase never commits it (src/fresh-stage.ts). The same contract runs on the
  folder on disk and on the one in memory.

  Scenario Outline: two scenarios are written, given back by their paths from the root, and removed: <adapter>
    Given a fresh stage on <adapter>
    When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
    Then the fresh stage gave the paths ".architect-os-fresh-inputs/fresh-1.feature .architect-os-fresh-inputs/fresh-2.feature"
    And the fresh stage holds "fresh-1.feature" with its text
    When the fresh stage is removed
    Then the fresh stage holds nothing

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Scenario Outline: a second write before the removal is refused: <adapter>
    Given a fresh stage on <adapter>
    When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
    Then writing "fresh-3.feature" to the fresh stage fails with "EEXIST"

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Scenario Outline: a name the host did not give is refused before anything is written: <name> on <adapter>
    Given a fresh stage on <adapter>
    Then writing "<name>" to the fresh stage fails with "nom de scénario refusé"
    And the fresh stage holds nothing

    Examples:
      | adapter | name               |
      | disk    | ../fresh-1.feature |
      | disk    | fresh-0.feature    |
      | disk    | fresh-100.feature  |
      | disk    | fresh-1.feature.sh |
      | disk    | fresh-1x.feature   |
      | disk    | x/fresh-1.feature  |
      | memory  | ../fresh-1.feature |
      | memory  | fresh-0.feature    |

  Scenario Outline: after a removal the stage can be written again: <adapter>
    Given a fresh stage on <adapter>
    When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
    And the fresh stage is removed
    And the fresh stage writes "fresh-10.feature" and "fresh-16.feature"
    Then the fresh stage gave the paths ".architect-os-fresh-inputs/fresh-10.feature .architect-os-fresh-inputs/fresh-16.feature"
    And the fresh stage holds "fresh-16.feature" with its text

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Scenario Outline: a removal with nothing written does nothing: <adapter>
    Given a fresh stage on <adapter>
    When the fresh stage is removed
    Then the fresh stage holds nothing

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Rule: on disk, what the host did not create it neither writes through nor removes

    Scenario Outline: a <kind> already at the path of the stage refuses the write, and stays as it was after the removal
      Given a fresh stage on disk whose path already holds a <kind>
      Then writing "fresh-1.feature" to the fresh stage fails with "EEXIST"
      When the fresh stage is removed
      Then the path of the fresh stage still holds the <kind>
      And the target outside the worktree holds no file

      Examples:
        | kind                            |
        | directory                       |
        | file                            |
        | link to a directory outside it  |
        | dangling link                   |

    Scenario: a stage replaced by a file between the write and the removal is refused, and the file stays
      Given a fresh stage on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      And the folder of the fresh stage is replaced by a file
      Then removing the fresh stage fails with "n'est pas un dossier ordinaire du worktree"
      And the path of the fresh stage still holds the file

    Scenario: a second removal does not remove what someone else put at the path after the first
      Given a fresh stage on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      And the fresh stage is removed
      And someone else puts a directory at the path of the fresh stage
      And the fresh stage is removed
      Then the path of the fresh stage still holds the directory

    Scenario: a stage removed by someone else between the write and the removal is not an error
      Given a fresh stage on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      And the folder of the fresh stage is removed by someone else
      And the fresh stage is removed
      Then the fresh stage holds nothing

    Scenario: the files written are regular files, private to the user the host and its sandboxes run as, whatever the umask
      Given a fresh stage on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature" under the umask 000
      Then the file "fresh-1.feature" of the fresh stage has the mode 600
      And the folder of the fresh stage has the mode 700
