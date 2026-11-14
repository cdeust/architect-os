Feature: The reasons to refuse a source

  Background:
    Given an evidence source titled "Attention Is All You Need" quoting "the dominant sequence transduction models"

  Scenario: the registry does not know the DOI
    Given the evidence registry does not know it
    And the evidence source text is "the dominant sequence transduction models are based on recurrent networks"
    When the evidence source is checked
    Then the evidence reasons are:
      | code        | detail                      |
      | DOI_UNKNOWN | 10.1234/abc is not registered |

  Scenario: the registry holds another title
    Given the evidence registry knows it as "Deep Residual Learning"
    And the evidence source text is "Deep Residual Learning: the dominant sequence transduction models"
    When the evidence source is checked
    Then the evidence reasons are:
      | code           | detail                                 |
      | TITLE_MISMATCH | registry title: Deep Residual Learning |

  Scenario: the title is compared after normalisation
    Given the evidence registry knows it as "<b>ATTENTION</b>: is all you need!"
    And the evidence source text is "ATTENTION is all you need. the dominant sequence transduction models"
    When the evidence source is checked
    Then the evidence source has no reason

  Scenario: the article is retracted
    Given the evidence registry knows it as "Attention Is All You Need", retracted
    And the evidence source text is "Attention Is All You Need. the dominant sequence transduction models"
    When the evidence source is checked
    Then the evidence reasons are:
      | code      | detail                            |
      | RETRACTED | the registry lists a retraction |

  Scenario: the source text is missing
    Given the evidence registry knows it as "Attention Is All You Need"
    And the evidence source text is missing
    When the evidence source is checked
    Then the evidence reasons are:
      | code                | detail                                                  |
      | SOURCE_TEXT_MISSING | a.txt is absent, not a regular file or too large |

  Scenario: the text does not hold the registry title
    Given the evidence registry knows it as "Attention Is All You Need"
    And the evidence source text is "An unrelated paper: the dominant sequence transduction models"
    When the evidence source is checked
    Then the evidence reasons are:
      | code            | detail                                         |
      | TEXT_NOT_OF_DOI | a.txt does not contain the registry title |

  Scenario: the text does not hold the quote
    Given the evidence registry knows it as "Attention Is All You Need"
    And the evidence source text is "Attention Is All You Need. Something else entirely."
    When the evidence source is checked
    Then the evidence reasons are:
      | code         | detail                          |
      | QUOTE_ABSENT | the quote is not in a.txt |

  Scenario: the quote is found across runs of blanks
    Given the evidence registry knows it as "Attention Is All You Need"
    And the evidence source text is "Attention Is All You Need. the  dominant   sequence transduction models"
    When the evidence source is checked
    Then the evidence source has no reason

  Scenario: a difference of case is not the quote
    Given the evidence registry knows it as "Attention Is All You Need"
    And the evidence source text is "Attention Is All You Need. The dominant sequence transduction models"
    When the evidence source is checked
    Then the evidence reasons are:
      | code         | detail                    |
      | QUOTE_ABSENT | the quote is not in a.txt |

  Scenario: an unknown DOI with a text that lacks the quote
    Given the evidence registry does not know it
    And the evidence source text is "nothing here"
    When the evidence source is checked
    Then the evidence reasons are:
      | code         | detail                          |
      | DOI_UNKNOWN  | 10.1234/abc is not registered   |
      | QUOTE_ABSENT | the quote is not in a.txt |

  Scenario: several reasons come back together, in the order of the table
    Given the evidence registry knows it as "Deep Residual Learning", retracted
    And the evidence source text is "nothing here"
    When the evidence source is checked
    Then the evidence reasons are:
      | code            | detail                                            |
      | TITLE_MISMATCH  | registry title: Deep Residual Learning            |
      | RETRACTED       | the registry lists a retraction                   |
      | TEXT_NOT_OF_DOI | a.txt does not contain the registry title |
      | QUOTE_ABSENT    | the quote is not in a.txt                 |

  Scenario: a retracted article with a missing text
    Given the evidence registry knows it as "Deep Residual Learning", retracted
    And the evidence source text is missing
    When the evidence source is checked
    Then the evidence reasons are:
      | code                | detail                                                   |
      | TITLE_MISMATCH      | registry title: Deep Residual Learning                   |
      | RETRACTED           | the registry lists a retraction                          |
      | SOURCE_TEXT_MISSING | a.txt is absent, not a regular file or too large |

  Scenario: a source that holds up has no reason
    Given the evidence registry knows it as "Attention Is All You Need"
    And the evidence source text is "Attention Is All You Need. the dominant sequence transduction models are recurrent."
    When the evidence source is checked
    Then the evidence source has no reason
