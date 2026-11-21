Feature: Repository commands require admission before their payload begins
  These checks use the public scripts and direct launchers. Each child starts in an empty
  temporary working directory without a runtime root, admission receipt or provider settings.

  Scenario Outline: Every package script starts with the admission check
    Given the public scripts from "<manifest>"
    Then all public scripts run the admission guard before a payload
    And running every public script without admission stops at that guard

    Examples:
      | manifest           |
      | package.json       |
      | bench/package.json |

  Scenario Outline: A missing guard is reported against the affected script in a copy
    Given the public scripts from "<manifest>"
    When a copy of script "<script>" loses its initial admission guard
    Then only public script "<script>" is reported as unguarded

    Examples:
      | manifest           | script     |
      | package.json       | format     |
      | bench/package.json | bench:bare |

  Scenario Outline: A direct launcher refuses before running its payload
    When the unadmitted process starts repository entry "<entry>"
    Then the repository entry refuses admission with exit 2, empty stdout and the exact diagnostic

    Examples:
      | entry                                |
      | gateway/dist/src/serve.js            |
      | baseline/find-defects.ts             |
      | packages/sandbox/src/code.ts         |
      | packages/sandbox/src/review.ts       |
      | packages/sandbox/src/step.ts         |
      | tools/evidence/src/cli.ts            |
      | tools/watch/src/cli.ts               |
      | tools/deliver/src/cli.ts             |
      | tools/plan/src/cli.ts                |
      | tools/define/src/cli.ts              |
      | tools/define/src/proposal-cli.ts     |
      | tools/test-gate/src/main.ts          |
      | tools/test-gate/src/hosted.ts        |
      | features/scripts/isolation-diagram.ts |
      | baseline/run.ts                      |
      | baseline/analyze.ts                  |
      | baseline/overhead-analyze.ts         |
      | baseline/planning.mjs                |
      | bench/src/run.ts                     |
      | bench/src/bare-launch.mjs            |

  Scenario: A direct Gate refusal preserves the previous report
    Given a previous Gate report in a disposable working directory
    When the unadmitted process starts the real Gate shell script there
    Then the repository entry refuses admission with exit 2, empty stdout and the exact diagnostic
    And the previous Gate report still has its original bytes
