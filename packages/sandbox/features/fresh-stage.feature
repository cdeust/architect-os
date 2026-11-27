Feature: the stage of the fresh inputs: where the host puts their scenarios while the runner plays them
  The host stages the scenarios of the fresh inputs outside the worktree, in the private temporary folder of the
  admitted run, $ARCHITECT_OS_RUN_DIR/tmp/fresh/<step>/, checked private like the outputs of a step; it creates each file
  with O_CREAT, O_EXCL and O_NOFOLLOW, gives the runner its absolute path, and removes the folder at the end of the phase
  (src/fresh-stage.ts). The checker profile reads the folder through its variable ${inputs}, which the adapter accepts
  only for such a folder (inputsFolder, src/srt-runner.ts). The same contract runs on the folder on disk and in memory.

  Background:
    Given a bound run for the runtime entry check
    And a private temporary folder of that run

  Scenario Outline: two scenarios are written, given back by their absolute paths, and removed: <adapter>
    Given a fresh stage of the step "demo" on <adapter>
    When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
    Then the fresh stage gave the paths "fresh-1.feature fresh-2.feature" in its folder
    And the fresh stage holds "fresh-1.feature" with its text
    When the fresh stage is removed
    Then the fresh stage holds nothing

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Scenario Outline: a second write before the removal is refused: <adapter>
    Given a fresh stage of the step "demo" on <adapter>
    When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
    Then writing "fresh-3.feature" to the fresh stage fails with "EEXIST"

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Scenario Outline: after a removal the stage can be written again: <adapter>
    Given a fresh stage of the step "demo" on <adapter>
    When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
    And the fresh stage is removed
    And the fresh stage writes "fresh-10.feature" and "fresh-16.feature"
    Then the fresh stage gave the paths "fresh-10.feature fresh-16.feature" in its folder
    And the fresh stage holds "fresh-16.feature" with its text

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Scenario Outline: a name the host did not give is refused before anything is written: <name> on <adapter>
    Given a fresh stage of the step "demo" on <adapter>
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

  Scenario Outline: a removal with nothing written does nothing: <adapter>
    Given a fresh stage of the step "demo" on <adapter>
    When the fresh stage is removed
    Then the fresh stage holds nothing

    Examples:
      | adapter |
      | disk    |
      | memory  |

  Rule: on disk, the stage is the private folder of the run, and nothing redirects the host

    Scenario: the folder of the stage is under the temporary folder of the run, private, and its files are private, whatever the umask
      Given a fresh stage of the step "demo" on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature" under the umask 000
      Then the folder of the fresh stage is "tmp/fresh/demo" under the run
      And the folder of the fresh stage has the mode 700
      And the folder "tmp/fresh" of the run has the mode 700
      And the file "fresh-1.feature" of the fresh stage has the mode 600

    Scenario Outline: a <kind> planted at the path of the stage refuses the write, nothing is written through it, and it stays after the removal
      Given a fresh stage of the step "demo" on disk whose path already holds a <kind>
      Then writing "fresh-1.feature" to the fresh stage fails with "<message>"
      When the fresh stage is removed
      Then the path of the fresh stage still holds the <kind>
      And the target outside the run holds no file

      Examples:
        | kind                            | message |
        | directory                       | EEXIST  |
        | file                            | EEXIST  |
        | link to a directory outside it  | EEXIST  |
        | dangling link                   | EEXIST  |

    Scenario: a link planted in place of tmp/fresh refuses the write, and nothing is written through it
      Given a fresh stage of the step "demo" on disk whose parent "tmp/fresh" is a link to a directory outside the run
      Then writing "fresh-1.feature" to the fresh stage fails with "unsafe private state directory"
      And the target outside the run holds no file

    Scenario: a link swapped in at the path of a file during the write cannot redirect the host
      Given a fresh stage of the step "demo" on disk
      And a link to a file outside the run is planted at the path of "fresh-2.feature" just before the host opens it
      Then writing "fresh-1.feature" and "fresh-2.feature" to the fresh stage fails with "EEXIST"
      And the file outside the run is still "outside\n"

    Scenario: a temporary folder of the run that is not private refuses the write
      Given a fresh stage of the step "demo" on disk
      And the temporary folder of the run has the mode 755
      Then writing "fresh-1.feature" to the fresh stage fails with "unsafe private state directory"

    Scenario: a run that is not admitted refuses the write
      Given a fresh stage of the step "demo" on disk outside an admitted run
      Then writing "fresh-1.feature" to the fresh stage fails with "RUNTIME_ENTRY_REQUIRED"

    Scenario: a stage replaced by a file between the write and the removal is refused, and the file stays
      Given a fresh stage of the step "demo" on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      And the folder of the fresh stage is replaced by a file
      Then removing the fresh stage fails with "n'est pas un dossier ordinaire"
      And the path of the fresh stage still holds the file

    Scenario: a second removal does not remove what someone else put at the path after the first
      Given a fresh stage of the step "demo" on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      And the fresh stage is removed
      And someone else puts a directory at the path of the fresh stage
      And the fresh stage is removed
      Then the path of the fresh stage still holds the directory

    Scenario: a stage removed by someone else between the write and the removal is not an error
      Given a fresh stage of the step "demo" on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      And the folder of the fresh stage is removed by someone else
      And the fresh stage is removed
      Then the fresh stage holds nothing

  Rule: the checker reads through ${inputs} the worktree, or the stage of a step, and nothing else

    Scenario: without a folder given, ${inputs} is the worktree
      Then the inputs folder given nothing is the worktree

    Scenario: the stage of a step is accepted as ${inputs}
      Given a fresh stage of the step "demo" on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      Then the inputs folder given the folder of the fresh stage is that folder

    Scenario Outline: a folder that is not the stage of a step is refused as ${inputs}: <folder>
      Given a fresh stage of the step "demo" on disk
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      Then the inputs folder given <folder> is refused

      Examples:
        | folder                                  |
        | the temporary folder of the run         |
        | the folder tmp/fresh of the run         |
        | a folder named a_b under tmp/fresh      |
        | a link under tmp/fresh to the stage     |
        | the home folder                         |

  Rule: the host gives the checker the stage of the step, and closes what it opens

    Scenario: every file the stage opens is closed, once each
      Given a fresh stage of the step "demo" on disk
      And the host counts the files it opens and closes
      When the fresh stage writes "fresh-1.feature" and "fresh-2.feature"
      Then the host closed each file it opened for the stage, once

    Scenario: the step dependencies stage the fresh inputs of a step in the temporary folder of the run
      Then the step dependencies of that run stage the step "demo" in "tmp/fresh/demo" under the run

    Scenario Outline: the variables of the launcher for a check given <inputs> are <variables>
      Then the variables of a check given <inputs> are <variables>

      Examples:
        | inputs                       | variables                                |
        | no inputs folder             | {}                                       |
        | the folder "/r/tmp/fresh/x"  | {"inputs":"/r/tmp/fresh/x"}              |

    Scenario: the adapter gives the checker profile the stage of the step to read, through ${inputs}
      Given a fresh stage of the step "demo" in the admitted run of this suite
      And an srt runner over a throwaway git repository whose srt prints its settings, given that stage as inputs
      When I start a checker sandbox that prints its settings
      Then the settings srt received allow reading the stage

    Scenario: without an inputs folder, the adapter gives the checker profile the worktree, and no stage
      Given an srt runner over a throwaway git repository whose srt prints its settings
      When I start a checker sandbox that prints its settings
      Then the settings srt received allow reading the worktree and nothing under tmp/fresh
