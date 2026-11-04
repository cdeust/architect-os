Feature: readCapped, the bounded read of a sandbox output (decision 3)
  A stream is read to its end, at most a number of bytes: beyond, it is destroyed and the read refused with
  OUTPUT_TOO_LARGE. The text is decoded once whole, so a character split between two chunks stays right.

  Scenario: a stream at the bound is read whole
    When I read capped at 5 a stream of the chunks "ab, cde"
    Then the capped read gives "abcde"

  Scenario: a stream one byte beyond the bound is refused and destroyed
    When I read capped at 5 a stream of the chunks "ab, cdef"
    Then the capped read is refused with "OUTPUT_TOO_LARGE: sortie au-delà de 5 octets"
    And the capped stream is destroyed

  Scenario: a character split between two chunks is decoded whole
    When I read capped at 10 a stream whose two chunks split the character "é"
    Then the capped read gives "é"

  Scenario: an error of the stream refuses the read
    When I read capped at 10 a stream that fails with "EPIPE"
    Then the capped read is refused with "EPIPE"
