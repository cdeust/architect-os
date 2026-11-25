Feature: the descriptive files of the sessions: the build and review prompts, and the verdict schema
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
      | no section on the findings of the previous review |
      | no refusal of an omitted id |
      | no reading of the checks as data |
      | no word that a green check is an indication and not a proof |
      | no ban on running a listed command again |
      | no not_checked for what nothing established |
      | no word on the sandbox of the checks |

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
      | a finding key not required |
      | a third status of a prior finding |
      | prior findings required    |
      | an open prior finding      |
