Feature: the repository of a pass, one contract for its two adapters
  The port PassRepository (packages/sandbox/src/pass-commit.ts) is what the host asks of the repository of a worktree
  to commit a pass: the branch HEAD names and its commit, the paths a tree changes from a commit, a commit written under
  the fixed identity of the host, a branch advanced by compare and swap, the index of the worktree settled on the
  new commit, the rule files ignoring untracked paths, and whether a commit holds a path. Each scenario runs on the
  in-memory adapter and on the git adapter, over a throwaway repository whose snapshot is the fingerprint of its tree
  (`fingerprintTree`).

  Scenario Outline: the head names the branch and its commit (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    Then the head of the pass repository is the branch "step/demo" at the first commit
    And the first commit has no parent and the message "first\n"

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a detached head names no branch (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the head of the pass repository is detached
    Then the head of the pass repository names no branch, at the first commit

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: the paths a tree changes from a commit are each path modified, removed or added, once (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the file "a.txt" of the pass repository holds "changed\n"
    And the file "b.txt" of the pass repository is removed
    And the file "c/d.txt" of the pass repository holds "new\n"
    And the file "a0.txt" of the pass repository holds "new\n"
    When I take the snapshot of the pass repository
    Then the snapshot of the pass repository is not clean
    And the paths changed from the first commit to the snapshot are "a.txt a0.txt b.txt c/d.txt", in the order of their bytes

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a file removed and written back with its bytes gives the tree of the commit again (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the file "a.txt" of the pass repository is removed
    And the file "a.txt" of the pass repository holds "first\n"
    When I take the snapshot of the pass repository
    Then the snapshot of the pass repository is clean
    And the paths changed from the first commit to the snapshot are ""

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: an unchanged tree changes no path from its commit (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    When I take the snapshot of the pass repository
    Then the snapshot of the pass repository is clean
    And the paths changed from the first commit to the snapshot are ""

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a commit written, its branch advanced and the index settled make it the clean head (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the file "a.txt" of the pass repository holds "changed\n"
    When I take the snapshot of the pass repository
    And I write the commit of the snapshot on the first commit with the subject "Record the pass p1 of the loop", the body "record.json sha256 00" and the date 1700000000
    And I advance the branch "step/demo" from the first commit to the written commit
    And I settle the index of the pass repository on the written commit
    Then the branch was advanced
    And the head of the pass repository is the branch "step/demo" at the written commit
    And the written commit has the first commit for its only parent and the tree of the snapshot
    And the written commit has the message "Record the pass p1 of the loop\n\nrecord.json sha256 00\n" and the date 1700000000
    And the index of the pass repository is the tree of the written commit
    When I take the snapshot of the pass repository
    Then the snapshot of the pass repository is clean
    And the paths changed from the written commit to the snapshot are ""

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a branch that is not at the expected commit is not advanced, and is left where it is (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the file "a.txt" of the pass repository holds "changed\n"
    When I take the snapshot of the pass repository
    And I write the commit of the snapshot on the first commit with the subject "Record the pass p1 of the loop", the body "record.json sha256 00" and the date 1700000000
    And I advance the branch "step/demo" from the written commit to the written commit
    Then the branch was not advanced
    And the head of the pass repository is the branch "step/demo" at the first commit

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a branch that does not exist is not advanced (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the file "a.txt" of the pass repository holds "changed\n"
    When I take the snapshot of the pass repository
    And I write the commit of the snapshot on the first commit with the subject "Record the pass p1 of the loop", the body "record.json sha256 00" and the date 1700000000
    And I advance the branch "step/other" from the first commit to the written commit
    Then the branch was not advanced
    And the head of the pass repository is the branch "step/demo" at the first commit

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a commit holds its tracked files and none of the untracked, absent or outside paths (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the file "untracked.txt" of the pass repository holds "new\n"
    Then the first commit of the pass repository holds "a.txt"
    And the first commit of the pass repository does not hold "untracked.txt"
    And the first commit of the pass repository does not hold "missing.txt"
    And the first commit of the pass repository does not hold ""
    And the first commit of the pass repository does not hold "/outside/exclude"
    And the first commit of the pass repository does not hold "../outside"

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: without an ignored untracked file, no rule file is reported (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    Then the files ignoring untracked paths in the pass repository are ""

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: a rule file ignoring untracked paths is reported once (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the rule file ".gitignore" of the pass repository ignores "a.log" with "*.log"
    And the rule file ".gitignore" of the pass repository ignores "b.log" with "*.log"
    Then the files ignoring untracked paths in the pass repository are ".gitignore"

    Examples:
      | adapter   |
      | in memory |
      | git       |

  Scenario Outline: info/exclude ignoring an untracked path is reported and not held by the first commit (<adapter>)
    Given a pass repository "<adapter>" on the branch "step/demo" whose first commit holds "a.txt" and "b.txt"
    And the rule file ".git/info/exclude" of the pass repository ignores "left.tmp" with "left.tmp"
    Then the files ignoring untracked paths in the pass repository are ".git/info/exclude"
    And the first commit of the pass repository does not hold ".git/info/exclude"

    Examples:
      | adapter   |
      | in memory |
      | git       |
