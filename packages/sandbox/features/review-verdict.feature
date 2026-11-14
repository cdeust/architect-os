Feature: the review verdict contract

  Scenario: the committed JSON schema is exactly the one the contract generates
    Then the committed review verdict schema is the JSON schema of the verdict contract

  Scenario: a valid verdict parses
    When I parse a valid verdict
    Then the parsed verdict is the valid verdict

  Scenario Outline: a broken verdict is refused: <defect>
    When I break a copy of the valid verdict with <defect>
    Then parsing the broken verdict fails

    Examples:
      | defect                       |
      | an unknown level             |
      | an unknown verdict           |
      | a missing verdict            |
      | a missing findings           |
      | a missing not_checked        |
      | a missing level              |
      | a missing file               |
      | a missing line               |
      | a missing quote              |
      | a missing reason             |
      | an extra key at the top      |
      | an extra key in a finding    |
      | a non-integer line           |

  Scenario Outline: blocks: <case>
    Given a verdict "<verdict>" with finding levels "<levels>"
    Then the verdict blocks is <blocks>

    Examples:
      | case                              | verdict         | levels                  | blocks |
      | accept without finding            | accept          |                         | false  |
      | accept with a proposal only       | accept          | proposal                | false  |
      | accept with a correctness         | accept          | proposal,correctness    | true   |
      | accept with a contradiction       | accept          | contradiction           | true   |
      | request_changes                   | request_changes | proposal                | true   |
