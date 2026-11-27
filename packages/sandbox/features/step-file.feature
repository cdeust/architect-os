Feature: step.json, the descriptive file of a step

  Scenario: the example loads with its build and its review
    When I parse the step file example
    Then the step build session is "claude-sonnet-5-5", "medium", 2400 seconds
    And the step review 1 is "correctness", "claude-opus-5-5", "high", 900 seconds
    And the step parallel is 2

  Scenario: a step file without reviews loads, with no review
    When I parse the step file example without reviews
    Then the step has 0 review sessions

  Scenario Outline: a number of reviews up to eight is accepted: <count>
    When I parse the step file example with <count> reviews
    Then the step has <count> review sessions

    Examples:
      | count |
      | 0     |
      | 1     |
      | 8     |

  Scenario Outline: a review name is accepted: <name>
    When I parse the step file example with the review name "<name>"
    Then the step review 1 is "<name>", "claude-opus-5-5", "high", 900 seconds

    Examples:
      | name                             |
      | a                                |
      | correctness                      |
      | a-1-b                            |
      | abcdefghijklmnopqrstuvwxyzabcdef |

  Scenario Outline: a review name that would escape is refused: <name>
    When I parse the step file example with the review name "<name>" refused
    Then parsing the step file fails

    Examples:
      | name                              |
      | ../x                              |
      | a/b                               |
      | A                                 |
      |                                   |
      | abcdefghijklmnopqrstuvwxyzabcdefg |

  Scenario: a step file without scouts loads, with no scout
    When I parse the step file example without scouts
    Then the step has 0 scout sessions

  Scenario Outline: a number of scouts up to eight is accepted: <count>
    When I parse the step file example with <count> scouts
    Then the step has <count> scout sessions

    Examples:
      | count |
      | 0     |
      | 1     |
      | 8     |

  Scenario Outline: a scout name is accepted: <name>
    When I parse the step file example with the scout name "<name>"
    Then the step scout 1 is "<name>", "claude-haiku-5-5", "low", 300 seconds

    Examples:
      | name                             |
      | a                                |
      | files                            |
      | a-1-b                            |
      | abcdefghijklmnopqrstuvwxyzabcdef |

  Scenario Outline: a scout name that would escape is refused: <name>
    When I parse the step file example with the scout name "<name>" refused
    Then parsing the step file fails

    Examples:
      | name                              |
      | ../x                              |
      | a/b                               |
      | A                                 |
      |                                   |
      | abcdefghijklmnopqrstuvwxyzabcdefg |

  Scenario: a scout and a review may share a name
    When I parse the step file example with a scout and a review both named "correctness"
    Then the step scout 1 is "correctness", "claude-haiku-5-5", "low", 300 seconds
    And the step review 1 is "correctness", "claude-opus-5-5", "high", 900 seconds

  Scenario: two scouts with the same name are refused, and the refusal names it
    When I make a broken copy of the step file example with two scouts both named "twin"
    Then parsing the broken step file fails with "scouts: duplicate scout name: twin"

  Scenario: two names each used twice among the scouts are both named, once each, in the order of the file
    When I make a broken copy of the step file example with the scouts named "pair, solo, pair, twin, twin, pair"
    Then parsing the broken step file fails with "scouts: duplicate scout name: pair, twin"

  Scenario: a step file without checks loads, with no check
    When I parse the step file example without scouts
    Then the step has 0 checks

  Scenario: a check loads with its name, its argv and its limit
    When I parse the step file example with a check
    Then the step has 1 checks
    And the step check 1 is "types", "npm run types", 600 seconds

  Scenario Outline: the edge of a rule of the checks is accepted: <edge>
    When I parse a copy of the step file example holding <edge>
    Then the step has <count> checks

    Examples:
      | edge                                             | count |
      | eight checks                                     | 8     |
      | a check name of 32 characters                    | 1     |
      | a check argv of one argument                     | 1     |
      | a check argv of 32 arguments                     | 1     |
      | a check argument of one character                | 1     |
      | a check argument of 300 characters               | 1     |
      | a check argument with a space, a quote and a tab | 1     |
      | a check limit of 1                               | 1     |
      | a check limit of 7200                            | 1     |

  Scenario: a check, a scout and a review may share a name
    When I parse the step file example with a check, a scout and a review all named "correctness"
    Then the step check 1 is "correctness", "npm run types", 600 seconds
    And the step scout 1 is "correctness", "claude-haiku-5-5", "low", 300 seconds
    And the step review 1 is "correctness", "claude-opus-5-5", "high", 900 seconds

  Scenario: two checks with the same name are refused, and the refusal names it
    When I make a broken copy of the step file example with two checks both named "twin"
    Then parsing the broken step file fails with "checks: duplicate check name: twin"

  Scenario: two names each used twice among the checks are both named, once each, in the order of the file
    When I make a broken copy of the step file example with the checks named "pair, solo, pair, twin, twin, pair"
    Then parsing the broken step file fails with "checks: duplicate check name: pair, twin"

  Scenario Outline: a parallel from 1 to 8 is accepted: <parallel>
    When I parse the step file example with the parallel <parallel>
    Then the step parallel is <parallel>

    Examples:
      | parallel |
      | 1        |
      | 8        |

  Scenario: two reviews with the same name are refused, and the refusal names it
    When I make a broken copy of the step file example with two reviews both named "twin"
    Then parsing the broken step file fails with "reviews: duplicate review name: twin"

  Scenario: two names each used twice are both named, once each, in the order of the file
    When I make a broken copy of the step file example with the reviews named "pair, solo, pair, twin, twin, pair"
    Then parsing the broken step file fails with "reviews: duplicate review name: pair, twin"

  Scenario Outline: the limits of a session are accepted: <limit>
    When I parse the step file example with the build limit <limit>
    Then the step build limit is <limit> seconds

    Examples:
      | limit |
      | 1     |
      | 7200  |

  Scenario Outline: every effort of the list is accepted: <effort>
    When I parse the step file example with the build effort "<effort>"
    Then the step build effort is "<effort>"

    Examples:
      | effort |
      | low    |
      | medium |
      | high   |
      | xhigh  |
      | max    |

  Scenario Outline: a broken copy of the step file is refused: <defect>
    When I break a copy of the step file example with <defect>
    Then parsing the broken step file fails

    Examples:
      | defect                                 |
      | an unknown key at the top              |
      | an unknown key in build                |
      | an unknown key in a review             |
      | the singular review key                |
      | an effort not in the list              |
      | a limit of 0                           |
      | a limit of 7201                        |
      | a non-integer limit                    |
      | an empty model                         |
      | no build                               |
      | a review effort not in list            |
      | a review limit of 0                    |
      | a review limit of 7201                 |
      | an empty review model                  |
      | a review without a name                |
      | a review name that starts with a digit |
      | a review name with an underscore       |
      | a review name that ends with a newline |
      | a review name that is not a string     |
      | nine reviews                           |
      | reviews that is not a list             |
      | an unknown key in a scout              |
      | the singular scout key                 |
      | a scout without a name                 |
      | a scout name that starts with a digit  |
      | a scout name with an underscore        |
      | a scout name that ends with a newline  |
      | a scout name that is not a string      |
      | nine scouts                            |
      | scouts that is not a list              |
      | a scout effort not in list             |
      | a scout limit of 0                     |
      | a scout limit of 7201                  |
      | an empty scout model                   |
      | a scout without a model                |
      | a parallel of 0                        |
      | a parallel of 9                        |
      | a non-integer parallel                 |
      | a parallel that is a string            |
      | nine checks |
      | checks that is not a list |
      | the singular check key |
      | an unknown key in a check |
      | a check without a name |
      | a check name with an upper-case letter |
      | a check name of 33 characters |
      | a check name that starts with a digit |
      | a check name with an underscore |
      | a check name that ends with a newline |
      | a check without a command |
      | a check command that is a string |
      | an empty check argv |
      | a check argv of 33 arguments |
      | an empty check argument |
      | a check argument that is not a string |
      | a check argument of 301 characters |
      | a check argument with a NUL |
      | a check argument with a line feed |
      | a check argument with a carriage return |
      | a check argument that starts with a line feed |
      | a check limit of 0 |
      | a check limit of 7201 |
      | a non-integer check limit |
      | a check without a limit |

  Scenario: A Step accepts only the supported model and effort for its builder
    Then the Step file binds the provider, model and effort of a subscription build

  Scenario: a step file may carry the tickets approved by Plan, kept in order
    When I parse the step file example with two tickets
    Then the step tickets are "TICKET-002, TICKET-001" in that order

  Scenario: a step file whose tickets form a cycle is refused
    When I make a broken copy of the step file example whose tickets depend on each other
    Then parsing the step file fails

  Scenario Outline: the acceptance of a Step is a list of whole acceptance identifiers: <acceptance>
    When I make a copy of the step file example with the acceptance <acceptance>
    Then the step file copy keeps the acceptance <acceptance>

    Examples:
      | acceptance                     |
      | ["AC-1"]                       |
      | ["AC-002","AC-001"]            |
      | ["AC-123456789"]               |

  Scenario Outline: an acceptance that is not a list of whole identifiers is refused: <acceptance>
    When I make a copy of the step file example with the acceptance <acceptance>
    Then parsing the broken step file fails

    Examples:
      | acceptance           |
      | []                   |
      | ["xAC-1"]            |
      | ["AC-1x"]            |
      | ["AC-"]              |
      | ["AC-1234567890"]    |
      | "AC-1"               |

  Scenario: an acceptance that names a criterion twice is refused, and the refusal says so
    When I make a copy of the step file example with the acceptance ["AC-1","AC-2","AC-1"]
    Then parsing the broken step file fails with "acceptance: duplicate acceptance id"

  Rule: the fresh inputs of a step (docs/design/orchestration-fable-5-2.md, §4): on or off, a count, a session, a fixed runner

    Scenario: a step file with fresh inputs keeps their policy as written
      When I parse the step file example with fresh inputs
      Then the step fresh inputs are the policy of the example

    Scenario: a step file without fresh inputs has none
      When I parse the step file example
      Then the step has no fresh inputs

    Scenario Outline: a copy of the step file holding <edge> is accepted
      When I parse a copy of the step file example holding <edge>
      Then the step build session is "claude-sonnet-5-5", "medium", 2400 seconds

      Examples:
        | edge                          |
        | fresh inputs turned off       |
        | a count of 1 fresh input      |
        | a count of 16 fresh inputs    |
        | a fresh runner of one argument |
        | a fresh runner of 32 arguments |
        | a fresh runner limit of 7200  |
        | a fresh session effort of max |
        | a fresh validator             |
        | one runner file               |
        | sixteen runner files          |
        | a runner file of 300 characters |
        | a fresh validator of 32 arguments and a limit of 7200 |

    Scenario Outline: a copy of the step file with <defect> is refused
      When I break a copy of the step file example with <defect>
      Then parsing the broken step file fails

      Examples:
        | defect                                   |
        | fresh inputs that are not an object      |
        | the singular fresh input key             |
        | an unknown key in the fresh inputs       |
        | fresh inputs without enabled             |
        | an enabled that is a string              |
        | fresh inputs without a count             |
        | a count of 0 fresh inputs                |
        | a count of 17 fresh inputs               |
        | a fractional count of fresh inputs       |
        | fresh inputs without a model             |
        | an empty fresh model                     |
        | a fresh effort not in the list           |
        | a fresh session limit of 0               |
        | a fresh session limit of 7201            |
        | fresh inputs without a runner            |
        | a fresh runner that is a string          |
        | an unknown key in the fresh runner       |
        | an empty fresh runner                    |
        | a fresh runner of 33 arguments           |
        | a fresh runner argument with a line feed |
        | an empty fresh runner argument           |
        | a fresh runner without a limit           |
        | a fresh runner limit of 0                |
        | a fresh runner limit of 7201             |
        | a fresh validator that is a string       |
        | an unknown key in the fresh validator    |
        | an empty fresh validator                 |
        | a fresh validator argument with a line feed |
        | a fresh validator without a limit        |
        | a fresh validator limit of 0             |
        | fresh inputs without runner files        |
        | no runner file                           |
        | seventeen runner files                   |
        | an empty runner file                     |
        | a runner file of 301 characters          |
        | an absolute runner file                  |
        | a runner file outside the worktree       |
        | a runner file under .git                 |
        | a runner file with a line feed           |

    Scenario: an absolute runner file is refused, and the refusal says why
      When I break a copy of the step file example with an absolute runner file
      Then parsing the broken step file fails with "freshInputs.runnerFiles.0: a path the host does not read"
