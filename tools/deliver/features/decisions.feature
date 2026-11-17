Feature: The decisions of the delivery command (pure: the trial branch, the state of the CI, the plan of what to publish)

  Rule: the trial branch is the prefix and a name of 1 to 31 characters, or a refusal

    Scenario: a name of one character
      Then the trial branch for the name "a" is "sentinel/gate-1a-a"

    Scenario: a name of 31 characters
      Then the trial branch for the name "abcdefghijklmnopqrstuvwxyzabcde" is "sentinel/gate-1a-abcdefghijklmnopqrstuvwxyzabcde"

    Scenario: a name with digits and dashes after its first letter
      Then the trial branch for the name "step-2-b" is "sentinel/gate-1a-step-2-b"

    Scenario: an empty name
      Then the trial branch for the name "" is refused

    Scenario: a name of 32 characters
      Then the trial branch for the name "abcdefghijklmnopqrstuvwxyzabcdef" is refused

    Scenario: a name with an upper-case letter
      Then the trial branch for the name "stEp" is refused

    Scenario: a name that begins with a digit
      Then the trial branch for the name "1step" is refused

    Scenario: a name that begins with a dash
      Then the trial branch for the name "-step" is refused

    Scenario: a name with a slash
      Then the trial branch for the name "a/b" is refused

    Scenario: a name with a dot
      Then the trial branch for the name "a.b" is refused

    Scenario: a name with a space
      Then the trial branch for the name "a b" is refused

    Scenario: a name that is an option
      Then the trial branch for the name "--force" is refused

    Scenario: a name that ends with a line break
      Then the trial branch for the name "step\n" is refused

  Rule: the state of the CI is decided in order: missing, waiting, green, no-runner, failed

    Scenario Outline: the state of a run
      Then the CI state of the "<run>" run with the jobs "<jobs>" is "<state>"

      Examples:
        | run       | jobs                                                                                    | state     |
        | none      |                                                                                         | missing   |
        | none      | gate-linux=success/runner, gate-macos=success/runner                                    | missing   |
        | waiting   | gate-linux=null/norunner, gate-macos=null/norunner                                      | waiting   |
        | waiting   | gate-linux=success/runner, gate-macos=success/runner                                    | waiting   |
        | completed | gate-linux=success/runner, gate-macos=success/runner                                    | green     |
        | completed | gate-macos=success/runner, gate-linux=success/runner                                    | green     |
        | completed | gate-linux=success/runner, gate-macos=failure/runner/failed-step                        | failed    |
        | completed | gate-linux=success/runner                                                               | failed    |
        | completed |                                                                                         | failed    |
        | completed | gate-linux=success/runner, gate-macos=cancelled/norunner                                | no-runner |
        | completed | gate-linux=cancelled/norunner, gate-macos=cancelled/norunner                            | no-runner |
        | completed | gate-linux=success/runner, gate-macos=cancelled/runner                                  | failed    |
        | completed | gate-linux=cancelled/runner, gate-macos=cancelled/norunner                              | failed    |
        | completed | gate-linux=failure/runner/failed-step, gate-macos=cancelled/norunner                    | failed    |
        | completed | gate-linux=success/runner/failed-step, gate-macos=cancelled/norunner                    | failed    |
        | completed | gate-linux=cancelled/norunner/failed-step, gate-macos=cancelled/norunner                | failed    |
        | completed | gate-linux=success/runner, gate-macos=success/runner, lint=failure/runner/failed-step   | green     |
        | completed | gate-linux=success/runner, gate-macos=cancelled/norunner, lint=failure/runner/failed-step | no-runner |
        | completed | gate-linux=success/runner, gate-macos=cancelled/norunner, other=cancelled/runner        | no-runner |
        | completed | gate-linux=success/runner, gate-macos=skipped/norunner                                  | no-runner |
        | completed | gate-linux=success/runner, gate-macos=skipped/runner                                    | failed    |
        | completed | gate-linux=success/runner, gate-macos=null/norunner                                     | no-runner |
        | completed | gate-linux=success/runner, gate-macos=null/runner                                       | failed    |
        | completed | gate-linux=success/runner, gate-macos=other/norunner                                    | no-runner |
        | completed | gate-linux=success/runner, gate-macos=failure/norunner                                  | no-runner |
        | completed | gate-linux=cancelled/norunner, gate-macos=success/runner, gate-extra=success/runner     | no-runner |
        | completed | gate-linux=cancelled/norunner                                                           | failed    |

    Scenario Outline: only the required jobs count, whatever the jobs listed before them
      Then the CI state of the "completed" run with the jobs "<jobs>" and the required jobs "<required>" is "<state>"

      Examples:
        | jobs                                                  | required   | state  |
        | lint=failure/runner/failed-step, gate-linux=success/runner | gate-linux | green  |
        | lint=success/runner, gate-linux=failure/runner/failed-step | gate-linux | failed |

  Rule: the plan of what to publish is the parent and the branches left, or a refusal

    Scenario: every branch is at the parent
      When the publication of "h1" is planned over the remotes "feat/gate-1a=p0, main=p0"
      Then the plan is the parent "p0" and the branches "feat/gate-1a, main"

    Scenario: the first branch is already at the hash
      When the publication of "h1" is planned over the remotes "feat/gate-1a=h1, main=p0"
      Then the plan is the parent "p0" and the branches "main"

    Scenario: the last branch is already at the hash
      When the publication of "h1" is planned over the remotes "feat/gate-1a=p0, main=h1"
      Then the plan is the parent "p0" and the branches "feat/gate-1a"

    Scenario: every branch is at the hash
      When the publication of "h1" is planned over the remotes "feat/gate-1a=h1, main=h1"
      Then the plan is refused as "rien à livrer"

    Scenario: the branches are at two different parents
      When the publication of "h1" is planned over the remotes "feat/gate-1a=p0, main=p1"
      Then the plan is refused as "les branches distantes diffèrent"

    Scenario: one branch is at the hash and the other two at two different parents
      When the publication of "h1" is planned over the remotes "a=h1, b=p0, c=p1"
      Then the plan is refused as "les branches distantes diffèrent"

    Scenario: one branch
      When the publication of "h1" is planned over the remotes "main=p0"
      Then the plan is the parent "p0" and the branches "main"

    Scenario: one branch, already at the hash
      When the publication of "h1" is planned over the remotes "main=h1"
      Then the plan is refused as "rien à livrer"
