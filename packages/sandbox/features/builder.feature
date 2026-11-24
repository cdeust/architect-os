Feature: The Step builder

  Scenario Outline: A builder reports the native outcome and bounds its event sink
    Given the "<adapter>" builder receives a "<session>" native session
    Then the Builder port returns the native outcome and usage
    And the Builder port refuses a stream one byte over its limit

    Examples:
      | adapter | session   |
      | Claude  | completed |
      | memory  | completed |
      | Claude  | stopped   |
      | memory  | stopped   |
