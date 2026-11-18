Feature: no production file that starts git gives process.env to a launch (docs/design/orchestration-fable-5-2.md §14)
  This file holds a literal check: it reads the text of the three production files that start git (the fingerprint of
  the tree, the reading of the gate, the host process of the delivery) and refuses one that gives process.env, whole or
  spread, to a process launch. The scenarios on the suite itself are in features/descriptive/closed-git-environment.feature.

  It is under features/arch because the mutation profile plays on a copy of the tree where the production files are
  instrumented: a scenario that reads their text cannot be in that profile, and features/arch is left out of it
  (cucumber.mjs, stryker.config.mjs).

  Rule: no production file that starts git gives process.env to a launch

    Scenario Outline: the committed file <file> gives no process.env to a launch
      Given the text of the committed file "<file>"
      Then the text gives process.env to no process launch

      Examples:
        | file                                       |
        | packages/sandbox/src/tree-fingerprint.ts   |
        | tools/test-gate/src/infrastructure/git.ts  |
        | tools/deliver/src/infrastructure/host-process.ts |

    Scenario Outline: a copy of <file> that gives process.env to its launch is refused
      Given the text of the committed file "<file>"
      When the text "<closed>" is replaced by "<open>"
      Then the text gives process.env to a process launch

      Examples:
        | file                                       | closed                    | open                                  |
        | packages/sandbox/src/tree-fingerprint.ts   | { ...host, GIT_INDEX_FILE | { ...process.env, GIT_INDEX_FILE      |
        | tools/test-gate/src/infrastructure/git.ts  | env: closedEnvironment(), | env: process.env,                     |
        | tools/deliver/src/infrastructure/host-process.ts | env: environment, | env: { ...process.env, ...environment }, |

    Scenario Outline: what is not a launch given the whole environment is not refused: <text>
      Given the text of the committed file "packages/sandbox/src/tree-fingerprint.ts"
      When the text "const names" is replaced by "<text> const names"
      Then the text gives process.env to no process launch

      Examples:
        | text                            |
        | const value = process.env[name]; |
        | const home = process.env.HOME;   |

  Rule: the list of names written in the fingerprint and the one written in the gate are the same

    The two components share no code, so each writes the list of the variables of the host that git needs; the text of the
    two files must give the same names, in the same order.

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
