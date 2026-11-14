Feature: The two normalisations

  Scenario Outline: a title is normalised by <operation>
    When the evidence title "<title>" is normalised
    Then the evidence normal form is "<form>"

    Examples:
      | operation                             | title                          | form                |
      | removing the tags                     | <i>Deep</i> <b>Learning</b>    | deeplearning        |
      | removing tags before NFKC             | ＜i＞Deep                      | ideep               |
      | NFKC                                  | ＡＢ１ ﬁne                    | ab1fine             |
      | lower case                            | Attention Is ALL You Need      | attentionisallyouneed |
      | keeping letters of any script         | Éléphant 象                    | éléphant象          |
      | dropping punctuation and blanks       | Is it: a-b, c_d? (yes!)        | isitabcdyes         |

  Scenario Outline: a passage is normalised by <operation>
    When the evidence passage "<passage>" is normalised
    Then the evidence normal form is "<form>"

    Examples:
      | operation                | passage            | form             |
      | reducing runs of blanks  | alpha   beta    c  | alpha beta c     |
      | keeping the case         | Alpha BETA         | Alpha BETA       |
      | NFKC                     | ﬁne ＡＢ１        | fine AB1         |
      | keeping punctuation      | a, b-c (d)         | a, b-c (d)       |
      | keeping the tags         | <i>a</i>           | <i>a</i>         |
      | keeping edge blanks      |  a b               |  a b             |

  Scenario: a line break is a blank
    When the evidence passage is normalised:
      """
      alpha
      beta
      """
    Then the evidence normal form is "alpha beta"
