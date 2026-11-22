Feature: The independently reviewed Plan wire contract

  Scenario: Preserve the signed proposal and citations in a clear review
    Then the reviewed Plan reply preserves its exact bytes as field values

  Scenario Outline: The signed fields, reviews and citations have independent constraints
    Then a reviewed Plan with "<change>" is rejected

    Examples:
      | change                       |
      | same Plan provider           |
      | same Plan model              |
      | same Define provider         |
      | same Define model            |
      | different Define digest      |
      | different verdict digest     |
      | prefixed digest              |
      | suffixed digest              |
      | prefixed model               |
      | suffixed model               |
      | blank objective              |
      | blank citation               |
      | absent citation source       |
      | empty criteria               |
      | nonempty verdict findings    |
