Feature: The store of questions, answers and verified records

  Scenario Outline: the Store keeps the questions of the ledger for <adapter>
    Given the evidence store adapter "<adapter>"
    When the evidence questions "b,a-1,a" are saved in that order
    Then the evidence asked identifiers are "a,a-1,b"
    And the evidence question "a-1" is read back
    And the evidence question "zz" is absent

    Examples:
      | adapter   |
      | in-memory |
      | fs        |

  Scenario Outline: the Store lists and reads the answers of the desk for <adapter>
    Given the evidence store adapter "<adapter>"
    And Science has answered "b" with "{\"id\":\"b\"}"
    And Science has answered "a" with "not json at all"
    Then the evidence answer identifiers are "a,b"
    And the evidence raw answer "b" is "{\"id\":\"b\"}"
    And the evidence raw answer "a" is "not json at all"
    And the evidence raw answer "zz" is absent

    Examples:
      | adapter   |
      | in-memory |
      | fs        |

  Scenario Outline: the Store reads a supplied text of the desk for <adapter>
    Given the evidence store adapter "<adapter>"
    And Science has supplied the text "a.txt" as "the full text"
    Then the evidence source text "a.txt" reads "the full text"
    And the evidence source text "missing.txt" is absent
    And the evidence source text "elsewhere/a.txt" is absent

    Examples:
      | adapter   |
      | in-memory |
      | fs        |

  Scenario Outline: the Store keeps and reads the rejections of the desk for <adapter>
    Given the evidence store adapter "<adapter>"
    When the evidence rejection "a" is saved
    Then the evidence rejection "a" is read back
    And the evidence rejection "b" is absent

    Examples:
      | adapter   |
      | in-memory |
      | fs        |

  Scenario Outline: the Store keeps a verified record with its texts and drops its rejection for <adapter>
    Given the evidence store adapter "<adapter>"
    And the evidence rejection "b" is saved
    And the evidence rejection "a" is saved
    And the evidence rejection "c" is saved
    When the evidence record "b" is verified with its text
    And the evidence record "a" is verified with its text
    Then the evidence verified identifiers are "a,b"
    And the evidence verified record "b" is read back
    And the evidence verified record "zz" is absent
    And the evidence ledger keeps the texts under their hashes
    And the evidence rejection "b" is absent
    And the evidence rejection "a" is absent
    And the evidence rejection "c" is read back

    Examples:
      | adapter   |
      | in-memory |
      | fs        |

  Scenario Outline: the Store publishes files of the desk and replaces them for <adapter>
    Given the evidence store adapter "<adapter>"
    When the evidence file "SKILL.md" is published with "first"
    And the evidence file "SKILL.md" is published with "second"
    And the evidence file "answer.schema.json" is published with "{}"
    And the evidence file "..a" is published with "dots"
    Then the evidence published file "SKILL.md" reads "second"
    And the evidence published file "answer.schema.json" reads "{}"
    And the evidence published file "..a" reads "dots"

    Examples:
      | adapter   |
      | in-memory |
      | fs        |

  Scenario Outline: the Store refuses to publish under the name "<name>" for <adapter>
    Given the evidence store adapter "<adapter>"
    Then publishing the evidence file "<name>" is refused
    And the refused evidence file "<name>" left nothing behind

    Examples:
      | adapter   | name    |
      | in-memory | .       |
      | in-memory | ..      |
      | in-memory | ../a    |
      | in-memory | a/b     |
      | in-memory | a b     |
      | in-memory |         |
      | fs        | .       |
      | fs        | ..      |
      | fs        | ../a    |
      | fs        | a/b     |
      | fs        | a b     |
      | fs        |         |

  Scenario Outline: the Store publishes a name of 120 characters and refuses one of 121 for <adapter>
    Given the evidence store adapter "<adapter>"
    When the evidence file of 120 characters is published
    Then the evidence file of 120 characters is read back
    And publishing the evidence file of 121 characters is refused

    Examples:
      | adapter   |
      | in-memory |
      | fs        |
