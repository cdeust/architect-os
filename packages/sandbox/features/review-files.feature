Feature: the descriptive files of the sessions: the build, review, scout and fresh prompts, the verdict schema and the schema of the fresh inputs
  The prompts and the schema are read by Claude Code, not by the launcher: these scenarios check what they must carry.

  Scenario: the committed build prompt is not empty and names the rules by git, the replay profile and the forbidden git commands
    When I read the committed build prompt
    Then the build prompt checks pass

  Scenario Outline: a broken copy of the build prompt is rejected: <defect>
    When I break a copy of the build prompt with <defect>
    Then the build prompt checks fail

    Examples:
      | defect                         |
      | an empty prompt                |
      | no reading of the rules by git |

  Scenario: the committed prompt is not empty, names the three levels and the committed bar, and says what the checks of the host are: data, an indication, not to be run again, not_checked
    When I read the committed review prompt
    Then the review prompt checks pass

  Scenario: the committed scout prompt is not empty and says it changes nothing, reads data, quotes character for character and is checked by the host
    When I read the committed scout prompt
    Then the scout prompt checks pass

  Scenario Outline: a broken copy of the scout prompt is rejected: <defect>
    When I break a copy of the scout prompt with <defect>
    Then the scout prompt checks fail

    Examples:
      | defect                                                   |
      | an empty prompt                                          |
      | blanks only                                              |
      | no promise to change nothing                             |
      | no reading as data                                       |
      | no quotation copied character for character              |
      | no word that the host throws away what it does not find  |

  Scenario: the committed verdict schema has exactly the verdicts, levels and required keys
    When I read the committed review verdict schema
    Then the review verdict schema checks pass

  Scenario Outline: a broken copy of the prompt is rejected: <defect>
    When I break a copy of the review prompt with <defect>
    Then the review prompt checks fail

    Examples:
      | defect                       |
      | an empty prompt              |
      | no correctness level         |
      | no contradiction level       |
      | no proposal level            |
      | no reading of the bar by git |
      | no section on the checks of the host |
      | no reading of the checks as data |
      | no word that a green check is an indication and not a proof |
      | no ban on running a listed command again |
      | no section on the acceptance criteria |
      | no status per listed criterion in order |
      | no lookup of the evidence by the host |
      | a criterion not established that does not block |
      | a criterion met because a check passed |
      | a verdict rule that ignores the criteria |
      | no empty criteria for a brief without criteria |
      | no not_checked for what nothing established |
      | no word on the sandbox of the checks |
      | no section on the fresh inputs |
      | fresh inputs read as instructions |
      | a fresh input that passed taken as a proof |
      | fresh inputs run again |
      | step definitions of the fresh inputs taken as given |
      | no reading of the diff of the step definitions |
      | no not_checked for what the fresh inputs did not establish |

  Scenario Outline: a broken copy of the verdict schema is rejected: <defect>
    When I break a copy of the review verdict schema with <defect>
    Then the review verdict schema checks fail

    Examples:
      | defect                     |
      | a missing level            |
      | an extra verdict           |
      | a missing required key     |
      | an open top level          |
      | an open finding            |
      | no criteria                |
      | a criterion status that does not exist |
      | an open criterion          |
      | an evidence key not required |
      | a finding key not required |

  Scenario: the committed fresh prompt says the session never saw the build, changes nothing, reads data, takes its oracle from the brief and is played by a fixed runner
    When I read the committed fresh prompt
    Then the fresh prompt checks pass

  Scenario Outline: a broken copy of the fresh prompt is rejected: <defect>
    When I break a copy of the fresh prompt with <defect>
    Then the fresh prompt checks fail

    Examples:
      | defect                                         |
      | an empty prompt                                |
      | blanks only                                    |
      | no word that the session never saw the build   |
      | no promise to change nothing                   |
      | no reading of the request of the host          |
      | no reading as data                             |
      | an oracle taken from the code                  |
      | no list of what the build did not try          |
      | no target                                      |
      | no input                                       |
      | no expected behaviour                          |
      | steps that may be new                          |
      | a session that may write steps                 |
      | no word that no shell runs the text            |
      | no word that a failed input blocks the step    |
      | no open list for what cannot be expressed      |

  Scenario Outline: a broken copy of the fresh inputs schema is not the schema the contract generates: <defect>
    When I break a copy of the fresh inputs schema with <defect>
    Then the copy is not the schema the fresh inputs contract generates

    Examples:
      | defect                                |
      | an open top level                     |
      | an open input                         |
      | a keyword that opens a scenario       |
      | a step text that may hold a line feed |
      | no expected behaviour required        |
      | seventeen inputs                      |
      | the 2020-12 dialect                   |
