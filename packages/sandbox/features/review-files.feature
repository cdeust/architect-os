Feature: the descriptive files of the review session: its prompt and its verdict schema
  The prompt and the schema are read by Claude Code, not by the launcher: these scenarios check what they must carry.

  Scenario: the committed prompt is not empty and names the three levels and the committed bar
    When I read the committed review prompt
    Then the review prompt checks pass

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
