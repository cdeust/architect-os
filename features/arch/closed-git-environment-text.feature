Feature: no production file that starts git gives process.env to a launch (docs/design/orchestration-fable-5-2.md §14)
  This file checks the closed launch environments as text. It covers the module that builds the environment of every
  git of the host, the fingerprint, the gate, the delivery and the guard of the checkout they share.
  The scenarios on the suite itself are in features/descriptive/closed-git-environment.feature.

  It is under features/arch, which the mutation profile leaves out; why is written in cucumber.mjs.

  Rule: no production file that starts git, or builds its environment, gives process.env to a launch

    packages/sandbox/src/git-closed.ts builds the whole environment of every git of the host; the other files start a
    program with it. What each caller really gives its git, argv and environment, is held by scenarios that start a
    recording git: packages/sandbox/features/tree-fingerprint.feature, tools/test-gate/features/closed-environment.feature,
    tools/deliver/features/ports.feature and git-environment.feature; packages/sandbox/features/git-closed.feature holds
    the module and the two readers of its file.

    Scenario Outline: the committed file <file> gives no process.env to a launch
      Given the text of the committed file "<file>"
      Then the text gives process.env to no process launch

      Examples:
        | file                                               |
        | packages/sandbox/src/git-closed.ts                 |
        | packages/sandbox/src/tree-fingerprint.ts           |
        | tools/test-gate/src/infrastructure/git.ts          |
        | tools/deliver/src/infrastructure/git-repository.ts |
        | tools/deliver/src/infrastructure/host-process.ts   |
        | packages/sandbox/src/git-worktree.ts               |

    Scenario Outline: a copy of <file> that gives process.env to its launch is refused
      Given the text of the committed file "<file>"
      When the text "<closed>" is replaced by "<open>"
      Then the text gives process.env to a process launch

      Examples:
        | file                                               | closed                                   | open                                     |
        | packages/sandbox/src/git-closed.ts                 | ...own,                                  | ...process.env,                          |
        | packages/sandbox/src/tree-fingerprint.ts           | env: environment,                        | env: { ...process.env, ...environment }, |
        | tools/test-gate/src/infrastructure/git.ts          | env: machineIndependentGitEnvironment(), | env: process.env,                        |
        | tools/deliver/src/infrastructure/git-repository.ts | hostConfiguredGitEnvironment(this.host,  | Object.assign({}, process.env,           |
        | tools/deliver/src/infrastructure/host-process.ts   | env: environment,                        | env: { ...process.env, ...environment }, |
        | packages/sandbox/src/git-worktree.ts               | env: {},                                 | env: process.env,                        |

    Scenario Outline: what is not a launch given the whole environment is not refused: <text>
      Given the text of the committed file "packages/sandbox/src/tree-fingerprint.ts"
      When the text "function hash()" is replaced by "<text> function hash()"
      Then the text gives process.env to no process launch

      Examples:
        | text                             |
        | const value = process.env[name]; |
        | const home = process.env.HOME;   |

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
