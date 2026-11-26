Feature: no production file that starts git gives process.env to a launch (docs/design/orchestration-fable-5-2.md §14)
  This file checks the closed launch environments as text. It covers the fingerprint, the gate, the lease, delivery and the guard of the checkout they share.
  The scenarios on the suite itself are in features/descriptive/closed-git-environment.feature.

  It is under features/arch, which the mutation profile leaves out; why is written in cucumber.mjs.

  Rule: no production file that starts git gives process.env to a launch

    Scenario Outline: the committed file <file> gives no process.env to a launch
      Given the text of the committed file "<file>"
      Then the text gives process.env to no process launch

      Examples:
        | file                                       |
        | packages/sandbox/src/tree-fingerprint.ts   |
        | tools/test-gate/src/infrastructure/git.ts  |
        | tools/deliver/src/infrastructure/host-process.ts |
        | packages/sandbox/src/git-worktree.ts       |

    Scenario Outline: a copy of <file> that gives process.env to its launch is refused
      Given the text of the committed file "<file>"
      When the text "<closed>" is replaced by "<open>"
      Then the text gives process.env to a process launch

      Examples:
        | file                                       | closed                    | open                                  |
        | packages/sandbox/src/tree-fingerprint.ts   | { ...host, GIT_INDEX_FILE | { ...process.env, GIT_INDEX_FILE      |
        | tools/test-gate/src/infrastructure/git.ts  | env: closedEnvironment(), | env: process.env,                     |
        | tools/deliver/src/infrastructure/host-process.ts | env: environment, | env: { ...process.env, ...environment }, |
        | packages/sandbox/src/git-worktree.ts       | env: {},                  | env: process.env,                     |

    Scenario Outline: what is not a launch given the whole environment is not refused: <text>
      Given the text of the committed file "packages/sandbox/src/tree-fingerprint.ts"
      When the text "const names" is replaced by "<text> const names"
      Then the text gives process.env to no process launch

      Examples:
        | text                            |
        | const value = process.env[name]; |
        | const home = process.env.HOME;   |

  Rule: the list of names written in the fingerprint and the one written in the gate are the same

    The gate does not take its git from the fingerprint, so each writes the list of the variables of the host that git
    needs; the text of the two files must give the same names, in the same order.

    Scenario: the lists of packages/sandbox/src/tree-fingerprint.ts and of tools/test-gate/src/infrastructure/git.ts are the same
      Given the text of the committed file "tools/test-gate/src/infrastructure/git.ts"
      Then the names of the closed environment in the text are those of the committed file "packages/sandbox/src/tree-fingerprint.ts"

    Scenario Outline: a copy of the gate file whose list differs is refused: <change>
      Given the text of the committed file "tools/test-gate/src/infrastructure/git.ts"
      When the text "<closed>" is replaced by "<open>"
      Then the names of the closed environment in the text are not those of the committed file "packages/sandbox/src/tree-fingerprint.ts"

      Examples:
        | change            | closed             | open                  |
        | a name changed    | 'TMPDIR'           | 'TMP'                 |
        | a name removed    | 'LANG', 'LC_ALL'   | 'LC_ALL'              |
        | a name added      | 'TMPDIR']          | 'TMPDIR', 'USER']     |
        | two names swapped | 'PATH', 'LANG'     | 'LANG', 'PATH'        |

  Rule: every git of the host takes its closed options and variables from packages/sandbox/git-closed.json

    Scenario Outline: <file> reads the closed options and variables of git from the file of the launcher
      Given the text of the committed file "<file>"
      Then the text gives its git the closed options and variables of the launcher

      Examples:
        | file                                               |
        | packages/sandbox/src/tree-fingerprint.ts           |
        | tools/test-gate/src/infrastructure/git.ts          |
        | tools/deliver/src/infrastructure/git-repository.ts |
        | tools/test-gate/with-tree-lock.py                  |

    Scenario Outline: a copy of <file> that keeps options or variables of its own instead is refused
      Given the text of the committed file "<file>"
      When the text "<closed>" is replaced by "<open>"
      Then the text does not give its git the closed options and variables of the launcher

      Examples:
        | file                                               | closed                    | open           |
        | packages/sandbox/src/tree-fingerprint.ts           | ...closedGit().options    | '--no-pager'   |
        | tools/test-gate/src/infrastructure/git.ts          | ...closedGit().environment | GIT_X: '1'    |
        | tools/deliver/src/infrastructure/git-repository.ts | ...closedGit().options    | '--no-pager'   |
        | tools/test-gate/with-tree-lock.py                  | **CLOSED                  | **OWN          |

  Rule: the guard of the checkout is started with an empty environment

    It sets the environment of its own git calls; nothing of the host's reaches it.

    Scenario: the committed launcher of the guard gives it an empty environment
      Given the text of the committed file "packages/sandbox/src/git-worktree.ts"
      Then the guard of the checkout is started with an empty environment

    Scenario Outline: a copy that gives the guard a variable of the host is refused: <variable>
      Given the text of the committed file "packages/sandbox/src/git-worktree.ts"
      When the text "env: {}," is replaced by "env: { <variable>: process.env.<variable> },"
      Then the guard of the checkout is not started with an empty environment

      Examples:
        | variable     |
        | HOME         |
        | PYTHONSTARTUP |
