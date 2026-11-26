Feature: every git the host starts takes its closed options and variables from one descriptive file
  packages/sandbox/git-closed.json holds what every git of the host is given before its subcommand, and the variables
  that set the same: no replace object or graft, the attributes of the empty tree and none of an attributes file the
  configuration names, no file monitor, no hook, no descent into a nested repository. The fingerprint, the gate, its
  guard and the delivery read it; four copies could drift, one file cannot.

  Scenario: the committed file loads against its schema, with each closed option and variable
    When the committed closed git file is loaded
    Then the closed git options are "--no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null"
    And the closed git variables are "GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1"

  Scenario Outline: a broken copy of the file is refused: <change>
    When a copy of the committed closed git file is read with the change "<change>"
    Then the closed git copy is refused with "<message>"
    And loading the closed git copy throws "<message>"

    Examples:
      | change                                | message                          |
      | text that is not JSON                 | git-closed.json : JSON invalide  |
      | no option                             | git-closed.json : schéma refusé  |
      | an option that is empty               | git-closed.json : schéma refusé  |
      | an option of the floor removed        | git-closed.json : schéma refusé  |
      | a variable of git it does not hold    | git-closed.json : schéma refusé  |
      | a variable of another name            | git-closed.json : schéma refusé  |
      | a closed variable set to 0            | git-closed.json : schéma refusé  |
      | a key of its own                      | git-closed.json : schéma refusé  |

  Scenario: an option the file adds beyond the floor is kept
    When a copy of the committed closed git file is read with the change "an option added"
    Then the closed git copy is accepted with the option "-c" "core.quotePath=false" last
