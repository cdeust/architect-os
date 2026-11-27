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

    Scenario Outline: a commit records the text of a file at its path, and nothing at another
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" that records "steps/step/record.json" as the text "{\"step\":\"step\"}"
      Then the delivery commit "c2" records at "steps/step/record.json" the text "{\"step\":\"step\"}"
      And the delivery commit "c1" records no file at "steps/step/record.json"
      And the delivery commit "c2" records no file at "steps/other/record.json"
      And the delivery commit "c2" records no file at "steps/step"
      And the delivery commit "c2" records no file at "steps/step/record"

      Examples:
        | adapter   |
        | in-memory |
        | git       |

    Scenario Outline: a commit records, at a path and under it, its files at any depth, and a link as no file
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" that records "ev/a.json" as the text "a"
      And the delivery repository holds the commit "c3" after "c2" that records "ev/x/b.json" as the text "b"
      And the delivery repository holds the commit "c4" after "c3" that records a link at "ev2" to "ev"
      Then the delivery commit "c1" records at "ev" and under it the entries ""
      And the delivery commit "c3" records at "ev" and under it the entries "ev/a.json file, ev/x/b.json file"
      And the delivery commit "c3" records at "ev/a.json" and under it the entries "ev/a.json file"
      And the delivery commit "c3" records at "e" and under it the entries ""
      And the delivery commit "c4" records at "ev2" and under it the entries "ev2 other"
      And the delivery commit "c4" records at "ev/x" and under it the entries "ev/x/b.json file"

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

    Scenario: a path with a space, and bytes that are not UTF-8, are read as the commit records them
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" that records "docs/my notes.md" as the text "a note"
      And the delivery repository holds the commit "c3" after "c2" with the binary file "img.bin"
      Then the delivery commit "c2" records at "docs/my notes.md" the text "a note"
      And the delivery commit "c3" records at "img.bin" the bytes its checkout holds

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
        | deleteRemoteBranch | git push exited with code 128    |
        | committedFile      | git ls-tree exited with code 128 |
        | committedEntries   | git ls-tree exited with code 128 |

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
        | push               | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null push --quiet --recurse-submodules=no origin aaa:refs/heads/main |
        | deleteRemoteBranch | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null push --quiet --recurse-submodules=no origin :refs/heads/main |
        | committedFile      | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null ls-tree -r -z --full-tree aaa |
        | committedEntries   | --no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null ls-tree -r -z --full-tree aaa |

    Scenario: what a commit records at a path is read from the commit, whatever the checkout holds, and a link is no file
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" that records "steps/step/record.json" as the text "recorded"
      And the delivery repository holds the commit "c3" after "c2" that records a link at "steps/link/record.json" to "../step/record.json"
      When the delivery worktree file "steps/step/record.json" now holds "changed"
      Then the delivery commit "c2" records at "steps/step/record.json" the text "recorded"
      And the delivery commit "c3" records at "steps/step/record.json" the text "recorded"
      And the delivery commit "c3" records no file at "steps/link/record.json"
      And the delivery commit "c3" records no file at "step/record.json"

    Scenario: an executable file is a file of the commit, a directory is not
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1" that records "steps/step/record.json" executable, as the text "executable"
      Then the delivery commit "c2" records at "steps/step/record.json" the text "executable"
      And the delivery commit "c2" records no file at "steps"

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

  Rule: what the repository replaces is not what the delivery reads

    Background:
      Given a delivery repository of the git adapter
      And the delivery repository holds the commit "c1"

    Scenario: a replace object of the blob of a file does not change what the commit records
      Given the delivery repository holds the commit "c2" after "c1" that records "a.md" as the text "recorded"
      And the delivery repository holds the commit "c3" after "c2" that records "a.md" as the text "replacing"
      And the delivery repository replaces the blob of "a.md" at "c2" by its blob at "c3"
      Then the delivery commit "c2" records at "a.md" the text "recorded"

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

    Scenario Outline: a run whose failed jobs ran again gives the newest execution of each job, asked for <asked>
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000021" the run 31, whose attempts executed the jobs '[[{"name":"gate-linux-lane-1","conclusion":"failure","hadRunner":true,"failedStep":true},{"name":"gate-linux-lane-2","conclusion":"success","hadRunner":true,"failedStep":false}],[{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false}]]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021", asked for '<names>', the run 31 at attempt 2 with the jobs '<jobs>'

      Examples:
        | adapter   | asked                     | names                   | jobs |
        | in-memory | every job                 | all                     | [{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-linux-lane-2","conclusion":"success","hadRunner":true,"failedStep":false}] |
        | gh        | every job                 | all                     | [{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-linux-lane-2","conclusion":"success","hadRunner":true,"failedStep":false}] |
        | in-memory | the job of the last attempt | ["gate-linux-lane-1"] | [{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false}] |
        | gh        | the job of the last attempt | ["gate-linux-lane-1"] | [{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false}] |

    Scenario Outline: a run whose failed jobs ran again, asked for no job, gives the newest execution of every job
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000022" the run 32, whose attempts executed the jobs '[[{"name":"gate-linux-lane-1","conclusion":"failure","hadRunner":true,"failedStep":true},{"name":"gate-linux-lane-2","conclusion":"success","hadRunner":true,"failedStep":false}],[{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false}]]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000022", asked for no job, the run 32 at attempt 2 with the jobs '[{"name":"gate-linux-lane-1","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-linux-lane-2","conclusion":"success","hadRunner":true,"failedStep":false}]'

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

    Scenario Outline: a run of the push of the commit to another branch is not the run of the push
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[]'
      Then the delivery forge has no run of the push of the commit "0000000000000000000000000000000000000021" to "sentinel/gate-1a-other"

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: a pull request is opened for a head the forge sees at the commit, then found and not doubled
      Given a delivery forge of the <adapter> adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      When I ask the delivery forge for a pull request from "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And I ask the delivery forge for a pull request from "deliver/step" at the commit "0000000000000000000000000000000000000021"
      Then the delivery forge answered the pull requests '[{"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true},{"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":false}]'

      Examples:
        | adapter   |
        | in-memory |
        | gh        |

    Scenario Outline: no pull request is opened when <case>
      Given a delivery forge of the <adapter> adapter
      And <setting>
      When I ask the delivery forge for a pull request from "deliver/step" at the commit "0000000000000000000000000000000000000021"
      Then the delivery forge refused the pull request because "<reason>"

      Examples:
        | adapter   | case                                     | setting                                                                                                    | reason                                                    |
        | in-memory | the forge does not see the head          | the delivery forge does not see the branch "deliver/step"                                                  | la forge ne voit pas la branche de travail                |
        | gh        | the forge does not see the head          | the delivery forge does not see the branch "deliver/step"                                                  | la forge ne voit pas la branche de travail                |
        | in-memory | the head is at another commit            | the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000022"                                      | la tête de la branche de travail n'est pas le commit livré |
        | gh        | the head is at another commit            | the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000022"                                      | la tête de la branche de travail n'est pas le commit livré |
        | in-memory | the open pull request is a draft         | a pull request from "deliver/step" at the commit "0000000000000000000000000000000000000021" is open as a draft on the delivery forge            | une pull request en brouillon est ouverte pour cette tête |
        | gh        | the open pull request is a draft         | a pull request from "deliver/step" at the commit "0000000000000000000000000000000000000021" is open as a draft on the delivery forge            | une pull request en brouillon est ouverte pour cette tête |
        | in-memory | the forge refuses it                     | the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021", and refuses every new pull request | la forge a refusé la pull request                         |
        | gh        | the forge refuses it                     | the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021", and refuses every new pull request | la forge a refusé la pull request                         |
        | in-memory | the destination holds the commit         | the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021", and answers that the destination holds the commit | la destination contient déjà le commit livré                         |
        | gh        | the destination holds the commit         | the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021", and answers that the destination holds the commit | la destination contient déjà le commit livré                         |

    Scenario: the in-memory forge keeps one pull request per head and base
      Given a delivery forge of the in-memory adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the delivery forge sees the branch "deliver/other" at the commit "0000000000000000000000000000000000000021"
      When I ask the delivery forge for a pull request from "deliver/step" to "main" at the commit "0000000000000000000000000000000000000021"
      And I ask the delivery forge for a pull request from "deliver/step" to "release" at the commit "0000000000000000000000000000000000000021"
      And I ask the delivery forge for a pull request from "deliver/other" to "main" at the commit "0000000000000000000000000000000000000021"
      And I ask the delivery forge for a pull request from "deliver/step" to "release" at the commit "0000000000000000000000000000000000000021"
      Then the delivery forge answered the pull requests '[{"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true},{"ok":true,"number":2,"url":"https://github.com/cdeust/architect-os/pull/2","created":true},{"ok":true,"number":3,"url":"https://github.com/cdeust/architect-os/pull/3","created":true},{"ok":true,"number":2,"url":"https://github.com/cdeust/architect-os/pull/2","created":false}]'

    Scenario: a run started by a pull request, and a run of the push to another branch, are not the run of the push
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":1,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"pull_request","head_branch":"sentinel/gate-1a-step","status":"completed"},{"id":2,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"main","status":"completed"},{"id":3,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":null,"status":"completed"},{"id":5,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"}]}'
      And the gh forge answers the jobs of "5" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 5, completed "yes", with the jobs '[]'

    Scenario: the gh adapter asks the exact arguments of each call
      Given a delivery forge of the gh adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000021" the run 7, completed "yes", with the jobs '[]'
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      When I ask the gh forge for the run
      And I ask the gh forge to rerun the run 7
      And I ask the gh forge for a pull request from "deliver/step"
      Then the gh client was asked:
        """
        api repos/cdeust/architect-os/actions/runs?head_sha=0000000000000000000000000000000000000021&per_page=100
        api repos/cdeust/architect-os/actions/runs/7/jobs?per_page=100
        api --method POST repos/cdeust/architect-os/actions/runs/7/rerun-failed-jobs
        api repos/cdeust/architect-os/git/matching-refs/heads/deliver/step
        api repos/cdeust/architect-os/pulls?head=cdeust%3Adeliver%2Fstep&base=main&state=open&per_page=100
        api --method POST repos/cdeust/architect-os/pulls -f head=deliver/step -f base=main -f title=Deliver the step step -f body=line one
        @someone -F draft=false
        """
      And the gh client was asked for a new pull request with the arguments, each as JSON:
        """
        "api"
        "--method"
        "POST"
        "repos/cdeust/architect-os/pulls"
        "-f"
        "head=deliver/step"
        "-f"
        "base=main"
        "-f"
        "title=Deliver the step step"
        "-f"
        "body=line one\n@someone"
        "-F"
        "draft=false"
        """

    Scenario: two runs of the workflow for the commit: the one of the smaller id, whatever the order
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":8,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"},{"id":3,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"in_progress"}]}'
      And the gh forge answers the jobs of "3" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 3, completed "no", with the jobs '[]'

    Scenario: a run of another workflow and a run of another commit are not the run of the commit
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":1,"name":"other","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"},{"id":2,"name":"gate","head_sha":"0000000000000000000000000000000000000022","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"},{"id":5,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"}]}'
      And the gh forge answers the jobs of "5" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 5, completed "yes", with the jobs '[]'

    Scenario: runs of another workflow and of another commit only: no run
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":1,"name":"other","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"},{"id":2,"name":"gate","head_sha":"0000000000000000000000000000000000000022","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed"}]}'
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
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":4,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"queued"}]}'
      And the gh forge answers the jobs of "4" with '{"jobs":[]}'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000021" the run 4, completed "no", with the jobs '[]'

    Scenario Outline: a program that exits non-zero: the fixed message with the exit code, and nothing it printed
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the <kind> of "<subject>" with the exit code 3 and the output "MARKER-9c2e"
      When I ask the gh forge <call>
      Then the gh forge failed with "the forge did not answer: <label> (exit code 3)"
      And the message of the gh forge failure holds nothing of "MARKER-9c2e"

      Examples:
        | kind  | subject | call                          | label       |
        | runs  | 0000000000000000000000000000000000000021  | for the run                   | runs        |
        | jobs  | 7       | for the run                   | jobs        |
        | rerun | 7       | to rerun the run 7            | rerun       |
        | refs  | deliver/step | for a pull request from "deliver/step" | refs |
        | pulls | deliver/step | for a pull request from "deliver/step" | pulls |

    Scenario Outline: a program that prints what is not JSON: the fixed message, and nothing it printed
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the <kind> of "<subject>" with "MARKER-9c2e"
      When I ask the gh forge <call>
      Then the gh forge failed with "the forge did not answer: <label>"
      And the message of the gh forge failure holds nothing of "MARKER-9c2e"

      Examples:
        | kind   | subject | call                 | label       |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        |
        | jobs   | 7       | for the run          | jobs        |
        | refs   | deliver/step | for a pull request from "deliver/step" | refs |
        | pulls  | deliver/step | for a pull request from "deliver/step" | pulls |

    Scenario Outline: a program that prints JSON the schema refuses: the fixed message, and nothing it printed
      Given a delivery forge of the gh adapter
      And the gh forge finds the run 7 of "0000000000000000000000000000000000000021"
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the <kind> of "<subject>" with '<output>'
      When I ask the gh forge <call>
      Then the gh forge failed with "the forge did not answer: <label>"
      And the message of the gh forge failure holds nothing of "MARKER-9c2e"

      Examples:
        | kind   | subject | call                 | label       | output                                                                                       |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        | {"marker":"MARKER-9c2e"}                                                                     |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        | {"workflow_runs":[{"id":0,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"MARKER-9c2e"}]}        |
        | runs   | 0000000000000000000000000000000000000021  | for the run          | runs        | {"workflow_runs":[{"id":1.5,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"MARKER-9c2e"}]}      |
        | jobs   | 7       | for the run          | jobs        | {"marker":"MARKER-9c2e"}                                                                     |
        | refs   | deliver/step | for a pull request from "deliver/step" | refs | {"marker":"MARKER-9c2e"} |
        | pulls  | deliver/step | for a pull request from "deliver/step" | pulls | [{"number":"MARKER-9c2e","html_url":"https://github.com/cdeust/architect-os/pull/1","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}}] |

    Scenario Outline: the open pull request the forge lists is the one of the head and the base: <case>
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the pulls of "deliver/step" with '<listed>'
      When I ask the gh forge for a pull request from "deliver/step"
      Then the gh forge answered the pull request '<answer>'
      And the gh client was asked for <created> new pull request

      Examples:
        | case                                   | listed | answer | created |
        | the smaller number of two              | [{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}},{"number":2,"html_url":"https://github.com/cdeust/architect-os/pull/2","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}}] | {"ok":true,"number":2,"url":"https://github.com/cdeust/architect-os/pull/2","created":false} | no |
        | another head is not it                 | [{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"open","draft":false,"head":{"ref":"deliver/other","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}}] | {"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true} | one |
        | another base is not it                 | [{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"feat/x"}}] | {"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true} | one |
        | a closed one is not it                 | [{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"closed","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}}] | {"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true} | one |
        | one of a fork is not it                | [{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"someone/architect-os"}},"base":{"ref":"main"}}] | {"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true} | one |
        | one whose repository is gone is not it | [{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":null},"base":{"ref":"main"}}] | {"ok":true,"number":1,"url":"https://github.com/cdeust/architect-os/pull/1","created":true} | one |

    Scenario: an open pull request whose head the forge still shows at another commit is not taken, and nothing is opened
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the pulls of "deliver/step" with '[{"number":5,"html_url":"https://github.com/cdeust/architect-os/pull/5","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000022","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}}]'
      When I ask the gh forge for a pull request from "deliver/step"
      Then the gh forge refused the pull request because "la tête de la branche de travail n'est pas le commit livré"
      And the gh client was asked for no new pull request

    Scenario Outline: a new pull request the forge answers is checked against what was asked: <case>
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the open of "" with '<created>'
      When I ask the gh forge for a pull request from "deliver/step"
      Then <outcome>

      Examples:
        | case                     | created | outcome |
        | a draft                  | {"number":4,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"open","draft":true,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}} | the gh forge refused the pull request because "une pull request en brouillon est ouverte pour cette tête" |
        | another commit           | {"number":4,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000022","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}} | the gh forge refused the pull request because "la tête de la branche de travail n'est pas le commit livré" |
        | another head             | {"number":4,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"open","draft":false,"head":{"ref":"deliver/other","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}} | the gh forge failed with "the forge did not answer: pull request" |
        | another base             | {"number":4,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"feat/x"}} | the gh forge failed with "the forge did not answer: pull request" |
        | another repository of the head | {"number":4,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"someone/architect-os"}},"base":{"ref":"main"}} | the gh forge failed with "the forge did not answer: pull request" |
        | one that is not open     | {"number":4,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"closed","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}} | the gh forge failed with "the forge did not answer: pull request" |
        | nothing a schema accepts | {} | the gh forge failed with "the forge did not answer: pull request" |
        | an address that is not one | {"number":4,"html_url":"https://github.com/cdeust/architect-os/issues/4","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}} | the gh forge failed with "the forge did not answer: pull request" |
        | a number that is not one | {"number":0,"html_url":"https://github.com/cdeust/architect-os/pull/4","state":"open","draft":false,"head":{"ref":"deliver/step","sha":"0000000000000000000000000000000000000021","repo":{"full_name":"cdeust/architect-os"}},"base":{"ref":"main"}} | the gh forge failed with "the forge did not answer: pull request" |

    Scenario: a head the forge shows at another commit: no new pull request is asked
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000022"
      When I ask the gh forge for a pull request from "deliver/step"
      Then the gh forge refused the pull request because "la tête de la branche de travail n'est pas le commit livré"
      And the gh client was asked for no new pull request

    Scenario: a client ended by a signal while it opens a pull request: the fixed message of the call
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh client is ended by a signal when it is asked for a new pull request
      When I ask the gh forge for a pull request from "deliver/step"
      Then the gh forge failed with "the forge did not answer: pull request"

    Scenario Outline: a refusal the client prints is read for one thing only, a destination that holds the commit: <case>
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021"
      And the gh forge answers the open of "" with the exit code 1 and the output '<answer>'
      When I ask the gh forge for a pull request from "deliver/step"
      Then the gh forge refused the pull request because "<reason>"

      Examples:
        | case                               | answer                                                                                     | reason                                        |
        | no commits between                 | {"message":"Validation Failed","errors":[{"message":"No commits between main and deliver/step"}]} | la destination contient déjà le commit livré |
        | the second of two errors           | {"errors":[{"message":"other"},{"message":"No commits between main and x"}]}           | la destination contient déjà le commit livré |
        | another error                      | {"message":"Validation Failed","errors":[{"message":"A pull request already exists"}]} | la forge a refusé la pull request             |
        | the words not at the start         | {"errors":[{"message":"x No commits between main and x"}]}                               | la forge a refusé la pull request             |
        | no list of errors                  | {"message":"No commits between main and x"}                                              | la forge a refusé la pull request             |
        | not JSON                           | No commits between                                                                         | la forge a refusé la pull request             |

    Scenario: a refusal of the forge holds nothing of what the client printed
      Given a delivery forge of the gh adapter
      And the delivery forge sees the branch "deliver/step" at the commit "0000000000000000000000000000000000000021", and refuses every new pull request
      When I ask the gh forge for a pull request from "deliver/step"
      Then the gh forge refused the pull request because "la forge a refusé la pull request"

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
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"failure","id":21}],"total_count":1}]'
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
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[],"total_count":1},{"jobs":[{"name":"linux","runner_name":"runner","conclusion":"<latest>","id":21}],"total_count":1}]'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"linux","runner_name":"runner","conclusion":"<old>","id":11},{"name":"macos","runner_name":"runner","conclusion":"success","id":12}],"total_count":2}]'
      Then the effective jobs of the gh run for "linux, macos" have the state "<state>"

      Examples:
        | latest  | old     | state  |
        | success | failure | green  |
        | failure | success | failed |

    Scenario Outline: an attempt job list with <defect> stops delivery before a verdict
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":1}]}'
      And the gh forge answers the attempt of "7/1" with '<pages>'
      When I ask the gh forge for a delivery decision
      Then the gh forge failed with "the forge did not answer: jobs"

      Examples:
        | defect                    | pages |
        | no page                   | [] |
        | no total                  | [{"jobs":[]}] |
        | a missing job ID          | [{"total_count":1,"jobs":[{"name":"linux","runner_name":"r","conclusion":"success"}]}] |
        | a zero ID                 | [{"total_count":1,"jobs":[{"id":0,"name":"linux","runner_name":"r","conclusion":"success"}]}] |
        | a fractional ID           | [{"total_count":1,"jobs":[{"id":1.5,"name":"linux","runner_name":"r","conclusion":"success"}]}] |
        | inconsistent page totals  | [{"total_count":1,"jobs":[{"id":1,"name":"linux","runner_name":"r","conclusion":"success"}]},{"total_count":2,"jobs":[]}] |
        | a repeated ID across pages | [{"total_count":2,"jobs":[{"id":1,"name":"linux","runner_name":"r","conclusion":"success"}]},{"total_count":2,"jobs":[{"id":1,"name":"macos","runner_name":"r","conclusion":"success"}]}] |

    Scenario: an empty current attempt cannot inherit successful jobs from an earlier execution
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[],"total_count":0}]'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success","id":11}],"total_count":1}]'
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
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":2}]}'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success","id":21}],"total_count":1}]'
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
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":3}]}'
      And the gh forge answers the attempt of "7/3" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success","id":31}],"total_count":1}]'
      And the gh forge answers the attempt of "7/2" with '[{"jobs":[],"total_count":0}]'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"macos","runner_name":"r","conclusion":"success","id":11}],"total_count":1}]'
      Then the effective jobs of the gh run for "linux, macos" have the state "green"

    Scenario: a completed attempt can also be read without a job filter
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":1}]}'
      And the gh forge answers the attempt of "7/1" with '[{"jobs":[{"name":"linux","runner_name":"r","conclusion":"success","id":11}],"total_count":1}]'
      Then the unfiltered gh run is:
        """
        {"id":7,"completed":true,"attempt":1,"jobs":[{"name":"linux","conclusion":"success","hadRunner":true,"failedStep":false}]}
        """

    Scenario: an in-progress unnumbered run uses the live jobs response
      Given a delivery forge of the gh adapter
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"in_progress"}]}'
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
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"in_progress","run_attempt":2}]}'
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
      And the gh forge answers the runs of "0000000000000000000000000000000000000021" with '{"workflow_runs":[{"id":7,"name":"gate","head_sha":"0000000000000000000000000000000000000021","event":"push","head_branch":"sentinel/gate-1a-step","status":"completed","run_attempt":2}]}'
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
      And the delivery gate verdict names "0000000000000000000000000000000000000006" against the destination "0000000000000000000000000000000000000005"

      Examples:
        | adapter   |
        | in-memory |
        | process   |

    Scenario Outline: a verdict whose report names no destination is a verdict without one
      Given a delivery gate of the <adapter> adapter
      And the delivery gate leaves the verdict "0000000000000000000000000000000000000006" against no destination and exits 0
      When I run the delivery gate
      Then the delivery gate verdict names "0000000000000000000000000000000000000006" against the destination "none"

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

    Scenario Outline: the pull request of an entry is its last key, and an entry without one has none
      Given a delivery log of the file adapter
      When I append to the delivery log an entry with the pull request '<pull>'
      Then the delivery log file holds the text '<text>'

      Examples:
        | pull                                                                                   | text                                                                                                                   |
        | none                                                                                   | "published":[]}                                                                                                        |
        | {"number":3,"url":"https://github.com/owner/name/pull/3","created":false,"body":"b"} | "published":[],"pullRequest":{"number":3,"url":"https://github.com/owner/name/pull/3","created":false,"body":"b"}} |
