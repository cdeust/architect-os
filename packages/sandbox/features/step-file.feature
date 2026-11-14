Feature: step.json, the descriptive file of a step

  Scenario: the example loads with its build and review sessions
    When I parse the step file example
    Then the step build session is "claude-sonnet-5-5", "medium", 2400 seconds
    And the step review session is "claude-opus-5-5", "high", 900 seconds

  Scenario: a step file without review loads
    When I parse the step file example without review
    Then the step has no review session

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
      | defect                       |
      | an unknown key at the top    |
      | an unknown key in build      |
      | an unknown key in review     |
      | an effort not in the list    |
      | a limit of 0                 |
      | a limit of 7201              |
      | a non-integer limit          |
      | an empty model               |
      | no build                     |
      | a review effort not in list  |
