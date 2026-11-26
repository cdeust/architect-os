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

  Rule: a required aggregate can explain a producer which never started only by its first admission step

    Scenario Outline: the aggregate, its producers, and the independent required check
      Then the completed gate with producers "a, b" and jobs "linux=<aggregate>, a=<a>, b=<b>, macos=success/runner" is "<state>"

      Examples:
        | aggregate                            | a                              | b                  | state     |
        | success/runner                       | success/runner                 | success/runner     | green     |
        | failure/runner/Require all producers | cancelled/norunner             | success/runner     | no-runner |
        | failure/runner/Require all producers | cancelled/runner               | success/runner     | failed    |
        | cancelled/runner/Require all producers | cancelled/norunner           | success/runner     | failed    |
        | failure/runner/Require all producers | success/runner                 | cancelled/norunner | no-runner |
        | failure/runner/Require all producers | failure/runner/failed-step     | cancelled/norunner | failed    |
        | failure/runner/Require all producers | success/runner                 | success/runner     | failed    |
        | failure/runner/Require all producers | cancelled/norunner/failed-step | success/runner     | failed    |
        | failure/runner/Later                 | cancelled/norunner             | success/runner     | failed    |
        | failure/runner                       | cancelled/norunner             | success/runner     | failed    |
        | success/runner                       | cancelled/norunner             | success/runner     | failed    |
        | success/runner/failed-step           | success/runner                 | success/runner     | failed    |
        | success/runner                       | success/runner/failed-step     | success/runner     | failed    |
        | cancelled/norunner                   | cancelled/norunner             | success/runner     | no-runner |

    Scenario: a missing producer fails the gate
      Then the completed gate with producers "a, b" and jobs "linux=success/runner, a=success/runner, macos=success/runner" is "failed"

    Scenario: two current jobs with the same required producer name are ambiguous
      Then the completed gate with producers "a" and jobs "linux=success/runner, a=success/runner, a=failure/runner, macos=success/runner" is "failed"

    Scenario: a real failure of the independent check stops the rerun
      Then the completed gate with producers "a" and jobs "linux=failure/runner/Require all producers, a=cancelled/norunner, macos=failure/runner/failed-step" is "failed"

  Rule: the lanes a run planned are producers of its aggregate, taken from the run and never counted by the delivery

    Scenario Outline: the aggregate "linux" with the planned family lane-<n>:m and lane-<n>:r, <case>
      Then the completed gate with producers "a", the planned family "lane-" of ":m, :r" and jobs "linux=<aggregate>, a=success/runner, macos=success/runner<lanes>" is "<state>"

      Examples:
        | case                                   | aggregate                            | lanes                                                                                              | state     |
        | one lane, green                        | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner                                                 | green     |
        | three lanes, green                     | success/runner                       | , lane-2:r=success/runner, lane-1:m=success/runner, lane-3:m=success/runner, lane-1:r=success/runner, lane-2:m=success/runner, lane-3:r=success/runner | green |
        | no lane under a green aggregate        | success/runner                       |                                                                                                    | failed    |
        | no lane, the aggregate got no runner   | cancelled/norunner                   |                                                                                                    | no-runner |
        | no lane, the aggregate red on its own  | failure/runner/failed-step           |                                                                                                    | failed    |
        | a lane that failed, aggregate green    | success/runner                       | , lane-1:m=failure/runner/failed-step, lane-1:r=skipped/norunner                                   | failed    |
        | a lane cancelled, aggregate green      | success/runner                       | , lane-1:m=cancelled/norunner, lane-1:r=skipped/norunner                                           | failed    |
        | a lane that never got a runner         | failure/runner/Require all producers | , lane-1:m=cancelled/norunner, lane-1:r=skipped/norunner                                           | no-runner |
        | the second lane never got a runner     | failure/runner/Require all producers | , lane-1:m=success/runner, lane-1:r=success/runner, lane-2:m=success/runner, lane-2:r=cancelled/norunner | no-runner |
        | a lane that failed a step              | failure/runner/Require all producers | , lane-1:m=failure/runner/failed-step, lane-1:r=skipped/norunner                                   | failed    |
        | every lane green, the aggregate red    | failure/runner/Require all producers | , lane-1:m=success/runner, lane-1:r=success/runner                                                 | failed    |
        | a lane without its second job          | success/runner                       | , lane-1:m=success/runner                                                                          | failed    |
        | a lane job listed twice                | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner, lane-1:r=success/runner                        | failed    |
        | a gap in the lanes                     | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner, lane-3:m=success/runner, lane-3:r=success/runner | failed  |
        | lanes that do not start at the first   | success/runner                       | , lane-2:m=success/runner, lane-2:r=success/runner                                                 | failed    |
        | a lane with a leading zero             | success/runner                       | , lane-01:m=success/runner, lane-01:r=success/runner                                               | failed    |
        | a family job without a lane            | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner, lane-:m=success/runner                         | failed    |
        | a family job with another suffix       | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner, lane-1:x=success/runner                        | failed    |
        | a suffix that is not at the end        | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner, lane-1:m:x=success/runner                      | failed    |
        | a job outside the family               | success/runner                       | , lane-1:m=success/runner, lane-1:r=success/runner, xlane-9:m=failure/runner/failed-step           | green     |

    Scenario Outline: suffixes that overlap use the complete job names
      Then the completed gate with producers "a", the planned family "p-" of "<suffixes>" and jobs "linux=success/runner, a=success/runner, macos=success/runner, <members>" is "<state>"

      Examples:
        | suffixes | members                                      | state |
        | x, 1x    | p-1x=success/runner, p-11x=success/runner    | green |
        | 1x, x    | p-11x=success/runner, p-1x=success/runner    | green |
        | -1x, x   | p-1x=success/runner, p-1-1x=success/runner   | green |
        | x, 1x    | p-1x=success/runner, p-111x=success/runner   | failed |

    Scenario: without a planned family, jobs named like lanes are not producers
      Then the completed gate with producers "a" and jobs "linux=success/runner, a=success/runner, macos=success/runner, lane-1:m=failure/runner/failed-step" is "green"

  Rule: the plan of what to publish is whether the work branch is pushed, or a refusal; the destination is not read

    Scenario Outline: <case>
      When the publication of "h1" is planned over the work branch "<work>", the commit descending from "<ancestors>"
      Then the plan pushes the work branch: <push>
      And the plan asked the ancestry of "<asked>"

      Examples:
        | case                                                        | work   | ancestors | push | asked |
        | no work branch yet: it is pushed                            | absent | w1        | yes  |       |
        | a work branch at an ancestor: it is pushed forward          | w1     | w1        | yes  | w1    |
        | a work branch already at the hash: not pushed, still opened | h1     |           | no   |       |

    Scenario: a work branch the commit does not descend from
      When the publication of "h1" is planned over the work branch "w9", the commit descending from "w1"
      Then the plan is refused as "la branche distante n'est pas un ancêtre du commit"
      And the plan asked the ancestry of "w9"
