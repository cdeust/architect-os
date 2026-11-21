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
      | missing 0       | refuse  |
      | missing 1       | refuse  |
      | missing 2       | refuse  |
      | missing 3       | refuse  |
      | extra           | refuse  |
      | refusal         | refuse  |
      | transport       | refuse  |
      | define digest   | refuse  |
      | proposal digest | refuse  |

  Scenario: Require exact SHA-256 values
    Then the projection rejects noncanonical hash text

  Scenario: Read only strict UTF-8 bytes
    Then the projection rejects malformed or prefixed Define bytes even with a matching binding
