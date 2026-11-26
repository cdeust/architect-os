Feature: Test gate configuration and command line
  tools/test-gate/gate.json describes which files are production, features and step definitions, the components
  and the jobs: it is a descriptive file, loaded against its zod schema; a broken copy is rejected. The command
  line is `plan|check [--job <name>]`; anything else is refused with exit code 1.

  Scenario: collecting and replaying a shard accept distinct arguments
    Then the replay commands keep their explicit argument contracts

  Scenario: a valid native report exposes its parsed source, positions and static status
    Then a valid native mutation report has a parsed source, position and active static flag

  Scenario: the committed configuration and the fixture configuration load against the schema
    Then the committed gate configuration loads against its schema
    And the fixture gate configuration loads against its schema
    And the committed gate job "linux" counts "**/*.feature" with mutation "on"
    And the committed gate job "macos" counts "features/sandbox/**/*.feature" with mutation "off"
    And the committed gate configuration declares the rule 7 controls:
      """
      {
        "canary": {
          "file": "tools/test-gate/canary/canary.ts",
          "functions": { "sum": "Killed", "greet": "Killed", "twice": "Survived", "thrice": "NoCoverage" }
        },
        "replay": {
          "profile": "replay",
          "record": "reports/mutation/replay.json",
          "work": "reports/replay",
          "limitMs": 600000
        }
      }
      """

  Scenario: a job may count several feature globs
    Then a copy of the committed gate configuration with "jobs.macos.features" set to '["features/sandbox/**/*.feature", "features/macos/**/*.feature"]' loads

  Scenario: a destination may be any remote-tracking reference, a branch with a slash included
    Then a copy of the committed gate configuration with "destination" set to '"refs/remotes/upstream/feat/gate-1a"' loads

  Scenario: rule 7 is optional in a configuration
    Then a copy of the committed gate configuration with "canary" set to 'absent' loads
    And a copy of the committed gate configuration with "replay" set to 'absent' loads

  Scenario Outline: a broken copy of the committed configuration is rejected: <path> = <value>
    Then a copy of the committed gate configuration with "<path>" set to '<value>' is rejected with:
      """
      <message>
      """

    Examples:
      | path                  | value       | message                                                                    |
      | production            | absent      | hors schéma : ✖ Invalid input: expected object, received undefined   → at production |
      | production.include    | []          | hors schéma : ✖ Too small: expected array to have >=1 items   → at production.include |
      | features.exclude      | absent      | hors schéma : ✖ Invalid input: expected array, received undefined   → at features.exclude |
      | jobs.linux.mutation   | "yes"       | hors schéma : ✖ Invalid input: expected boolean, received string   → at jobs.linux.mutation |
      | jobs.linux.features   | [""]        | hors schéma : ✖ Too small: expected string to have >=1 characters   → at jobs.linux.features[0] |
      | jobs.linux.tags       | "@fast"     | hors schéma : ✖ Unrecognized key: "tags"   → at jobs.linux |
      | reports.plan          | ""          | hors schéma : ✖ Too small: expected string to have >=1 characters   → at reports.plan |
      | reports.report          | "gate-report.md"          | hors schéma : ✖ Invalid string: must start with "reports/"   → at reports.report |
      | name                  | "smoke"     | hors schéma : ✖ Unrecognized key: "name" |
      | canary.file           | ""          | hors schéma : ✖ Too small: expected string to have >=1 characters   → at canary.file |
      | canary.functions.sum  | "Timeout"   | hors schéma : ✖ Invalid option: expected one of "Killed"\|"Survived"\|"NoCoverage"   → at canary.functions.sum |
      | canary.functions      | {"": "Killed"} | hors schéma : ✖ Invalid key in record   → at canary.functions. |
      | canary.extra          | 1           | hors schéma : ✖ Unrecognized key: "extra"   → at canary |
      | replay.profile        | ""          | hors schéma : ✖ Too small: expected string to have >=1 characters   → at replay.profile |
      | replay.record         | ""          | hors schéma : ✖ Too small: expected string to have >=1 characters   → at replay.record |
      | replay.work           | ""          | hors schéma : ✖ Too small: expected string to have >=1 characters   → at replay.work |
      | replay.limitMs        | 0           | hors schéma : ✖ Too small: expected number to be >0   → at replay.limitMs |
      | replay.limitMs        | 1.5         | hors schéma : ✖ Invalid input: expected int, received number   → at replay.limitMs |
      | replay.extra          | 1           | hors schéma : ✖ Unrecognized key: "extra"   → at replay |
      | destination           | absent      | hors schéma : ✖ Invalid input: expected string, received undefined   → at destination |
      | destination           | "refs/heads/main" | hors schéma : ✖ Invalid string: must match pattern /^refs\\/remotes\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]+$/   → at destination |
      | destination           | "xrefs/remotes/origin/main" | hors schéma : ✖ Invalid string: must match pattern /^refs\\/remotes\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]+$/   → at destination |
      | destination           | "refs/remotes/origin/main " | hors schéma : ✖ Invalid string: must match pattern /^refs\\/remotes\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]+$/   → at destination |
      | destination           | "refs/remotes//main" | hors schéma : ✖ Invalid string: must match pattern /^refs\\/remotes\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._/-]+$/   → at destination |
      | destination           | "refs/remotes/origin/a..b" | hors schéma : ✖ a reference name   → at destination |
      | destination           | "refs/remotes/origin/main/" | hors schéma : ✖ a reference name   → at destination |
      | destination           | "refs/remotes/origin/main.lock" | hors schéma : ✖ a reference name   → at destination |

  Scenario: a configuration that is not JSON is refused by the command line
    Given a gate repository
    And the gate head is committed
    And the gate configuration reads:
      """
      { jobs
      """
    When the gate checks the "linux" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : tools/test-gate/gate.json : JSON invalide : Expected property name or '}' in JSON at position 2 (line 1 column 3)
      """

  Scenario: an absent configuration is refused
    Given a gate repository
    And the gate head is committed
    And the gate configuration is absent
    When the gate checks the "linux" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : tools/test-gate/gate.json absent
      """

  Scenario: a job the configuration does not declare is refused
    Given a gate repository
    And the gate head is committed
    When the gate plans the "windows" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : job inconnu : windows
      """

  Scenario Outline: arguments other than plan|check [--job <name>] are refused: "<arguments>"
    Given a gate repository
    And the gate head is committed
    When the gate runs with the arguments "<arguments>"
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : usage : test-gate plan|check|inventory|inventory-check|inventory-project|inventory-collect [--job <nom>] (inventory|inventory-project --shard <1|2>) | debt [realign|compare] | replay [--all | --shard <1|2>] | replay-collect
      """

    Examples:
      | arguments                |
      |                          |
      | run                      |
      | check --jobs linux       |
      | check --job              |
      | plan --job linux extra   |
      | replay --some            |
      | replay --all extra       |
      | replay --all 1           |
      | replay --shard           |
      | replay --shard 3         |
      | replay --shard 1 extra   |
      | replay --other 1         |
      | inventory --other 1      |
      | inventory --shard       |
      | inventory --shard 3     |
      | inventory --shard 1 extra |
      | inventory-check --shard 1 |

  Scenario: reports belong to the admitted run while source files belong to the checkout
    Given a gate repository
    Then Gate file operations preserve the checkout report decoy in an admitted run
