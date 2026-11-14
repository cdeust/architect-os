Feature: The contract of the evidence answer

  Scenario: the answer of the design note is accepted
    Given a valid evidence answer
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario: a key the contract does not know is refused
    Given a valid evidence answer
    And the evidence answer field "extra" is set to "1"
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $ Unrecognized key: "extra"
      """

  Scenario: a claim without source is refused
    Given a valid evidence answer
    And the evidence answer field "claims.0.sources" is set to "[]"
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources Too small: expected array to have >=1 items
      """

  Scenario: an answer with neither claim nor not_found is refused
    Given a valid evidence answer
    And the evidence answer field "claims" is set to "[]"
    And the evidence answer field "not_found" is set to "[]"
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $ claims and not_found are both empty
      """

  Scenario: an answer with not_found alone is accepted
    Given a valid evidence answer
    And the evidence answer field "claims" is set to "[]"
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario: an answer with claims alone is accepted
    Given a valid evidence answer
    And the evidence answer field "not_found" is set to "[]"
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario: a quote of 39 characters is refused
    Given a valid evidence answer
    And the evidence answer quote has 39 characters
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.quote Too small: expected string to have >=40 characters
      """

  Scenario: a quote of 601 characters is refused
    Given a valid evidence answer
    And the evidence answer quote has 601 characters
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.quote Too big: expected string to have <=600 characters
      """

  Scenario Outline: a quote of <length> characters is accepted
    Given a valid evidence answer
    And the evidence answer quote has <length> characters
    When the evidence answer is parsed
    Then the evidence answer is accepted

    Examples:
      | length |
      | 40     |
      | 600    |

  Scenario: a DOI that is not a DOI is refused
    Given a valid evidence answer
    And the evidence answer field "claims.0.sources.0.doi" is set to "\"11.1145/abc\""
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.doi Invalid string: must match pattern /^10\.\d{4,9}\/\S+$/
      """

  Scenario: a DOI of 201 characters is refused
    Given a valid evidence answer
    And the evidence answer DOI has 201 characters
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.doi Too big: expected string to have <=200 characters
      """

  Scenario: a DOI of 200 characters is accepted
    Given a valid evidence answer
    And the evidence answer DOI has 200 characters
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario Outline: a DOI of the form <doi> is accepted
    Given a valid evidence answer
    And the evidence answer field "claims.0.sources.0.doi" is set to "\"<doi>\""
    When the evidence answer is parsed
    Then the evidence answer is accepted

    Examples:
      | doi                           |
      | 10.1016/S0140-6736(97)11096-0 |
      | 10.48550/arXiv.1706.03762     |
      | 10.123456789/x                |

  Scenario Outline: the DOI <doi> is refused
    Given a valid evidence answer
    And the evidence answer field "claims.0.sources.0.doi" is set to "\"<doi>\""
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.doi Invalid string: must match pattern /^10\.\d{4,9}\/\S+$/
      """

    Examples:
      | doi          |
      | 10.123/x     |
      | 10.1234567890/x |
      | 10.1234/     |
      | 10.1234/a b  |
      | x10.1234/ab  |

  Scenario Outline: the text name <text> is accepted
    Given a valid evidence answer
    And the evidence answer field "claims.0.sources.0.text" is set to "\"<text>\""
    When the evidence answer is parsed
    Then the evidence answer is accepted

    Examples:
      | text         |
      | a.txt        |
      | Z9.txt       |
      | a_b.txt      |
      | a.b.txt      |
      | a-b.txt      |
      | ..txt        |
      | .txt.txt     |

  Scenario Outline: the text name <text> is refused
    Given a valid evidence answer
    And the evidence answer field "claims.0.sources.0.text" is set to "\"<text>\""
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.text Invalid string: must match pattern /^[A-Za-z0-9._-]{1,120}\.txt$/
      """

    Examples:
      | text             |
      | .txt             |
      | a/b.txt          |
      | sources/a.txt    |
      | a b.txt          |
      | a.txt.bak        |
      | a.TXT            |
      | axtxt            |
      | !a.txt           |
      | a!.txt           |
      | é.txt            |

  Scenario: a text name of 120 characters before .txt is accepted
    Given a valid evidence answer
    And the evidence answer text name has 120 characters before ".txt"
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario: a text name of 121 characters before .txt is refused
    Given a valid evidence answer
    And the evidence answer text name has 121 characters before ".txt"
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.sources.0.text Invalid string: must match pattern /^[A-Za-z0-9._-]{1,120}\.txt$/
      """

  Scenario: an answer that is not JSON is refused
    Given the evidence answer text is "this is not json"
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $ is not JSON
      """

  Scenario Outline: the identifier <id> is accepted
    Given a valid evidence answer
    And the evidence answer field "id" is set to "\"<id>\""
    When the evidence answer is parsed
    Then the evidence answer is accepted

    Examples:
      | id       |
      | a        |
      | 0        |
      | 9z       |
      | a-b-9    |
      | quantum1 |

  Scenario Outline: the identifier <id> is refused
    Given a valid evidence answer
    And the evidence answer field "id" is set to "\"<id>\""
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.id Invalid string: must match pattern /^[a-z0-9][a-z0-9-]{0,62}$/
      """

    Examples:
      | id     |
      | Bad_Id |
      | -a     |
      | A      |
      | aB     |
      | a_b    |
      | a b    |
      | !a     |
      | a!     |
      |        |

  Scenario: an identifier of 63 characters is accepted
    Given a valid evidence answer
    And the evidence answer id has 63 characters
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario: an identifier of 64 characters is refused
    Given a valid evidence answer
    And the evidence answer id has 64 characters
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.id Invalid string: must match pattern /^[a-z0-9][a-z0-9-]{0,62}$/
      """

  Scenario: a statement of 601 characters is refused
    Given a valid evidence answer
    And the evidence answer statement has 601 characters
    When the evidence answer is parsed
    Then the evidence answer is refused with:
      """
      $.claims.0.statement Too big: expected string to have <=600 characters
      """

  Scenario: a statement of 600 characters is accepted
    Given a valid evidence answer
    And the evidence answer statement has 600 characters
    When the evidence answer is parsed
    Then the evidence answer is accepted

  Scenario: the nine reason codes are listed in the order of the design note
    Then the evidence reason codes are:
      | ANSWER_INVALID      |
      | ANSWER_ID_MISMATCH  |
      | QUESTION_UNKNOWN    |
      | DOI_UNKNOWN         |
      | TITLE_MISMATCH      |
      | RETRACTED           |
      | SOURCE_TEXT_MISSING |
      | TEXT_NOT_OF_DOI     |
      | QUOTE_ABSENT        |

  Scenario Outline: the question stamped <instant> is <verdict>
    Then the evidence question stamped "<instant>" is <verdict>

    Examples:
      | instant                   | verdict  |
      | 2026-11-14T12:00:00Z      | accepted |
      | 2026-11-14T12:00:00+02:00 | accepted |
      | 2026-11-14T12:00:00-05:30 | accepted |
      | 2026-11-14T12:00:00       | refused  |
      | 2026-11-14                | refused  |
      | 2026-11-14 12:00:00Z      | refused  |

  Scenario Outline: the rejection whose fingerprint is <count> hexadecimal characters after the prefix "<prefix>" is <verdict>
    Then the evidence rejection whose fingerprint is <count> hexadecimal characters after the prefix "<prefix>" is <verdict>

    Examples:
      | prefix  | count | verdict  |
      |         | 64    | accepted |
      |         | 65    | refused  |
      |         | 63    | refused  |
      | x       | 64    | refused  |
      | sha256: | 64    | refused  |
