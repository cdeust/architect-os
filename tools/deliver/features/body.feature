Feature: The title and the body of the pull request a delivery opens (pure, from the record of the step alone)
  The body is rendered from the typed fields of steps/<name>/record.json of the delivered commit: the outcome of the
  step, the verdict and the findings of every review and the status of each acceptance criterion it gave, the checks,
  the SHA-256 of the inputs and of the files of the launcher, and the tree the step saw (docs/design/exigences-spec.md,
  §4). Every value of the record is in a code span and made inert: GitHub mentions no account, links no issue and closes
  none from it. The commit is "1111111111111111111111111111111111111111" in every scenario.

  Rule: the body says what the record says, and nothing else

    Scenario: a step that passed, with one check and one review that accepted its criterion
      Given the record of a step that passed, with one check and one review that accepted its criterion
      When the body of its pull request is rendered for the step "step" of "cdeust/architect-os"
      Then the body of the pull request is:
        """
        Delivery of the step `step` at the commit `1111111111111111111111111111111111111111`. Outcome of the step: `passed`.

        Rendered by the host from [`steps/step/record.json`](https://github.com/cdeust/architect-os/blob/1111111111111111111111111111111111111111/steps/step/record.json) of this commit alone: no text a session wrote is in it.

        ### Declared departures

        No departure is declared.

        ### Reviews

        | Review | Verdict | Findings |
        | --- | --- | --- |
        | `correctness` | `accept` | 0 |

        #### Acceptance criteria of `correctness`

        | Criterion | Status |
        | --- | --- |
        | `AC-1` | `met` |

        ### Checks

        | Check | Passed | Stopped | Seconds |
        | --- | --- | --- | --- |
        | `types-deliver` | `true` | `false` | 3 |

        ### Inputs

        | File | SHA-256 |
        | --- | --- |
        | `brief.md` | `1111111111111111111111111111111111111111111111111111111111111111` |
        | `step.json` | `2222222222222222222222222222222222222222222222222222222222222222` |

        ### Launcher

        | File | SHA-256 |
        | --- | --- |
        | `prompts/build.md` | `3333333333333333333333333333333333333333333333333333333333333333` |

        ### Tree the step saw

        | Commit | Tree | Clean |
        | --- | --- | --- |
        | `cccccccccccccccccccccccccccccccccccccccc` | `dddddddddddddddddddddddddddddddddddddddd` | `true` |
        """

    Scenario: a step refused by one of its two reviews: each verdict, each finding count, each criterion and its status
      Given the record of a step refused by one of its two reviews, with two checks
      When the body of its pull request is rendered for the step "step" of "cdeust/architect-os"
      Then the body of the pull request is:
        """
        Delivery of the step `step` at the commit `1111111111111111111111111111111111111111`. Outcome of the step: `refused`.

        Rendered by the host from [`steps/step/record.json`](https://github.com/cdeust/architect-os/blob/1111111111111111111111111111111111111111/steps/step/record.json) of this commit alone: no text a session wrote is in it.

        ### Declared departures

        No departure is declared.

        ### Reviews

        | Review | Verdict | Findings |
        | --- | --- | --- |
        | `correctness` | `request_changes` | 2 |
        | `security` | `accept` | 0 |

        #### Acceptance criteria of `correctness`

        | Criterion | Status |
        | --- | --- |
        | `AC-1` | `unmet` |
        | `AC-2` | `not_established` |

        ### Checks

        | Check | Passed | Stopped | Seconds |
        | --- | --- | --- | --- |
        | `types-deliver` | `true` | `false` | 3 |
        | `format` | `false` | `true` | 12 |

        ### Inputs

        | File | SHA-256 |
        | --- | --- |
        | `brief.md` | `1111111111111111111111111111111111111111111111111111111111111111` |
        | `step.json` | `2222222222222222222222222222222222222222222222222222222222222222` |

        ### Launcher

        | File | SHA-256 |
        | --- | --- |
        | `prompts/build.md` | `3333333333333333333333333333333333333333333333333333333333333333` |

        ### Tree the step saw

        | Commit | Tree | Clean |
        | --- | --- | --- |
        | `cccccccccccccccccccccccccccccccccccccccc` | `dddddddddddddddddddddddddddddddddddddddd` | `true` |
        """

    Scenario: a step with no review, no check, no input and no file of the launcher says so
      Given the record of a step with no review, no check, no input and no file of the launcher
      When the body of its pull request is rendered for the step "step" of "cdeust/architect-os"
      Then the body of the pull request is:
        """
        Delivery of the step `step` at the commit `1111111111111111111111111111111111111111`. Outcome of the step: `passed`.

        Rendered by the host from [`steps/step/record.json`](https://github.com/cdeust/architect-os/blob/1111111111111111111111111111111111111111/steps/step/record.json) of this commit alone: no text a session wrote is in it.

        ### Declared departures

        No departure is declared.

        ### Reviews

        No review is recorded.

        ### Checks

        No check is recorded.

        ### Inputs

        None.

        ### Launcher

        None.

        ### Tree the step saw

        | Commit | Tree | Clean |
        | --- | --- | --- |
        | `cccccccccccccccccccccccccccccccccccccccc` | `dddddddddddddddddddddddddddddddddddddddd` | `true` |
        """

  Rule: nothing of the record mentions an account, names an issue, closes one, or leaves its cell

    Scenario Outline: a record whose every value is "<value>"
      Given the record of a step whose every value is "<value>"
      When the body of its pull request is rendered for the step "<value>" of "cdeust/architect-os"
      Then the body of the pull request mentions no one, names no issue and closes none
      And every row of the tables of the body has as many cells as its header

      Examples:
        | value                                              |
        | @cdeust                                            |
        | closes #12                                         |
        | Fixes https://github.com/cdeust/architect-os/issues/1 |
        | resolved cdeust/architect-os#4                     |
        | a`b`c                                              |
        | a\|b                                               |
        | a{lf}closes #1                                     |
        | CLOSED: @team #1                                   |
        | c{zw}loses #1                                      |
        | {rlo}@x #1                                         |

    Scenario Outline: "<value>" made inert
      Then "<value>" made inert is "<inert>"

      Examples:
        | value                    | inert                            |
        | @cdeust                  | @{zw}cdeust                      |
        | closes #12               | c{zw}loses #{zw}12               |
        | Fixes https://x/issues/1 | F{zw}ixes https:{zw}//x/issues/1 |
        | a`b                      | a'b                              |
        | a\|b                     | a¦b                              |
        | a{lf}b                   | a b                              |
        | RESOLVED o/r#4           | R{zw}ESOLVED o/r#{zw}4           |
        | fixed: closed            | f{zw}ixed:{zw} c{zw}losed        |
        | Close                    | C{zw}lose                        |
        | fix-it                   | f{zw}ix-it                       |
        | prefixes                 | prefixes                         |
        | unfixed                  | unfixed                          |
        | step                     | step                             |
        | a{rlo}b                  | a{fffd}b                         |
        | clo{zw}ses #1            | clo{fffd}ses #{zw}1              |
        | x{wj}y{bom}z             | x{fffd}y{fffd}z                  |

    Scenario Outline: the address of the record keeps each value in its segment: <case>
      Given the record of a step that passed, with one check and one review that accepted its criterion
      When the body of its pull request is rendered for the step "<name>" of "<repository>"
      Then the address of the record in the body is "<address>"

      Examples:
        | case                      | name   | repository     | address                                                                                           |
        | a plain name              | step   | owner/name     | https://github.com/owner/name/blob/1111111111111111111111111111111111111111/steps/step/record.json |
        | a parenthesis and a quote | a)b'c  | owner/name     | https://github.com/owner/name/blob/1111111111111111111111111111111111111111/steps/a%29b%27c/record.json |
        | a star and a bang         | a*b!c( | owner/name     | https://github.com/owner/name/blob/1111111111111111111111111111111111111111/steps/a%2Ab%21c%28/record.json |
        | a slash, an @ and a #     | a/@b#c | owner/name     | https://github.com/owner/name/blob/1111111111111111111111111111111111111111/steps/a%2F%40b%23c/record.json |

  Rule: the title is the template of the descriptive file with the name, made inert

    Scenario Outline: the template "<template>" for the name "<name>"
      Then the title of the template "<template>" for the name "<name>" is "<title>"

      Examples:
        | template                 | name | title                       |
        | Deliver the step ${name} | step | Deliver the step step       |
        | ${name}                  | step | step                        |
        | ${name}: closes          | step | step:{zw} c{zw}loses        |
        | Deliver ${name}          | @x#1 | Deliver @{zw}x#{zw}1        |
        | ${name} and ${name}      | step | step and ${name}            |

  Rule: the departures the build declared, and the status each review gave them

    Scenario: two departures given to two reviews, one refuted
      Given the record of a step whose build declared the departures "D-1, D-2", judged by "correctness" as "verified, refuted" and by "security" as "verified, not_checked"
      When the body of its pull request is rendered for the step "step" of "cdeust/architect-os"
      Then the body of the pull request holds:
        """
        ### Declared departures

        | Departure | SHA-256 of its line |
        | --- | --- |
        | `D-1` | `4444444444444444444444444444444444444444444444444444444444444444` |
        | `D-2` | `5555555555555555555555555555555555555555555555555555555555555555` |

        ### Reviews

        | Review | Verdict | Findings |
        | --- | --- | --- |
        | `correctness` | `accept` | 0 |
        | `security` | `accept` | 0 |

        #### Acceptance criteria of `correctness`

        | Criterion | Status |
        | --- | --- |
        | `AC-1` | `met` |

        #### Declared departures judged by `correctness`

        | Departure | Status |
        | --- | --- |
        | `D-1` | `verified` |
        | `D-2` | `refuted` |

        #### Declared departures judged by `security`

        | Departure | Status |
        | --- | --- |
        | `D-1` | `verified` |
        | `D-2` | `not_checked` |
        """

    Scenario: departures the host refused as a block
      Given the record of a step whose declared departures the host refused
      When the body of its pull request is rendered for the step "step" of "cdeust/architect-os"
      Then the body of the pull request holds:
        """
        ### Declared departures

        The declared departures were refused by the host: none was given to the reviews.
        """

    Scenario: a block of departures that gives none
      Given the record of a step whose build declared the departures "", judged by "correctness" as ""
      When the body of its pull request is rendered for the step "step" of "cdeust/architect-os"
      Then the body of the pull request holds:
        """
        ### Declared departures

        No departure is declared.
        """

  Rule: the forge takes a body of at most 65 536 characters

    Scenario Outline: a body of <length> characters <fits>
      Then a body of <length> characters fits the forge: <fits>

      Examples:
        | length | fits |
        | 0      | yes  |
        | 65536  | yes  |
        | 65537  | no   |
