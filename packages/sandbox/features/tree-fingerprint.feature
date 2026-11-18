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
    Given a fake git that records its calls
    And the fake git never answers the call "<call>"
    And a temporary directory that the fingerprint must leave empty
    And a throwaway directory
    When I try to take the fingerprint of the directory with a bound of 300 milliseconds
    Then the fingerprint throws "l'empreinte de l'arbre a échoué : git <call>"
    And the temporary directory is empty

    Examples:
      | call           |
      | rev-parse HEAD |
      | read-tree HEAD |
      | add -A         |
      | write-tree     |

  Scenario: the five git calls are argv with the options that switch off the monitor, the hooks and the host's exclusion file, and the temporary index
    Given a fake git that records its calls
    And a temporary directory that the fingerprint must leave empty
    And a throwaway directory
    When I take the fingerprint of the directory
    Then the fake git was called, in this order, with:
      | -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.excludesFile=/dev/null rev-parse HEAD        | no index  |
      | -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.excludesFile=/dev/null read-tree HEAD        | the index |
      | -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.excludesFile=/dev/null add -A                | the index |
      | -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.excludesFile=/dev/null write-tree            | the index |
      | -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.excludesFile=/dev/null rev-parse HEAD^{tree} | no index  |
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
      | add -A              | the exit code 3 and a marker                                          |
      | write-tree          | the exit code 3 and a marker                                          |
      | rev-parse HEAD^{tree} | the exit code 3 and a marker                                        |
      | rev-parse HEAD      | the text "MARKER" and the exit code 0                                 |
      | write-tree          | the text "MARKER" and the exit code 0                                 |
      | rev-parse HEAD^{tree} | the text "MARKER" and the exit code 0                               |
      | rev-parse HEAD      | the text "ccccccccccccccccccccccccccccccccccccccc" and the exit code 0 |
      | rev-parse HEAD      | the text "ccccccccccccccccccccccccccccccccccccccccc" and the exit code 0 |
      | rev-parse HEAD      | the text "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" and the exit code 0 |

  Scenario: the exclusion file of the host is not read: a file it names is in the tree
    Given a throwaway repository with one commit
    And the exclusion file of the host names "local.txt"
    And the file "local.txt" of the repository holds "local\n"
    When I take the fingerprint of the repository
    Then the fingerprint is not clean
    And the fingerprint tree is the tree that committing everything would give
