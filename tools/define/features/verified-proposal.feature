Feature: Consume the producer's verified Plan projection
  Scenario Outline: Bind the exact Define and proposal to their checkpoint
    Then the verified proposal with "<change>" yields "<outcome>"

    Examples:
      | change          | outcome |
      | none            | accept  |
      | run             | refuse  |
      | handoff run     | refuse  |
      | step            | refuse  |
      | define bytes    | refuse  |
      | proposal bytes  | refuse  |
      | binding digest  | refuse  |
      | unknown field   | refuse  |
