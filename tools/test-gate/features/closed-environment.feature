Feature: the gate reads its own repository, whatever the environment it was started in
  The gate starts git with a closed list of variables of the host (PATH, LANG, LC_ALL, LC_CTYPE, TMPDIR), and no global nor system configuration of git: a GIT_DIR
  of the process does not move what it reads (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »).

  The expectation (head, first parent, diff) is recorded through the gate's own git before GIT_DIR is set; the poison comes after.

  Scenario: a GIT_DIR of the process that names another repository changes neither the head, nor the first parent, nor the diff
    Given a gate repository
    And the gate repository file "notes.txt" reads:
      """
      first
      """
    And the gate first parent is committed
    And the gate repository file "notes.txt" reads:
      """
      second
      """
    And the gate head is committed
    And the gate repository file "notes.txt" reads:
      """
      third
      """
    And the expectation is taken from the gate repository, before the poison
    And a second gate repository with its own commit
    And the GIT_DIR of the process names the second gate repository
    When the gate reads its repository
    Then the head it read is the head of the gate repository
    And the first parent it read is the first parent of the gate repository
    And the diff it read adds the line "third" to "notes.txt"

  Rule: the git of the gate receives exactly the names of its list that the process set, and no other

    The fake git records the names of its environment. The Background sets the five names of the list (PATH is the one of
    the fake git), and a HOME, which is not in the list; a scenario then unsets one, or sets a name outside the list.

    Background:
      Given a gate repository
      And a fake git first on the PATH of the process, which records the names of its environment
      And the process has the variable "HOME" set to "/nowhere/home"
      And the process has the variable "LANG" set to "C"
      And the process has the variable "LC_ALL" set to "C"
      And the process has the variable "LC_CTYPE" set to "C"
      And the process has the variable "TMPDIR" set to "/tmp"

    Scenario: the five names of the list that the process set are received, and the fixed Git configuration and attributes settings
      Given the process has the variable "GIT_ATTR_NOSYSTEM" set to "0"
      When the gate asks its git for the head
      Then every call of the fake git of the gate received exactly the names "GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, LANG, LC_ALL, LC_CTYPE, PATH, TMPDIR"
      And every call of the fake git of the gate received the two configuration variables set to the empty file and system attributes disabled

    Scenario Outline: a name of the list that the process does not set is not received: <name>
      Given the process has no variable "<name>"
      When the gate asks its git for the head
      Then every call of the fake git of the gate received exactly the names "<received>"

      Examples:
        | name     | received                                |
        | LANG     | GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, LC_ALL, LC_CTYPE, PATH, TMPDIR |
        | LC_ALL   | GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, LANG, LC_CTYPE, PATH, TMPDIR   |
        | LC_CTYPE | GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, LANG, LC_ALL, PATH, TMPDIR     |
        | TMPDIR   | GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, LANG, LC_ALL, LC_CTYPE, PATH   |

    Scenario Outline: a name outside the list that the process sets is not received: <name>
      Given the process has the variable "<name>" set to "<value>"
      When the gate asks its git for the head
      Then every call of the fake git of the gate received exactly the names "GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, LANG, LC_ALL, LC_CTYPE, PATH, TMPDIR"

      Examples:
        | name          | value         |
        | GITHUB_TOKEN  | secret        |
        | NODE_OPTIONS  | --no-warnings |
        | GIT_EXEC_PATH | /nowhere/exec |

    Scenario: the call is started with the attributes of the empty tree, no file monitor, no hook and no descent into a nested repository, before the subcommand
      When the gate asks its git for the head
      Then the fake git of the gate was started once as "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.quotePath=false -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all rev-list --parents -n 1 HEAD"

  Rule: the gate reads a repository that names a program as its file monitor without that program running

    Background:
      Given a gate repository
      And the gate repository file "notes.txt" reads:
        """
        first
        """
      And the gate first parent is committed
      And the gate repository file "notes.txt" reads:
        """
        second
        """
      And the gate head is committed
      And the gate repository file "notes.txt" reads:
        """
        third
        """
      And the expectation is taken from the gate repository, before the poison
      And the configuration of the gate repository names a witness program as its core.fsmonitor

    Scenario: the witness program named as core.fsmonitor is not run by the gate
      When the gate reads its repository
      Then the diff it read adds the line "third" to "notes.txt"
      And the witness program of the gate has not run

    Scenario: the same witness program, named only by the configuration of the repository, is run by a git started without the options of the gate, so that the scenario above can fail
      When git is asked for the diff with none of the options of the gate
      Then the witness program of the gate has run

  Rule: the gate enters no repository nested in its tree, and judges no tree that holds one

    A session can leave a repository in its worktree, with a configuration of its own that names a program (here the
    `clean` filter of one of its files). Once the host has committed the work, git records that repository as an entry of
    mode 160000 and, asked for a status or a diff, enters it and starts the program: on the host, outside any sandbox.

    Background:
      Given a gate repository
      And the gate repository file "notes.txt" reads:
        """
        first
        """
      And the gate first parent is committed
      And a repository nested in the gate repository at "sub" names a witness program as a filter

    Scenario: a nested repository that is not tracked is refused, and its program does not run
      Then the gate refuses to read its changes with "dépôt imbriqué dans l'arbre : sub/"
      And the witness program of the gate has not run

    Scenario: a nested repository that the head records is refused, and its program does not run
      Given the gate head is committed
      Then the gate refuses to read its changes with "dépôt imbriqué dans l'arbre : sub"
      And the witness program of the gate has not run

    Scenario: a nested repository that the head records, gone from the index and from the tree, is refused
      Given the gate head is committed
      And the nested repository "sub" leaves the index and the tree of the gate repository
      Then the gate refuses to read its changes with "dépôt imbriqué dans l'arbre : sub"

    Scenario: the git of the gate, asked for the changed paths and for a patch of a tree whose head records the nested repository, does not start its program, though the `.gitmodules` of the tree asks git to look into it
      Given the gate head is committed
      When the gate asks its git for the changed paths and for the patch of "notes.txt"
      Then the witness program of the gate has not run

    Scenario: the nested patch exposes the witness when only configuration suppresses submodules
      Given the gate head is committed
      When the fixture Git requests the nested patch without the command line submodule guard
      Then the witness program of the gate has run

    Scenario: the same program is started by a git asked for the status without the options of the gate, so that the scenarios above can fail
      Given the gate head is committed
      Then the witness program of the gate has not run
      When git is asked for the status with none of the options of the gate
      Then the witness program of the gate has run

  Scenario: the real gate adapter refuses an invalid-byte untracked name before selection
    Given a gate repository
    And the gate first parent is committed
    And the gate repository holds a filename that is not UTF-8
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "un chemin de git n'est pas de l'UTF-8"

  Scenario: a linked worktree is refused by its marker before Git classifies untracked paths
    Given a gate repository
    And the gate first parent is committed
    And a linked worktree with an external gitdir is inside the gate repository
    Then the gate refuses to read its changes with "dépôt imbriqué dans l'arbre : linked/"
    Given the gate repository file "linked/.git" reads:
      """
      gitdir: /missing-gitdir
      """
    Then the gate refuses to read its changes with "dépôt imbriqué dans l'arbre : linked/"
