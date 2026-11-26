Feature: Host the pinned planning server over MCP stdio

  Scenario Outline: Forward only the selected routes and planning locations
    Then the pinned planning server sees the intended request "<panel>"

    Examples:
      | panel         |
      | with panel    |
      | without panel |

  Scenario Outline: A tool response must be a single successful text part
    Then the planning transport refuses the "<reply>" response

    Examples:
      | reply    |
      | error    |
      | multiple |
      | empty    |
      | image    |

  Scenario Outline: Only the pinned producer can start
    Then the planning transport refuses a "<bundle>" bundle before running it

    Examples:
      | bundle     |
      | substituted  |
      | linked       |
      | reconfigured |

  Scenario: A pinned planning bundle that starts and exits is a transport failure
    Then the planning transport starts a pinned bundle that exits and reports no tool answer

  Scenario: A private admitted session journals its native dispatch and releases its lease
    Given a bound run for the runtime entry check
    Then native planning validates admission, routes the subscription turn and releases the session
