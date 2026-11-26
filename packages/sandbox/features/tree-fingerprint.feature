Feature: the fingerprint of the tree of a worktree
  The fingerprint says on which tree a step ran: the commit of HEAD, the git tree of the whole working tree (tracked and
  untracked files, without what .gitignore excludes) and whether that tree is the one of the commit. It is computed in a
  temporary index: the index of the worktree is not touched. Git is started by an argv, with a bound of time.

  Scenario: a clean tree is the tree of its commit
    Given a throwaway repository with one commit
    When I take the fingerprint of the repository
    Then the fingerprint commit is the HEAD of the repository
    And the fingerprint tree is the tree of HEAD
    And the fingerprint is clean

  Scenario: a tracked file changed gives the tree that committing the change would give
    Given a throwaway repository with one commit
    And the file "a.txt" of the repository holds "changed\n"
    When I take the fingerprint of the repository
    Then the fingerprint is not clean
    And the fingerprint tree is the tree that committing everything would give

  Scenario: an untracked file added gives the tree that committing it would give
    Given a throwaway repository with one commit
    And the file "new/b.txt" of the repository holds "new\n"
    When I take the fingerprint of the repository
    Then the fingerprint is not clean
    And the fingerprint tree is the tree that committing everything would give

  Scenario: an ignored file added leaves the tree clean
    Given a throwaway repository with one commit
    And the file "ignored.log" of the repository holds "noise\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean
    And the fingerprint tree is the tree of HEAD

  Scenario: two different contents give two trees, and the same content gives the same tree twice
    Given a throwaway repository with one commit
    And the file "a.txt" of the repository holds "one\n"
    When I take the fingerprint of the repository
    And I take the fingerprint of the repository again
    Then the two fingerprints are the same
    When the file "a.txt" of the repository holds "two\n"
    And I take the fingerprint of the repository again
    Then the two fingerprints have two different trees

  Scenario: the index of the worktree is not touched, and no temporary directory is left
    Given a throwaway repository with one commit
    And the file "a.txt" of the repository holds "changed\n"
    And the file "new.txt" of the repository holds "new\n"
    And a temporary directory that the fingerprint must leave empty
    When I take the fingerprint of the repository, noting the status and the index before and after
    Then the status and the index file are the same before and after
    And the status still lists the untracked file "new.txt"
    And the temporary directory is empty

  Scenario: a directory that is not a repository throws the fixed message
    Given a directory that is not a repository
    When I try to take the fingerprint of it
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : git rev-parse HEAD"

  Scenario Outline: a git call that never answers is stopped at the bound: <call>
    A shell fixture answers each preceding command without a Node startup. Its silent call replaces the shell
    with sleep, so the real timeout can stop it directly. The call log verifies which invocation reached the bound.

    Given a fake git with immediate responses before its deliberately silent call
    And the fake git never answers the call "<call>"
    And a temporary directory that the fingerprint must leave empty
    And a throwaway directory
    When I try to take the fingerprint of the directory with a bound of 1000 milliseconds
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : git <call>"
    And the timed out fake git call was "<call>"
    And the temporary directory is empty

    Examples:
      | call           |
      | rev-parse HEAD |
      | read-tree HEAD |
      | ls-files -s -z |
      | add -A         |
      | write-tree     |

  Scenario: the six git calls are argv with the options that switch off the monitor, the hooks, the attributes of the tree and the descent into a nested repository, and the temporary index
    Given a fake git that records its calls
    And a temporary directory that the fingerprint must leave empty
    And a throwaway directory
    When I take the fingerprint of the directory
    Then the fake git was called, in this order, with:
      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null rev-parse HEAD        | no index  |
      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null read-tree HEAD        | the index |
      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null ls-files -s -z        | the index |
      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null add -A                | the index |
      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null write-tree            | the index |
      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null rev-parse HEAD^{tree} | no index  |
    And the fake git ran in the directory
    And the temporary index was in the temporary directory
    And the temporary directory is empty

  Scenario: a tree that differs from the tree of the commit is not clean, and the same tree is
    Given a fake git that records its calls
    And the fake git answers the call "write-tree" with the hash "1111111111111111111111111111111111111111"
    And a throwaway directory
    When I take the fingerprint of the directory
    Then the fingerprint is not clean
    And the fingerprint commit is "cccccccccccccccccccccccccccccccccccccccc"
    And the fingerprint tree is "1111111111111111111111111111111111111111"

  Scenario Outline: a call that fails or prints what is not a hash throws the fixed message, which carries nothing git printed
    Given a fake git that records its calls
    And the fake git answers the call "<call>" with <answer>
    And a temporary directory that the fingerprint must leave empty
    And a throwaway directory
    When I try to take the fingerprint of the directory
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : git <call>"
    And the fingerprint error does not contain "MARKER"
    And the temporary directory is empty

    Examples:
      | call                | answer                                                                |
      | rev-parse HEAD      | the exit code 3 and a marker                                          |
      | read-tree HEAD      | the exit code 3 and a marker                                          |
      | ls-files -s -z      | the exit code 3 and a marker                                          |
      | add -A              | the exit code 3 and a marker                                          |
      | write-tree          | the exit code 3 and a marker                                          |
      | rev-parse HEAD^{tree} | the exit code 3 and a marker                                        |
      | rev-parse HEAD      | the text "MARKER" and the exit code 0                                 |
      | write-tree          | the text "MARKER" and the exit code 0                                 |
      | rev-parse HEAD^{tree} | the text "MARKER" and the exit code 0                               |
      | rev-parse HEAD      | the text "ccccccccccccccccccccccccccccccccccccccc" and the exit code 0 |
      | rev-parse HEAD      | the text "ccccccccccccccccccccccccccccccccccccccccc" and the exit code 0 |
      | rev-parse HEAD      | the text "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" and the exit code 0 |

  Rule: what the configuration of the repository replaces or adds is not what the fingerprint reads

    Scenario: a replace object of the head commit does not make the clean tree look changed
      Given a throwaway repository with one commit
      And the repository replaces its head commit by a commit of another tree
      When I take the fingerprint of the repository
      Then the fingerprint is clean

    Scenario: a filter named by an attributes file of the configuration does not run
      Given a throwaway repository with one commit
      And the configuration of the repository names an attributes file whose filter is a witness program
      And the file "a.txt" of the repository holds "changed\n"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the witness program of the configuration of the repository has not run

  Rule: what a session wrote in the tree decides nothing of what git does for the fingerprint

    Scenario: an attribute file of the tree does not change the bytes that enter the fingerprint
      Given a throwaway repository with one commit
      And the file ".gitattributes" of the repository holds "*.txt ident\n"
      And the file "a.txt" of the repository holds "$Id: a line git would shorten $\n"
      When I take the fingerprint of the repository
      Then the fingerprint tree holds the file "a.txt" with the bytes it has on disk

    Scenario: a repository nested in the tree, not tracked, is refused, and the program its configuration names is not started
      Given a throwaway repository with one commit
      And a repository nested in the repository at "sub" names a witness program as a filter
      When I try to take the fingerprint of it
      Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"
      And the witness program of the nested repository has not run

    Scenario: a repository nested in the tree, recorded by the commit, is refused, and the program its configuration names is not started
      Given a throwaway repository with one commit
      And a repository nested in the repository at "sub" names a witness program as a filter
      And everything in the repository is committed
      When I try to take the fingerprint of it
      Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"
      And the witness program of the nested repository has not run

    Scenario Outline: the fingerprint recognises a gitlink at the <position> record of Git’s byte list
      Given a throwaway repository with one commit
      And the commit of the repository records a gitlink "<name>" with no directory in the tree
      When I try to take the fingerprint of it
      Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"

      # The two regular entries in the fixture are .gitignore and a.txt, in Git order.
      Examples:
        | position | name   |
        | first    | !link  |
        | middle   | 0link  |
        | last     | zlink  |

    Scenario Outline: the path of the first gitlink is read from Git's bytes at the <position> record
      Given a throwaway repository with one commit
      And the commit of the repository records a gitlink "<name>" with no directory in the tree
      Then the first gitlink of its head and of its index is "<name>"

      # The two regular entries in the fixture are .gitignore and a.txt, in Git order.
      Examples:
        | position | name  |
        | first    | !link |
        | middle   | 0link |
        | last     | zlink |

    Scenario: the fingerprint accepts an ordinary filename containing the gitlink mode
      Given a throwaway repository with one commit
      And the file "160000 notes" of the repository holds "ordinary file"
      And everything in the repository is committed
      When I take the fingerprint of the repository
      Then the fingerprint is clean
      And its head and its index hold no gitlink

    Scenario: the fingerprint accepts an empty Git tree
      Given a throwaway repository with an empty root commit
      When I take the fingerprint of the repository
      Then the fingerprint is clean

    Scenario: the same program is started by a git asked for the status of that commit with none of the options of the fingerprint, so that the scenarios above can fail
      Given a throwaway repository with one commit
      And a repository nested in the repository at "sub" names a witness program as a filter
      And everything in the repository is committed
      Then the witness program of the nested repository has not run
      When a git with none of the options of the fingerprint is asked for the status of the repository
      Then the witness program of the nested repository has run

  Scenario: the configuration of the host is not read: a CRLF file is not converted, and a file the host excludes is in the tree
    Given a throwaway repository with one commit
    And the configuration of the host, in the HOME and in the XDG_CONFIG_HOME of the process, converts line endings and excludes "local.txt"
    And the file "crlf.txt" of the repository holds "one\r\ntwo\r\n"
    And the file "local.txt" of the repository holds "local\n"
    When I take the fingerprint of the repository
    Then the fingerprint is not clean
    And the fingerprint tree is the tree that committing everything would give

  Rule: git is started with a closed environment

    Scenario: a GIT_DIR and a GIT_WORK_TREE of the process that name another repository do not move the fingerprint
      Given a throwaway repository with one commit
      And a second throwaway repository with one commit
      And the GIT_DIR and the GIT_WORK_TREE of the process name the second repository
      When I take the fingerprint of the repository
      Then the fingerprint commit is the HEAD of the repository
      And the fingerprint tree is the tree of HEAD
      And the fingerprint is clean

    Scenario: a configuration injected by GIT_CONFIG_COUNT that converts line endings does not change the tree
      Given a throwaway repository with one commit
      And the configuration of the process, by GIT_CONFIG_COUNT, makes core.autocrlf input
      And the file "crlf.txt" of the repository holds "one\r\ntwo\r\n"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

    Scenario: each call receives the names of the list that the process had, and nothing else
      PATH is set by the step of the fake git, which puts itself first on it, and TMPDIR by the step of the temporary directory
      that the fingerprint must leave empty; the names the scenario sets itself are below.

      Given a fake git that records its calls
      And a temporary directory that the fingerprint must leave empty
      And a throwaway directory
      And the process has the variable "HOME" set to "/nowhere/home"
      And the process has the variable "LANG" set to "C"
      And the process has the variable "LC_CTYPE" set to "C"
      And the process has no variable "LC_ALL"
      And the process has the variable "GIT_DIR" set to "/nowhere"
      And the process has the variable "GIT_CONFIG_COUNT" set to "0"
      And the process has the variable "GH_TOKEN" set to "secret"
      When I take the fingerprint of the directory
      Then each call of the fake git received exactly the names of the list that the process had, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due

    Scenario: each call receives the five names of the list when the process has set all five
      Three names are set below. The two others are set by the steps that come first: PATH by the fake git, which puts
      itself first on it, and TMPDIR by the temporary directory that the fingerprint must leave empty.

      Given a fake git that records its calls
      And a temporary directory that the fingerprint must leave empty
      And a throwaway directory
      And the process has the variable "LANG" set to "C"
      And the process has the variable "LC_ALL" set to "C"
      And the process has the variable "LC_CTYPE" set to "C"
      When I take the fingerprint of the directory
      Then each call of the fake git received exactly the five names of the list, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due

  Scenario: a nested linked worktree is refused by its marker even when its gitdir is unavailable
    Given a throwaway repository with one commit
    And a second throwaway repository with one commit
    And a linked worktree from the second repository is nested at "linked"
    When I try to take the fingerprint of it
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"
    Given the file "linked/.git" of the repository holds "gitdir: /missing-gitdir\\n"
    When I try to take the fingerprint of it
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"

  Scenario: a tracked ignore rule prunes a directory before the nested-marker walk enters it
    Given a throwaway repository with one commit
    And the file ".gitignore" of the repository holds "ignored/\n"
    And everything in the repository is committed
    And the file "ignored/.git" of the repository holds "gitdir: /missing-gitdir\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean

  Scenario: an ignore rule the tree added to a tracked ignore file does not hide a nested repository
    A session can rewrite a tracked ignore file: its rules are trusted only with the bytes it was committed with.

    Given a throwaway repository with one commit
    And the file ".gitignore" of the repository holds "*.log\nsub/\n"
    And the file "sub/.git" of the repository holds "gitdir: /missing-gitdir\n"
    When I try to take the fingerprint of it
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre, sous un dossier qu'écarte un fichier d'exclusion suivi qui n'est plus celui enregistré : ses règles ne sont pas appliquées"

  Rule: a tracked ignore file that is no longer the recorded one prunes nothing, and the refusal says so

    A session can add a rule to a tracked ignore file to hide a repository, so the rules of a changed file are not
    applied, whatever was changed in it. A directory the repository ignored and that holds a repository (another
    worktree, a dependency) is then found: the fingerprint refuses the tree, and its message names the cause, so that
    the operator restores or commits the file instead of looking for a nested repository.

    Background:
      Given a throwaway repository with one commit
      And the file ".gitignore" of the repository holds "ignored/\n"
      And everything in the repository is committed
      And the file "ignored/.git" of the repository holds "gitdir: /missing-gitdir\n"

    Scenario: a line added to the ignore file, its recorded rule untouched, has the ignored directory searched
      Given the file ".gitignore" of the repository holds "ignored/\n*.tmp\n"
      When I try to take the fingerprint of it
      Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre, sous un dossier qu'écarte un fichier d'exclusion suivi qui n'est plus celui enregistré : ses règles ne sont pas appliquées"
      And the guard of the checkout names the marker "ignored/" under the changed ignore file ".gitignore"

    Scenario: the ignore file given back its recorded bytes prunes the directory again
      Given the file ".gitignore" of the repository holds "ignored/\n*.tmp\n"
      And the file ".gitignore" of the repository holds "ignored/\n"
      When I take the fingerprint of the repository
      Then the fingerprint is clean
      And the guard of the checkout names no marker of its head

    Scenario: the changed ignore file committed prunes the directory again
      Given the file ".gitignore" of the repository holds "ignored/\n*.tmp\n"
      And everything in the repository is committed
      When I take the fingerprint of the repository
      Then the fingerprint is clean

    Scenario: a marker that no ignore file ignores keeps the plain refusal, beside a changed ignore file
      Given the file ".gitignore" of the repository holds "ignored/\n*.tmp\n"
      And the file "zzz/.git" of the repository holds "gitdir: /missing-gitdir\n"
      When I try to take the fingerprint of it
      Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"
      And the guard of the checkout names the marker "zzz/" of its head

    Scenario: a marker deeper under the directory a changed ignore file ignored is reported with that file
      Given the file ".gitignore" of the repository holds "ignored/\n*.tmp\n"
      And the file "ignored/.git" of the repository is removed
      And the file "ignored/deep/er/.git" of the repository holds "gitdir: /missing-gitdir\n"
      Then the guard of the checkout names the marker "ignored/deep/er/" under the changed ignore file ".gitignore"

    Scenario: the guard asked whether the checkout is clean says it is not
      Given the file ".gitignore" of the repository holds "ignored/\n*.tmp\n"
      Then the guard of the checkout finds it not clean

  Scenario: a committed rule that ignores a directory holding a tracked file does not hide a marker in it
    Git walks a directory that holds a tracked path whatever ignores it: so does the walk for nested markers.

    Given a throwaway repository with one commit
    And the file ".gitignore" of the repository holds "lib/\n"
    And the file "lib/kept.txt" of the repository is committed whatever ignores it
    And the file "lib/.git" of the repository holds "gitdir: /missing-gitdir\n"
    When I try to take the fingerprint of it
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"

  Scenario: a committed rule that ignores everything but a directory does not hide a nested repository in it
    Given a throwaway repository with one commit
    And the file ".gitignore" of the repository holds "*\n!sub/\n"
    And everything in the repository is committed
    And the file "sub/.git" of the repository holds "gitdir: /missing-gitdir\n"
    When I try to take the fingerprint of it
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"

  Rule: the guard of the checkout compares its bytes with the commit, and refuses what it cannot read

    The delivery asks it whether its checkout is clean, and the fingerprint, the gate and the delivery ask it for the
    first nested marker, before any git call would walk the tree (packages/sandbox/src/git-worktree.ts).

    Scenario: the fingerprint and the native guard preserve the bytes of tracked ignore paths
      One directory has the literal U+FFFD name. Its sibling has the single byte FF on Linux and an ordinary
      name on macOS. Each committed ignore file excludes its own cache with an ordinary marker.

      Given a throwaway repository with one commit
      And the fingerprint repository commits the two distinct pathname ignore files
      When I take the fingerprint of the repository
      Then the fingerprint is clean
      And the guard of the checkout finds it clean

    Scenario: a directory in place of a tracked ignore file refuses both inspections
      Given a throwaway repository with one commit
      And the file ".gitignore" of the repository is removed
      And the file ".gitignore/note" of the repository holds "ordinary file"
      Then the guard of the checkout refuses to say whether it is clean with "GATE_CHECKOUT_UNREADABLE"
      And the guard refuses the recorded markers of its head with "GATE_CHECKOUT_UNREADABLE"

    Scenario: a committed directory named .gitignore can hold ordinary tracked files
      Given a throwaway repository with one commit
      And the file ".gitignore" of the repository is removed
      And the file ".gitignore/note" of the repository holds "ordinary file"
      And everything in the repository is committed
      Then the guard of the checkout finds it clean
      And the guard of the checkout names no marker of its head
      And the guard of the checkout names no marker of its index

    Scenario: the bytes of a recorded symlink are its target name, whatever later replaces it
      Given a throwaway repository with one commit
      And the file ".gitignore" of the repository is removed
      And the ignore file of the repository is a symbolic link to "a.txt"
      And everything in the repository is committed
      Then the guard of the checkout finds it clean
      When the file ".gitignore" of the repository is removed
      And the file ".gitignore" of the repository holds "a.txt"
      Then the guard classifies the ignore file as "changed" from both the head and the index
      And the guard of the checkout finds it not clean
      When the file ".gitignore" of the repository is removed
      And the file ".gitignore/note" of the repository holds "ordinary file"
      Then the guard of the checkout names no marker of its head
      And the guard of the checkout names no marker of its index

    Scenario: the guard compares the last byte of a large ordinary ignore file
      Given a throwaway repository with one commit
      And the ignore file of the repository ends with the comment "a" after one MiB of comments
      And everything in the repository is committed
      Then the guard classifies the ignore file as "trusted" from both the head and the index
      And the guard of the checkout finds it clean
      When the ignore file of the repository ends with the comment "b" after one MiB of comments
      Then the guard of the checkout finds it not clean

    Scenario: a checkout that holds the bytes of its commit is clean
      Given a throwaway repository with one commit
      Then the guard of the checkout finds it clean

    Scenario Outline: a checkout that differs from its commit is not clean: <change>
      Given a throwaway repository with one commit
      And the file "<file>" of the repository holds "<text>"
      Then the guard of the checkout finds it not clean

      Examples:
        | change            | file     | text                      |
        | a tracked file    | a.txt    | changed\n                 |
        | an untracked file | b.txt    | new\n                     |
        | a nested marker   | sub/.git | gitdir: /missing-gitdir\n |

    Scenario: a replace object of the head commit does not make the guard compare the checkout with another tree
      Given a throwaway repository with one commit
      And the repository replaces its head commit by a commit of another tree
      Then the guard of the checkout finds it clean

    Scenario: the same replace object makes a git with none of the options of the guard read another tree, so that the scenario above can fail
      Given a throwaway repository with one commit
      And the repository replaces its head commit by a commit of another tree
      Then a git with none of the options of the guard lists no file in the head of the repository

    Scenario: a file monitor the configuration of the repository names is not started by the guard
      Given a throwaway repository with one commit
      And the configuration of the repository names a witness program as its file monitor
      Then the guard of the checkout finds it clean
      And the witness program of the configuration of the repository has not run

    Scenario: the same file monitor is started by a git with none of the options of the guard, so that the scenario above can fail
      Given a throwaway repository with one commit
      And the configuration of the repository names a witness program as its file monitor
      When a git with none of the options of the guard lists the untracked files of the repository
      Then the witness program of the configuration of the repository has run

    Scenario Outline: the guard refuses <place> with its fixed message, whether asked for the cleanliness or the markers
      Given <place>
      Then the guard of the checkout refuses to say whether it is clean with "GATE_CHECKOUT_UNREADABLE"
      And the guard of the checkout refuses to name its markers with "GATE_CHECKOUT_UNREADABLE"

      Examples:
        | place                                         |
        | a directory that does not exist               |
        | a throwaway repository with a directory it cannot list |

    Scenario: the guard says a directory that is not a repository is not a checkout, and walks it for markers
      Given a directory that is not a repository
      Then the guard of the checkout refuses to say whether it is clean with "GATE_CHECKOUT_UNREADABLE"
      And the guard of the checkout names no marker
