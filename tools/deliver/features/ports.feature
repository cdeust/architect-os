Feature: The ports of the delivery command (each contract, one row per adapter)
  Commits and runs are described by the scenario; their hashes and ids are the adapter's. The row of each real adapter comes with the step that builds it.

  Rule: Repository

    Scenario Outline: the head is a full hash, and the tree is clean until a file changes
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      Then the delivery repository head is 40 lower-case hexadecimal characters
      And the delivery repository is clean
      When a file of the delivery worktree changes
      Then the delivery repository is not clean

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a tree holds no nested repository until one is left in it, tracked or not
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      Then the delivery repository holds no nested repository
      When a repository is left nested in the delivery worktree
      Then the delivery repository holds a nested repository

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a branch the remote does not have, and a branch it has
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote holds the branch "main" at the commit "c1"
      When the delivery repository fetches
      Then the delivery remote head of "other" is undefined
      And the delivery remote head of "main" is the commit "c1"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a push to a branch whose remote hash is an ancestor
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1"
      And the delivery remote holds the branch "main" at the commit "c1"
      When I push the commit "c2" to the delivery branch "main"
      And the delivery repository fetches
      Then the delivery push answered "pushed"
      And the delivery remote head of "main" is the commit "c2"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a push to a branch the remote does not have
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      When I push the commit "c1" to the delivery branch "fresh"
      And the delivery repository fetches
      Then the delivery push answered "pushed"
      And the delivery remote head of "fresh" is the commit "c1"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a push of a commit that does not descend from the remote hash is refused and changes nothing
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2"
      And the delivery remote holds the branch "main" at the commit "c1"
      When I push the commit "c2" to the delivery branch "main"
      And the delivery repository fetches
      Then the delivery push answered "refused"
      And the delivery remote head of "main" is the commit "c1"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a commit is its own ancestor, a parent is an ancestor of its child, not the other way
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1"
      And the delivery repository holds the commit "c3"
      Then the delivery commit "c1" is an ancestor of "c1"
      And the delivery commit "c1" is an ancestor of "c2"
      And the delivery commit "c2" is not an ancestor of "c1"
      And the delivery commit "c3" is not an ancestor of "c2"
      And the delivery commit "c1" is not an ancestor of "c3"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: the lines removed from a file between two commits
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1"
      And the delivery repository holds the commit "c3" after "c2" that removed 1 lines from "a.md"
      And the delivery repository holds the commit "c4" after "c3" that removed 2 lines from "a.md"
      And the delivery repository holds the commit "c5" after "c4" that removed 4 lines from "b.md"
      Then the delivery repository counts 0 deleted lines in "a.md" from "c1" to "c2"
      And the delivery repository counts 1 deleted lines in "a.md" from "c2" to "c3"
      And the delivery repository counts 2 deleted lines in "a.md" from "c3" to "c4"
      And the delivery repository counts 3 deleted lines in "a.md" from "c2" to "c4"
      And the delivery repository counts 3 deleted lines in "a.md" from "c2" to "c5"
      And the delivery repository counts 4 deleted lines in "b.md" from "c2" to "c5"
      And the delivery repository counts 0 deleted lines in "a.md" from "c4" to "c4"
      And the delivery repository counts 0 deleted lines in "b.md" from "c1" to "c3"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a remote branch deleted is absent after a fetch
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote holds the branch "trial" at the commit "c1"
      When I delete the delivery remote branch "trial"
      And the delivery repository fetches
      Then the delivery remote head of "trial" is undefined

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario: a push of a commit that diverges from the remote branch is refused, and the remote itself keeps its hash
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c0"
      And the delivery repository holds the commit "c1" after "c0"
      And the delivery repository holds the commit "c2" after "c0"
      And the delivery remote holds the branch "main" at the commit "c1"
      When I push the commit "c2" to the delivery branch "main"
      Then the delivery push answered "refused"
      And the remote repository holds the branch "main" at the commit "c1"

    Scenario: a push that git fails for another reason than a refusal is refused
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote cannot be reached
      When I push the commit "c1" to the delivery branch "main"
      Then the delivery push answered "refused"

    Scenario: a branch deleted by another clone is still known until the fetch prunes it
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote holds the branch "trial" at the commit "c1"
      When another clone deletes the delivery remote branch "trial"
      Then the delivery remote head of "trial" is the commit "c1"
      When the delivery repository fetches
      Then the delivery remote head of "trial" is undefined

    Scenario: an untracked file makes the tree not clean
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      Then the delivery repository is clean
      When an untracked file is added to the delivery worktree
      Then the delivery repository is not clean

    Scenario: the lines removed from a path with a space
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" with the file "docs/my notes.md" of 5 lines
      And the delivery repository holds the commit "c3" after "c2" with the file "docs/my notes.md" of 2 lines
      Then the delivery repository counts 0 deleted lines in "docs/my notes.md" from "c1" to "c2"
      And the delivery repository counts 3 deleted lines in "docs/my notes.md" from "c2" to "c3"

    Scenario: a binary file that changed counts one line
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" with the binary file "img.bin"
      And the delivery repository holds the commit "c3" after "c2" with the binary file "img.bin"
      Then the delivery repository counts 1 deleted lines in "img.bin" from "c2" to "c3"

    Scenario: a remote that cannot be reached makes a delete and a fetch throw, with the exit code of git
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote cannot be reached
      Then deleting the delivery remote branch "trial" throws "git push exited with code 128"
      And calling "fetch" on the delivery repository throws "git fetch exited with code 128"

    Scenario Outline: git fails in a way the port does not name, in a directory that is not a repository: a fixed message with the exit code
      Given a delivery repository over a directory that is not a repository
      Then calling "<method>" on the delivery repository throws "<message>"

      Examples:
        | method             | message                          |
        | isClean            | GATE_CHECKOUT_UNREADABLE  |
        | head               | git rev-parse exited with code 128 |
        | fetch              | git fetch exited with code 128   |
        | remoteHead         | git rev-parse exited with code 128 |
        | isAncestor         | git merge-base exited with code 128 |
        | deletedLines       | git diff exited with code 129    |
        | deleteRemoteBranch | git push exited with code 128    |

    Scenario Outline: each method is one fixed git command, started with no file monitor, no hook and the terminal prompt switched off
      Given a delivery repository over a git that records what it is asked
      When I call "<method>" on the delivery repository
      Then git was asked "<argv>"
      And git saw the terminal prompt variable "0"

      Examples:
        | method             | argv                                                           |
        | head               | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null rev-parse --verify HEAD^{commit} |
        | fetch              | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null fetch --quiet --prune --recurse-submodules=no origin |
        | remoteHead         | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null rev-parse --verify --quiet refs/remotes/origin/main^{commit} |
        | isAncestor         | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null merge-base --is-ancestor aaa bbb |
        | deletedLines       | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null diff --numstat --ignore-submodules=all aaa bbb -- docs/a.md |
        | push               | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null push --quiet --recurse-submodules=no origin aaa:refs/heads/main |
        | deleteRemoteBranch | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null push --quiet --recurse-submodules=no origin :refs/heads/main |

    Scenario: a git executable that does not exist throws a fixed message
      Given a delivery repository over the git executable "/nonexistent/git"
      Then calling "head" on the delivery repository throws "git could not be run to its end"

    Scenario: delivery refuses the raw bytes of an untouched converted checkout
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      And the delivery checkout was converted by Git and has been left untouched
      Then the delivery repository is not clean

    Scenario: delivery refuses a linked worktree by its marker without requiring its gitdir
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      And a linked worktree with an external gitdir is inside the delivery repository
      Then the delivery repository holds a nested repository
      Given the nested delivery marker points to a missing gitdir
      Then the delivery repository holds a nested repository

    Scenario Outline: a tree whose only nested marker lies in a directory that a changed tracked ignore file ignores is left to the question of cleanliness
      The port says it (src/domain/ports.ts, `holdsNestedRepository`): what the operator has to repair is the changed
      file, so the tree is not clean, and it holds no nested repository for this method.

      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      When a tracked ignore file of the delivery worktree changes over an ignored directory that holds a repository
      Then the delivery repository holds no nested repository
      And the delivery repository is not clean

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario: delivery preflight and native cleanliness agree for distinct pathname bytes
      The repository contains a literal U+FFFD directory and, on Linux, a sibling whose name is the byte FF.

      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      And the delivery repository commits the two distinct pathname ignore files
      Then the delivery repository holds no nested repository
      And the delivery repository is clean

    Scenario: a repository in a directory that the recorded ignore file ignores is not looked for, and one found only because that file changed makes the tree not clean
      A tracked ignore file that is no longer the recorded one prunes nothing (a session can add a rule to it to hide a
      repository). The marker then found is not reported as a nested repository: the tree is refused as not clean, which
      is what the operator has to repair, and the guard that says so refuses the marker as well.

      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      And the delivery repository commits an ignore file that ignores "deps/", where a repository is then left
      Then the delivery repository holds no nested repository
      And the delivery repository is clean
      When a line is added to the ignore file of the delivery repository
      Then the delivery repository holds no nested repository
      And the delivery repository is not clean
      When the ignore file of the delivery repository is given back its recorded bytes
      And a marker that no ignore file ignores is left in the delivery worktree
      Then the delivery repository holds a nested repository

    Scenario Outline: delivery recognises a gitlink in the <position> record of the <place>
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      And a gitlink "<name>" is recorded only in the <place> of the delivery repository
      Then the delivery repository holds a nested repository

      # The regular entries in c1 are a.md, b.md and c1.txt, in Git order.
      Examples:
        | place | position | name  |
        | index | first    | 0link |
        | index | middle   | alink |
        | index | last     | zlink |
        | head  | first    | 0link |
        | head  | middle   | alink |
        | head  | last     | zlink |

    Scenario: delivery accepts an ordinary filename containing the gitlink mode
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" with the binary file "160000 notes"
      And the delivery repository is at the commit "c2"
      Then the delivery repository holds no nested repository

    Scenario: delivery accepts an empty Git index and tree
      Given a delivery repository of the git adapter
      And the delivery repository holds an empty root commit
      Then the delivery repository holds no nested repository

  Rule: what the repository replaces and what the machine adds are not what the delivery counts

    Background:
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"

    Scenario: a replace object of the blob of a file does not hide its deleted lines
      Given the delivery repository holds the commit "c2" after "c1" that removed 2 lines from "a.md"
      And the delivery repository replaces the blob of "a.md" at "c1" by its blob at "c2"
      Then the delivery repository counts 2 deleted lines in "a.md" from "c1" to "c2"

    Scenario: an attributes file of the machine that marks a file binary does not change the count of its deleted lines
      Given the delivery repository holds the commit "c2" after "c1" that removed 2 lines from "a.md"
      And the git configuration of the host marks "*.md" as binary
      Then the delivery repository counts 2 deleted lines in "a.md" from "c1" to "c2"

  Rule: git enters no repository nested in the tree, whatever the tree says of it

    The nested repository of the fixture names a witness program as a filter of one of its files and as the program of
    its fetches; the `.gitmodules` of the tree asks git to look into it whatever the configuration says
    (`ignore = none`) and to fetch inside it (`fetchRecurseSubmodules = true`).

    Background:
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote holds the branch "main" at the commit "c1"
      And the delivery repository is at the commit "c1"
      And a repository is left nested in the delivery worktree
      And everything in the delivery worktree is committed

    Scenario: a nested repository that the head records is found, and its program does not run
      Then the delivery repository holds a nested repository
      And the witness program of the nested delivery repository has not run

    Scenario Outline: the method <method> does not start the program of the nested repository
      When I call "<method>" on the delivery repository
      Then the witness program of the nested delivery repository has not run

      Examples:
        | method                |
        | holdsNestedRepository |
        | isClean               |
        | fetch                 |
        | head                  |

    Scenario Outline: the same program is started by a git asked for the <command> without the options of the delivery, so that the scenarios above can fail
      Then the witness program of the nested delivery repository has not run
      When the fixture git, without the options of the delivery, is asked for the <command> of the delivery worktree
      Then the witness program of the nested delivery repository has run

      Examples:
        | command |
        | status  |
        | fetch   |

  Rule: Forge

    Scenario Outline: a hash no run exists for
      Given a delivery forge of the <adapter> adapter
      Then the delivery forge has no run of the commit "0000000000000000000000000000000000000001"

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: a run is given back with its jobs
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000002" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000002" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: a rerun is recorded, and the run is then not completed, without jobs
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000003" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000003" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      When I ask the delivery forge to rerun the failed jobs of the run 9
      Then the delivery forge recorded the rerun of the run 9
      And the delivery forge run of the commit "0000000000000000000000000000000000000003" is not completed and has no jobs

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: a rerun changes the run it names and no other
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000011" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      And the delivery forge holds for the commit "0000000000000000000000000000000000000012" the run 10, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false}]'
      Then the delivery forge has no run of the commit "0000000000000000000000000000000000000013"
      And the delivery forge gives for the commit "0000000000000000000000000000000000000011" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      And the delivery forge gives for the commit "0000000000000000000000000000000000000012" the run 10, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false}]'
      When I ask the delivery forge to rerun the failed jobs of the run 9
      Then the delivery forge run of the commit "0000000000000000000000000000000000000011" is not completed and has no jobs
      And the delivery forge gives for the commit "0000000000000000000000000000000000000012" the run 10, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false}]'

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: a rerun of a run the forge does not have changes nothing
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000014" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000014" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      When I ask the delivery forge to rerun the failed jobs of the run 77
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000014" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: a rule suite of a push nobody made, and of one evaluated
      Given a delivery forge of the <adapter> adapter
      And the delivery forge evaluated the push of the commit "0000000000000000000000000000000000000004" to the branch "main" as "<suite>"
      Then the delivery forge rule suite of the branch "main" and the commit "0000000000000000000000000000000000000004" is "<suite>"
      And the delivery forge rule suite of the branch "other" and the commit "0000000000000000000000000000000000000004" is nothing
      And the delivery forge rule suite of the branch "main" and the commit "0000000000000000000000000000000000000005" is nothing

      Examples:
        | adapter   | suite  |
        | in-memory | pass   |
        | gh        | pass   |
        | in-memory | fail   |
        | gh        | fail   |
        | in-memory | bypass |
        | gh        | bypass |

    Scenario: the gh adapter asks the exact arguments of each call
      Given a delivery forge of the gh adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[]'
      And the delivery forge evaluated the push of the commit "0000000000000000000000000000000000000021" to the branch "feat/gate-1a" as "pass"
      When I ask the gh forge for the run
      And I ask the gh forge to rerun the run 7
      And I ask the gh forge for the rule suite of "feat/gate-1a"
      Then the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api repos/cdeust/architect-os/actions/runs/7/jobs?per_page=100
        api --method POST repos/cdeust/architect-os/actions/runs/7/rerun-failed-jobs
        api repos/cdeust/architect-os/rulesets/rule-suites?ref=refs%2Fheads%2Ffeat%2Fgate-1a&per_page=100
        """

    Scenario: two runs of the workflow for the commit: the one of the smaller id, whatever the order
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":8,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed"},{"id":3,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"in_progress"}]}'
      And the gh forge answers the jobs of "3" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 3, completed "no", with the jobs '[]'

    Scenario: a run of another workflow and a run of another commit are not the run of the commit
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":1,"name":"other","head_sha":"0000000000000000000000000000000000000021","status":"completed"},{"id":2,"name":"gate","head_sha":"0000000000000000000000000000000000000022","status":"completed"},{"id":5,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed"}]}'
      And the gh forge answers the jobs of "5" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 5, completed "yes", with the jobs '[]'

    Scenario: runs of another workflow and of another commit only: no run
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":1,"name":"other","head_sha":"0000000000000000000000000000000000000021","status":"completed"},{"id":2,"name":"gate","head_sha":"0000000000000000000000000000000000000022","status":"completed"}]}'
      Then the delivery forge has no run of the commit "0000000000000000000000000000000000000021"

    Scenario Outline: a job has a runner when its runner name is a string that is not empty
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"gate-linux","conclusion":"success","runner_name":<runner>,"steps":[]}]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":<had>,"failedStep":false}]'

      Examples:
        | runner     | had   |
        | null       | false |
        | ""         | false |
        | "runner-1" | true  |

    Scenario Outline: a named executed step proves runner assignment when the runner name is absent
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"gate-linux","conclusion":"cancelled","runner_name":null,"steps":<steps>}]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"cancelled","hadRunner":<runner>,"failedStep":false}]'

      Examples:
        | steps                                    | runner |
        | [{"name":"Build","conclusion":"success"}] | true   |
        | [{"name":"Build","conclusion":null}]      | false  |
        | [{"name":"Build","conclusion":"skipped"}] | false  |
        | [{"conclusion":"success"}]                | false  |
        | [{"name":"","conclusion":"success"}]      | false  |

    Scenario Outline: a job without steps has no failed step
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"gate-linux","conclusion":"success","runner_name":<runner>}]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":<observed>,"failedStep":false}]'

      Examples:
        | runner | observed |
        | "r"    | true     |
        | null   | false    |

    Scenario Outline: a step that failed is a failed step, one that did not is not
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"gate-linux","conclusion":"failure","runner_name":"r","steps":[{"conclusion":"success"},{"conclusion":<step>}]}]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"failure","hadRunner":true,"failedStep":<failed>}]'

      Examples:
        | step      | failed |
        | "failure" | true   |
        | "skipped" | false  |
        | null      | false  |

    Scenario Outline: a conclusion is one of the four, null, or other
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"gate-linux","conclusion":<conclusion>,"runner_name":"r","steps":[]}]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":<expected>,"hadRunner":true,"failedStep":false}]'

      Examples:
        | conclusion  | expected    |
        | "success"   | "success"   |
        | "failure"   | "failure"   |
        | "cancelled" | "cancelled" |
        | "skipped"   | "skipped"   |
        | null        | null        |
        | "timed_out" | "other"     |

    Scenario: a run that is not completed is not completed, whatever its status says
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":4,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"queued"}]}'
      And the gh forge answers the jobs of "4" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 4, completed "no", with the jobs '[]'

    Scenario: the first evaluation of the commit counts, and an evaluation of another commit does not
      Given a delivery forge of the gh adapter
      And the gh forge answers the suites of "main" with '[{"after_sha":"0000000000000000000000000000000000000022","result":"fail"},{"after_sha":"0000000000000000000000000000000000000021","result":"pass"},{"after_sha":"0000000000000000000000000000000000000021","result":"fail"}]'
      Then the delivery forge rule suite of the branch "main" and the commit "0000000000000000000000000000000000000021" is "pass"

    Scenario: an evaluation that is not finished is nothing
      Given a delivery forge of the gh adapter
      And the gh forge answers the suites of "main" with '[{"after_sha":"0000000000000000000000000000000000000021","result":"queued"}]'
      Then the delivery forge rule suite of the branch "main" and the commit "0000000000000000000000000000000000000021" is nothing

    Scenario Outline: a program that exits non-zero: the fixed message with the exit code, and nothing it printed
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the <kind> of "<subject>" with the exit code 3 and the output "MARKER-9c2e"
      When I ask the gh forge <call>
      Then the gh forge failed with "the forge did not answer: <label> (exit code 3)"
      And the message of the gh forge failure holds nothing of "MARKER-9c2e"

      Examples:
        | kind  | subject | call                          | label       |
        | runs  | 0000000000000000000000000000000000000021  | for the run                   | runs        |
        | jobs  | 7       | for the run                   | jobs        |
        | rerun | 7       | to rerun the run 7            | rerun       |
        | suites | main   | for the rule suite of "main"  | rule suites |

    Scenario Outline: a program that prints what is not JSON: the fixed message, and nothing it printed
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the <kind> of "<subject>" with "MARKER-9c2e"
      When I ask the gh forge <call>
      Then the gh forge failed with "the forge did not answer: <label>"
      And the message of the gh forge failure holds nothing of "MARKER-9c2e"

      Examples:
        | kind   | subject | call                 | label       |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        |
        | jobs   | 7       | for the run          | jobs        |
        | suites | main    | for the rule suite of "main" | rule suites |

    Scenario Outline: a program that prints JSON the schema refuses: the fixed message, and nothing it printed
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the <kind> of "<subject>" with '<output>'
      When I ask the gh forge <call>
      Then the gh forge failed with "the forge did not answer: <label>"
      And the message of the gh forge failure holds nothing of "MARKER-9c2e"

      Examples:
        | kind   | subject | call                 | label       | output                                                                                       |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        | {"marker":"MARKER-9c2e"}                                                                     |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        | {"workflow_runs":[{"id":0,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"MARKER-9c2e"}]}        |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        | {"workflow_runs":[{"id":1.5,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"MARKER-9c2e"}]}      |
        | jobs   | 7       | for the run          | jobs        | {"marker":"MARKER-9c2e"}                                                                     |
        | suites | main    | for the rule suite of "main" | rule suites | {"marker":"MARKER-9c2e"}                                                                     |

    Scenario: a program that cannot be started
      Given a delivery forge over the program "/nonexistent/gh"
      When I ask the gh forge for the run
      Then the gh forge failed with "the forge did not answer: runs"

    Scenario Outline: an identifier that is not a positive integer never reaches the client
      Given a delivery forge of the gh adapter
      When I ask the gh forge to rerun the run <id>
      Then the gh forge failed with "the forge did not answer: rerun"
      And the gh client was asked nothing

      Examples:
        | id  |
        | 0   |
        | -4  |
        | 1.5 |

    Scenario: the output of a rerun is not read
      Given a delivery forge of the gh adapter
      And the gh forge answers the rerun of "7" with "not JSON"
      When I ask the gh forge to rerun the run 7
      Then the gh client was asked:
        """
        api --method POST repos/cdeust/architect-os/actions/runs/7/rerun-failed-jobs
        """

    Scenario: delivery takes its attempt number from the selected run when the listing omits it
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the run of "7" with '{"id":7,"head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":2}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"failure"}]}]'
      Then the effective jobs of the gh run for "linux" have the state "failed"

    Scenario: lack of a proven attempt stops delivery before a rerun request
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the run of "7" with '{"id":7,"head_sha":"0000000000000000000000000000000000000021","status":"completed"}'
      When I ask the gh forge for a delivery decision
      Then the gh forge failed with "the forge did not answer: run"
      And the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api repos/cdeust/architect-os/actions/runs/7
        """

    Scenario Outline: a partial rerun uses the newest execution of each job across all pages
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[]},{"jobs":[{"name":"linux","runner_name":"runner","conclusion":"<latest>"}]}]'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"linux","runner_name":"runner","conclusion":"<old>"},{"name":"macos","runner_name":"runner","conclusion":"success"}]}]'
      Then the effective jobs of the gh run for "linux, macos" have the state "<state>"

      Examples:
        | latest  | old     | state  |
        | success | failure | green  |
        | failure | success | failed |

    Scenario: an empty current attempt cannot inherit successful jobs from an earlier execution
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[]}]'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success"}]}]'
      Then the gh run for "linux" is:
        """
        {"id":7,"completed":true,"attempt":2,"jobs":[]}
        """
      And the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api --paginate --slurp repos/cdeust/architect-os/actions/runs/7/attempts/2/jobs?per_page=100
        """

    Scenario: a complete current attempt makes no request for an older attempt
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success"}]}]'
      Then the gh run for "linux" is:
        """
        {"id":7,"completed":true,"attempt":2,"jobs":[{"name":"linux","conclusion":"success","hadRunner":true,"failedStep":false}]}
        """
      And the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api --paginate --slurp repos/cdeust/architect-os/actions/runs/7/attempts/2/jobs?per_page=100
        """

    Scenario: an empty historical attempt does not stop the search for another required job
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":3}]}'
      And the gh forge answers the attempt of "7/3" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success"}]}]'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[]}]'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"macos","runner_name":"r","conclusion":"success"}]}]'
      Then the effective jobs of the gh run for "linux, macos" have the state "green"

    Scenario: a completed attempt can also be read without a job filter
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":1}]}'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success"}]}]'
      Then the unfiltered gh run is:
        """
        {"id":7,"completed":true,"attempt":1,"jobs":[{"name":"linux","conclusion":"success","hadRunner":true,"failedStep":false}]}
        """

    Scenario: an in-progress unnumbered run uses the live jobs response
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"in_progress"}]}'
      And the gh forge answers the jobs of "7" with '{"jobs":[]}'
      Then the gh run for "linux" is:
        """
        {"id":7,"completed":false,"jobs":[]}
        """
      And the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api repos/cdeust/architect-os/actions/runs/7/jobs?per_page=100
        """

    Scenario: an in-progress numbered attempt uses the live jobs response
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"in_progress","run_attempt":2}]}'
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"linux","runner_name":"live","conclusion":null}]}'
      Then the gh run for "linux" is:
        """
        {"id":7,"completed":false,"attempt":2,"jobs":[{"name":"linux","conclusion":null,"hadRunner":true,"failedStep":false}]}
        """
      And the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api repos/cdeust/architect-os/actions/runs/7/jobs?per_page=100
        """

    Scenario: an unavailable attempt-specific listing reports the failed operation
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with the exit code 1 and the output "fixture attempted listing"
      When I ask the gh forge for a delivery decision
      Then the gh forge failed with "the forge did not answer: jobs (exit code 1)"

    Scenario Outline: evidence for the first failed user step
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the gh forge answers the jobs of "7" with '{"jobs":[{"name":"linux","runner_name":"r","conclusion":"failure","steps":<steps>}]}'
      Then the gh run reports the first failed user step as "<name>"

      Examples:
        | steps                                                                                                                                                                             | name      |
        | [{"name":"Set up job","conclusion":"success"},{"name":"Admission","conclusion":"failure"},{"name":"Build","conclusion":"skipped"},{"name":"Complete job","conclusion":"success"}] | Admission |
        | [{"name":"Admission","conclusion":"failure"}]                                                                                                                                     | Admission |
        | [{"conclusion":"failure"}]                                                                                                                                                        |           |
        | [{"name":"Earlier","conclusion":"success"},{"name":"Admission","conclusion":"failure"}]                                                                                           |           |
        | [{"name":"Admission","conclusion":"failure"},{"name":"Build","conclusion":"failure"}]                                                                                             |           |
        | [{"name":"Admission","conclusion":"failure"},{"name":"Build","conclusion":"success"}]                                                                                             |           |
        | [{"name":"Set up job","conclusion":"skipped"},{"name":"Admission","conclusion":"failure"}]                                                                                        |           |
        | [{"name":"Admission","conclusion":"failure"},{"name":"Complete job","conclusion":"success"},{"name":"Build","conclusion":"skipped"}]                                              |           |
        | [{"name":"Admission","conclusion":"failure"},{"name":"Complete job","conclusion":null}]                                                                                          |           |

  Rule: Progress

    Scenario Outline: the phases are kept in order, each reported once
      Given a delivery progress of the <adapter> adapter
      When I report the phases "préalables, branche d'essai, porte" to the delivery progress
      And I report the phases "CI, publication, rangement" to the delivery progress
      Then the delivery progress holds the phases "préalables, branche d'essai, porte, CI, publication, rangement"

      Examples:
        | adapter   |
        | in-memory |
        | stream    |

    Scenario: nothing reported, nothing written
      Given a delivery progress of the stream adapter
      Then the delivery progress holds the phases ""

    Scenario: the stream gets a line per phase, as it is reported
      Given a delivery progress of the stream adapter
      When I report the phases "porte, CI" to the delivery progress
      Then the stream of the delivery progress holds 2 lines, each ended by a line break

  Rule: Gate

    Scenario Outline: no verdict, then the verdict of a green gate, and the exit code
      Given a delivery gate of the <adapter> adapter
      And the delivery gate leaves the verdict "0000000000000000000000000000000000000006" and exits 0
      Then the delivery gate verdict is nothing
      When I run the delivery gate
      Then the delivery gate exited 0
      And the delivery gate verdict names "0000000000000000000000000000000000000006"

      Examples:
        | adapter   |
        | in-memory |
        | process   |

    Scenario Outline: a red gate gives its exit code
      Given a delivery gate of the <adapter> adapter
      And the delivery gate leaves the verdict "none" and exits 3
      When I run the delivery gate
      Then the delivery gate exited 3
      And the delivery gate verdict is nothing

      Examples:
        | adapter   |
        | in-memory |
        | process   |

    Scenario: a verdict naming letters from a to f
      Given a delivery gate of the process adapter
      And the delivery gate leaves the verdict "abcdef0123456789abcdef0123456789abcdef01" and exits 0
      When I run the delivery gate
      Then the delivery gate verdict names "abcdef0123456789abcdef0123456789abcdef01"

    Scenario Outline: a verdict file that does not name a commit
      Given a delivery gate of the process adapter
      And the delivery gate leaves the verdict file '<content>' and exits 0
      When I run the delivery gate
      Then the delivery gate exited 0
      And the delivery gate verdict is nothing

      Examples:
        | content                                                                  |
        | not json at all                                                          |
        | null                                                                     |
        | {"scenarios":[]}                                                         |
        | {"sha":"ABCDEF0123456789ABCDEF0123456789ABCDEF01"}                      |
        | {"sha":"abcdef0123456789abcdef0123456789abcdef0"}                      |
        | {"sha":"0abcdef0123456789abcdef0123456789abcdef01"}                     |
        | {"sha":"gabcdef0123456789abcdef0123456789abcdef01"}                     |
        | {"sha":"abcdef0123456789abcdef0123456789abcdef01g"}                     |
        | {"sha":"abcdef0123456789abcdgf0123456789abcdef01"}                      |
        | {"sha":["abcdef0123456789abcdef0123456789abcdef01"]}                    |

    Scenario: a gate that writes on both outputs leaves both in its log, and nothing elsewhere
      Given a delivery gate of the process adapter
      And the noisy delivery gate leaves no verdict and exits 0
      When I run the delivery gate
      Then the delivery gate exited 0
      And the delivery gate log holds "on the standard output" and "on the error output"

    Scenario: the log of a previous run is emptied
      Given a delivery gate of the process adapter
      And the delivery gate log already holds "a previous run"
      And the delivery gate leaves the verdict "none" and exits 0
      When I run the delivery gate
      Then the delivery gate log is empty

    Scenario: a gate that ends on a signal exits 1
      Given a delivery gate of the process adapter
      And the delivery gate ends on a signal
      When I run the delivery gate
      Then the delivery gate exited 1

    Scenario: a gate command that does not exist exits 1
      Given a delivery gate of the process adapter
      And the delivery gate command is "/nonexistent/gate"
      When I run the delivery gate
      Then the delivery gate exited 1

    Scenario: Delivery projects only the admitted allocation and required host binaries to its nested Gate
      Given a delivery gate of the process adapter
      Then a real Gate subprocess has exactly its admitted paths, PATH and PG_BIN

    Scenario: Delivery ignores a green-looking file created in the checkout
      Given a delivery gate of the process adapter
      Then a legacy checkout verdict cannot satisfy the delivery Gate

  Rule: Clock

    Scenario Outline: a sleep resolves
      Given a delivery clock of the <adapter> adapter
      When I sleep 1 seconds on the delivery clock
      Then the delivery clock sleep resolved

      Examples:
        | adapter   |
        | in-memory |
        | timer     |

    Scenario: the in-memory clock counts the seconds and does not wait
      Given a delivery clock of the in-memory adapter
      When I sleep 3600 seconds on the delivery clock
      And I sleep 5 seconds on the delivery clock
      Then the in-memory delivery clock counted 3605 seconds

    Scenario: the timer clock asks its timer for milliseconds
      Given a delivery clock of the timer adapter
      When I sleep 3600 seconds on the delivery clock
      And I sleep 5 seconds on the delivery clock
      Then the timer delivery clock asked for "3600000, 5000" milliseconds

  Rule: DeliveryLog

    Scenario Outline: the entries appended are kept in order, whole
      Given a delivery log of the <adapter> adapter
      When I append to the delivery log an entry "delivered" of the commit "0000000000000000000000000000000000000007"
      And I append to the delivery log an entry "stopped" of the commit "0000000000000000000000000000000000000008"
      Then the delivery log holds, in order and whole, what was appended

      Examples:
        | adapter   |
        | in-memory |
        | file      |

    Scenario: two appends are two lines, each ended by a line break, in order
      Given a delivery log of the file adapter
      When I append to the delivery log an entry "delivered" of the commit "0000000000000000000000000000000000000007"
      And I append to the delivery log an entry "stopped" of the commit "0000000000000000000000000000000000000008"
      Then the delivery log file holds 2 lines, each ended by a line break

    Scenario: the directory is created private and the file too
      Given a delivery log of the file adapter
      And the process umask is 0 until the scenario ends
      When I append to the delivery log an entry "delivered" of the commit "0000000000000000000000000000000000000007"
      Then the delivery log directory has the mode "700"
      And the delivery log file has the mode "600"

    Scenario: a file that already holds a line keeps it
      Given a delivery log of the file adapter
      And the delivery log file already holds the line '{"other":"line"}'
      When I append to the delivery log an entry "delivered" of the commit "0000000000000000000000000000000000000007"
      Then the delivery log file holds the line '{"other":"line"}' and then what was appended

    Scenario Outline: the rule suites are an object in the order of the Map
      Given a delivery log of the file adapter
      When I append to the delivery log an entry with the rule suites "<suites>"
      Then the delivery log file holds the text '<text>'

      Examples:
        | suites                | text                                                  |
        | main=pass,10=fail,9=bypass | "ruleSuites":{"main":"pass","10":"fail","9":"bypass"} |
        | 9=fail,main=pass      | "ruleSuites":{"9":"fail","main":"pass"}              |
        | none                  | "ruleSuites":{}                                       |
