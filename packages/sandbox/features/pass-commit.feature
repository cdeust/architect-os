Feature: one commit per pass, made by the host on the work branch of the worktree
  At the end of each pass of `npm run step`, the host, never the build session, commits the work of the pass and its
  folder steps/<name>/ on the branch HEAD names, a pass refused by its reviews included, under a fixed identity, with a message that
  names the pass and carries the hash of its record. The next pass starts from that commit: its fingerprint is clean,
  and it is replayed from the repository alone (docs/design/orchestration-fable-5-2.md §14, « Un commit par passe »).
  The build cannot write .git nor steps/: under srt by the denyWrite of the builder profile, in the SBX VM by the
  reserved list of the guest, bound read-only by bwrap (sbx/codex-guest.py). The host does not rely on either: a
  rewritten folder of an earlier pass and a rewritten .git pointer are refused on real git.

  Rule: the work branch is admitted before any session

    Scenario Outline: a branch named <branch> is <verdict>
      A list of admission: `step/<series>`, the series a step name. Every delivery, trial or hand-made branch is refused.

      Then the work branch name "<branch>" is <verdict>

      Examples:
        | branch                                 | verdict  |
        | step/series                            | admitted |
        | step/a                                 | admitted |
        | step/a0-                               | admitted |
        | step/abcdefghijklmnopqrstuvwxyzabcdef  | admitted |
        | step/abcdefghijklmnopqrstuvwxyzabcdefg | refused  |
        | main                                   | refused  |
        | feat/gate-1a                           | refused  |
        | feat/commit-each-pass                  | refused  |
        | sentinel/gate-1a-demo                  | refused  |
        | origin/main                            | refused  |
        | heads/main                             | refused  |
        | refs/heads/step/demo                   | refused  |
        | step                                   | refused  |
        | step/                                  | refused  |
        | steps/demo                             | refused  |
        | xstep/demo                             | refused  |
        | Step/demo                              | refused  |
        | step/Demo                              | refused  |
        | step/0demo                             | refused  |
        | step/-demo                             | refused  |
        | step/demo/x                            | refused  |
        | step/demo.lock                         | refused  |
        | step/de mo                             | refused  |
        | step/demo\n                            | refused  |
        | step//demo                             | refused  |

    Scenario Outline: <case> is refused before any session with <code>
      Given a pass repository in memory on the branch "step/demo"
      And <situation>
      When I admit the pass
      Then the pass is refused with "<code>"

      Examples:
        | case                    | situation                                                | code                |
        | a detached head         | the head of the in-memory pass repository is detached    | PASS_DETACHED_HEAD  |
        | a branch named main     | the in-memory pass repository has the branch "main" in its head | PASS_BRANCH_REFUSED |
        | a delivery branch       | the in-memory pass repository has the branch "feat/gate-1a" in its head | PASS_BRANCH_REFUSED |
        | a branch name refused   | the in-memory pass repository has the branch "step/Demo" in its head | PASS_BRANCH_REFUSED |
        | an unrecorded ignore rule | the in-memory pass repository has "left.tmp" ignored by "info/exclude" | PASS_UNRECORDED_IGNORE |
        | a tree not clean        | the in-memory pass repository has "a.txt" changed          | PASS_START_DIRTY    |
        | a head off the snapshot | the snapshot of the pass names another commit            | PASS_BRANCH_MOVED   |

    Scenario: an in-memory repository given the ids of its first commit and tree snapshots them, clean, until its files change
      Given a pass repository in memory whose first commit is "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" with the tree "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      Then its snapshot is the commit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", the tree "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" and clean, twice
      When the in-memory pass repository has "a.txt" changed
      Then its snapshot is the commit "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", another tree and not clean

    Scenario: a clean tree at the head of a work branch admits its branch
      Given a pass repository in memory on the branch "step/demo"
      When I admit the pass
      Then the pass is admitted on the branch "step/demo"

  Rule: the commit holds the work of the pass and exactly its folder steps/<name>/

    Background:
      Given a pass repository in memory on the branch "step/demo"
      And the pass "p1" is admitted
      And the in-memory pass repository has "a.txt" changed
      And the in-memory pass repository holds the published folder of the pass "p1"

    Scenario: the pass is committed on the work branch, its start for only parent, and the index settled
      When I commit the pass "p1"
      Then the pass is committed
      And the branch "step/demo" of the in-memory pass repository is at the commit of the pass
      And the commit of the pass has the start for its parent and the end snapshot for its tree
      And the commit of the pass has the message of the pass "p1" with the hash of its record, and the date of its start
      And the index of the in-memory pass repository is the tree of the commit of the pass
      And the next pass starts clean from the commit of the pass

    Scenario: the message names the pass and the hash of the text of its record
      Then the message of the pass "p1" with the record "{}\n" is "Record the pass p1 of the loop" and "record.json sha256 ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356"

    Scenario Outline: a change under steps/ beside the folder of the pass is refused: <path>
      Given the in-memory pass repository has "<path>" changed
      When I commit the pass "p1"
      Then the pass is refused with "PASS_OUTSIDE_CHANGE"
      And the branch "step/demo" of the in-memory pass repository is at the start

      Examples:
        | path                   |
        | steps/old/record.json  |
        | steps/p1-x/record.json |
        | steps/p1/extra.md      |
        | steps/p1               |

    Scenario: a published file replaced in the tree by another file of the folder is refused
      Given the in-memory pass repository has lost "steps/p1/brief.md"
      And the in-memory pass repository has "steps/p1/other.md" changed
      When I commit the pass "p1"
      Then the pass is refused with "PASS_OUTSIDE_CHANGE"
      And the branch "step/demo" of the in-memory pass repository is at the start

    Scenario: a published file that is not in the end snapshot is refused
      Given the in-memory pass repository has lost "steps/p1/brief.md"
      When I commit the pass "p1"
      Then the pass is refused with "PASS_OUTSIDE_CHANGE"
      And the branch "step/demo" of the in-memory pass repository is at the start

    Scenario: a change outside steps/ is the work of the pass
      Given the in-memory pass repository has "stepsx/a.txt" changed
      And the in-memory pass repository has "src/steps/a.txt" changed
      When I commit the pass "p1"
      Then the pass is committed

    Scenario Outline: a file hidden by an ignore rule the start commit does not record is refused: <how>
      Given <how>
      When I commit the pass "p1"
      Then the pass is refused with "PASS_UNRECORDED_IGNORE"
      And the branch "step/demo" of the in-memory pass repository is at the start

      Examples:
        | how                                                                                          |
        | the in-memory pass repository has "src/.gitignore" changed and "src/a.ts" ignored by it       |
        | the in-memory pass repository has "src/.gitignore" ignored by itself and "src/a.ts" ignored by it |
        | the in-memory pass repository has ".gitignore" changed and "src/a.ts" ignored by it           |
        | the in-memory pass repository has "src/a.ts" ignored by "info/exclude"                        |

    Scenario: a file ignored by a rule file the start commit records, unchanged, stays out of the commit, which is made
      Given the in-memory pass repository has "debug.log" ignored by ".gitignore"
      When I commit the pass "p1"
      Then the pass is committed
      And the commit of the pass does not hold "debug.log"

    Scenario Outline: a branch that moved during the pass is refused, and left where it is: <how>
      Given <how>
      When I commit the pass "p1"
      Then the pass is refused with "PASS_BRANCH_MOVED"
      And no branch of the in-memory pass repository holds a commit of the pass

      Examples:
        | how                                                                     |
        | the branch "step/demo" of the in-memory pass repository has moved        |
        | the head of the in-memory pass repository names the branch "step/other" |
        | the head of the in-memory pass repository is detached                   |
        | the end snapshot of the pass names another commit                       |
        | the in-memory pass repository refuses to advance the branch             |
        | the end snapshot is taken, then the branch "step/demo" of the in-memory pass repository moves |

  Rule: two passes on a throwaway repository, through npm run step, are two commits replayable from the repository alone

    Scenario: each pass is one commit of the work branch, the second starts clean from the first, and both replay from a clone
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing "src/one.txt"
      And the pass "p2" is played, its build writing "src/two.txt"
      Then both passes exit with 0
      And the work branch "step/series" holds two pass commits over its first commit, "p1" then "p2"
      And each pass commit is the fixed identity of the host, unsigned, with the hash of the record it holds
      And the record of "p1" starts clean from the first commit, and the record of "p2" from the commit of "p1"
      And the summary of each pass names its commit
      And the worktree is clean for the fingerprint and for the guard of the checkout
      And a clone of the repository alone gives the start tree and the inputs of each pass

  Rule: the commit is the tree the checks and the reviews judged: no ignore rule of the pass hides a file from it

    Scenario Outline: a file the build hides by an ignore rule it wrote is refused, and the branch stays: <rule>
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing "src/.gitignore" with "<rule>" and "src/a.ts"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: PASS_UNRECORDED_IGNORE"
      And the work branch "step/series" is still at its first commit

      Examples:
        | rule                  |
        | a.ts\n                |
        | a.ts\n.gitignore\n    |

    Scenario: control: the same file without the rule is committed
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing "src/a.ts"
      Then the pass "p1" exits with 0
      And the pass commit of "p1" holds "src/a.ts" with the bytes it has on disk

    Scenario: control: a file ignored by the rule the first commit records stays out of the commit, which is made
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing "debug.log" with "noise\n" and "src/a.ts"
      Then the pass "p1" exits with 0
      And the pass commit of "p1" does not hold "debug.log"

    Scenario: a file the build writes that info/exclude of the repository ignores is refused on a linked worktree, and the branch stays
      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the info/exclude of the repository of the passes ignores "left.tmp"
      When the pass "p1" is played, its build writing "left.tmp" with "hidden\n" and "src/a.ts"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: PASS_UNRECORDED_IGNORE"
      And the work branch "step/series" is still at its first commit

  Rule: a build that rewrites what only the host writes is refused on real git, independently of the sandbox barriers

    Scenario: a build that rewrites the record of an earlier pass is refused, and the branch stays at the earlier pass
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing "src/one.txt"
      And the pass "p2" is played, its build writing "steps/p1/record.json" with "{}\n" and "src/two.txt"
      Then the pass "p2" exits with 2 and the stderr "architect-os step: PASS_OUTSIDE_CHANGE"
      And the work branch "step/series" is at the commit of the pass "p1"

    Scenario: a build that points the .git file of its worktree at another worktree is refused by the resolution of the worktree
      Given a throwaway linked worktree on the branch "step/series" for the passes
      And a second linked worktree "other" of the same repository on the branch "step/other"
      When the pass "p1" is played, its build pointing the .git file of its worktree at the worktree "other" and writing "src/one.txt"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: NOT_A_WORKTREE: gitdir ne pointe pas vers ce worktree"
      And the work branch "step/series" is still at its first commit
      And the work branch "step/other" is still at its first commit

  Rule: what a session wrote in the tree, or a configuration of the repository, starts no program of the commit

    A configuration below stands for one that exists before the step, which the srt builder cannot write.
    Each attack has its control: a git without the options of the host starts the same program.

    Scenario: a filter named by the attributes file of the tree does not run, and the blob is the bytes on disk
      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the configuration of the repository of the passes names a witness program as the clean filter "w"
      When the pass "p1" is played, its build writing ".gitattributes" with "* filter=w\n" and "src/one.txt"
      Then the pass "p1" exits with 0
      And the witness program of the passes has not run
      And the pass commit of "p1" holds "src/one.txt" with the bytes it has on disk
      When a git without the options of the host adds the tree of the worktree of the passes
      Then the witness program of the passes has run

    Scenario: a hook of the repository runs neither on the reference nor on the index
      The two hooks the calls of the commit could start: update-ref starts reference-transaction, read-tree writes the
      index and starts post-index-change. commit-tree starts no hook.

      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the repository of the passes has the hooks "reference-transaction" and "post-index-change", each leaving its mark
      When the pass "p1" is played, its build writing "src/one.txt"
      Then the pass "p1" exits with 0
      And the hooks "reference-transaction" and "post-index-change" of the passes have not run
      When a git without the options of the host moves a reference of the repository of the passes
      Then the hook "reference-transaction" of the passes has run
      When a git without the options of the host reads the head into the index of the worktree of the passes
      Then the hook "post-index-change" of the passes has run

    Scenario: a hooks directory of the configuration, in the tree, runs neither on the reference nor on the index
      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the configuration of the repository of the passes names the directory "hooks" of the worktree as its hooks "reference-transaction" and "post-index-change", each leaving its mark
      When the pass "p1" is played, its build writing "src/one.txt"
      Then the pass "p1" exits with 0
      And the hooks "reference-transaction" and "post-index-change" of the passes have not run
      When a git without the options of the host moves a reference of the repository of the passes
      Then the hook "reference-transaction" of the passes has run
      When a git without the options of the host reads the head into the index of the worktree of the passes
      Then the hook "post-index-change" of the passes has run

    Scenario: a file monitor of the configuration does not run
      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the configuration of the repository of the passes names the witness program as its file monitor
      When the pass "p1" is played, its build writing "src/one.txt"
      Then the pass "p1" exits with 0
      And the witness program of the passes has not run
      When a git without the options of the host is asked for the status of the worktree of the passes
      Then the witness program of the passes has run

    Scenario: a signing asked by the configuration is not applied
      Measured with git 2.54: commit-tree does not read commit.gpgSign, so this scenario holds without the option
      --no-gpg-sign of the host; the option stays, against a version that would read it, and the fake git above pins it.
      The control shows the witness is a signing program git starts when it is asked to sign.

      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the configuration of the repository of the passes asks for signed commits with the witness program
      When the pass "p1" is played, its build writing "src/one.txt"
      Then the pass "p1" exits with 0
      And the witness program of the passes has not run
      And each pass commit is the fixed identity of the host, unsigned, with the hash of the record it holds
      When a git asked to sign writes a commit of the worktree of the passes
      Then the witness program of the passes has run

    Scenario: a repository nested in the tree by the build is refused, and the branch does not move
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing "sub/.git" with "gitdir: /missing-gitdir\n" and "src/one.txt"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: Error: l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"
      And the work branch "step/series" is still at its first commit

    Scenario: an ignore rule written by the build that hides the folder of the pass is refused, and the branch does not move
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build writing ".gitignore" with "steps/p1/\n" and "src/one.txt"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: PASS_OUTSIDE_CHANGE"
      And the work branch "step/series" is still at its first commit

    Scenario: a commit made on the branch during the pass is kept, and the pass is refused
      Given a throwaway linked worktree on the branch "step/series" for the passes
      When the pass "p1" is played, its build committing on the branch and writing "src/one.txt"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: PASS_BRANCH_MOVED"
      And the work branch "step/series" is at the commit made during the pass

    Scenario: a worktree with uncommitted work is refused before any session
      Given a throwaway linked worktree on the branch "step/series" for the passes
      And the worktree of the passes holds the uncommitted file "left.txt"
      When the pass "p1" is played, its build writing "src/one.txt"
      Then the pass "p1" exits with 2 and the stderr "architect-os step: PASS_START_DIRTY"
      And no build session of the passes was started

  Rule: git is started with the closed options and environment, and the commit adds only its identity and date

    Scenario: the seven calls of a pass commit are argv with the closed options, and only commit-tree receives the identity
      Given a fake git for the pass commit that records its calls
      When the host commits the pass "demo" through the fake git
      Then the fake git of the pass commit was called, in this order, with:
        | rev-parse --symbolic-full-name HEAD                                                                                                                   |
        | rev-parse --verify HEAD^{commit}                                                                                                                      |
        | diff-tree -r -z --name-only --no-renames --ignore-submodules=all cccccccccccccccccccccccccccccccccccccccc cccccccccccccccccccccccccccccccccccccccc |
        | ls-files -z --others --ignored --exclude-standard --directory |
        | commit-tree --no-gpg-sign -p cccccccccccccccccccccccccccccccccccccccc -m Record the pass demo of the loop -m record.json sha256 ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356 cccccccccccccccccccccccccccccccccccccccc |
        | update-ref refs/heads/step/demo cccccccccccccccccccccccccccccccccccccccc cccccccccccccccccccccccccccccccccccccccc                                     |
        | read-tree --reset cccccccccccccccccccccccccccccccccccccccc                                                                                            |
      And each call of the fake git of the pass commit came after the closed options of the host
      And each call of the fake git of the pass commit received the closed environment, and commit-tree alone the identity of the host at the date 1763458200

    Scenario Outline: a call of the pass commit that fails throws the fixed message, which carries nothing git printed: <call>
      Given a fake git for the pass commit that records its calls
      And the fake git of the pass commit fails the call "<call>" with a marker
      When the host tries to commit the pass "demo" through the fake git
      Then the pass commit throws "le commit de la passe a échoué : git <call>"
      And the pass commit error does not contain "MARKER"

      Examples:
        | call                                |
        | rev-parse --symbolic-full-name HEAD |
        | read-tree --reset cccccccccccccccccccccccccccccccccccccccc |

    Scenario Outline: a call of the pass commit that prints what is not a hash throws the fixed message: <call>
      Given a fake git for the pass commit that records its calls
      And the fake git of the pass commit answers the call "<call>" with "<text>"
      When the host tries to commit the pass "demo" through the fake git
      Then the pass commit throws "le commit de la passe a échoué : git <call>"

      Examples:
        | call                             | text                                      |
        | rev-parse --verify HEAD^{commit} | MARKER                                    |
        | rev-parse --verify HEAD^{commit} | ccccccccccccccccccccccccccccccccccccccc   |
        | rev-parse --verify HEAD^{commit} | Cccccccccccccccccccccccccccccccccccccccc  |
        | rev-parse --verify HEAD^{commit} | cccccccccccccccccccccccccccccccccccccccc0 |

    Scenario: an update of the reference refused while the branch is still at the start is a failure, not a move
      Given a fake git for the pass commit that records its calls
      And the fake git of the pass commit fails the call "update-ref refs/heads/step/demo cccccccccccccccccccccccccccccccccccccccc cccccccccccccccccccccccccccccccccccccccc" with a marker
      And the fake git of the pass commit answers the call "for-each-ref --format=%(objectname) refs/heads/step/demo" with "cccccccccccccccccccccccccccccccccccccccc"
      When the host tries to commit the pass "demo" through the fake git
      Then the pass commit throws "le commit de la passe a échoué : git update-ref refs/heads/step/demo cccccccccccccccccccccccccccccccccccccccc cccccccccccccccccccccccccccccccccccccccc"

    Scenario: an update of the reference refused because the branch is elsewhere is a move
      Given a fake git for the pass commit that records its calls
      And the fake git of the pass commit fails the call "update-ref refs/heads/step/demo cccccccccccccccccccccccccccccccccccccccc cccccccccccccccccccccccccccccccccccccccc" with a marker
      And the fake git of the pass commit answers the call "for-each-ref --format=%(objectname) refs/heads/step/demo" with "dddddddddddddddddddddddddddddddddddddddd"
      When the host tries to commit the pass "demo" through the fake git
      Then the pass commit is refused with "PASS_BRANCH_MOVED"

    Scenario: the files whose rules ignore an untracked path are read from git's bytes, and one the start commit does not hold refuses the pass
      Given a fake git for the pass commit that records its calls
      And the fake git of the pass commit answers the call "ls-files -z --others --ignored --exclude-standard --directory" with the bytes "x.log\0cache/\0"
      And the fake git of the pass commit answers the call "check-ignore -v -z --stdin" with the bytes ".gitignore\01\0*.log\0x.log\0sub/.gitignore\02\0cache/\0cache/\0"
      And the fake git of the pass commit answers the call "--literal-pathspecs ls-tree -z --name-only cccccccccccccccccccccccccccccccccccccccc -- .gitignore" with the bytes ".gitignore\0"
      When the host tries to commit the pass "demo" through the fake git
      Then the pass commit is refused with "PASS_UNRECORDED_IGNORE"
      And the fake git of the pass commit gave check-ignore the bytes "x.log\0cache/\0" on its input
      And the fake git of the pass commit was asked whether the start commit holds ".gitignore" and "sub/.gitignore"
