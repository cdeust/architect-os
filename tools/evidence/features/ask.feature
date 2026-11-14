Feature: Asking a question

  Scenario: a question is recorded in the ledger, trimmed, and the skill is published
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T10:00:00.000Z"
    When the evidence question "probe-1" is asked with the text "  Does the literature say X?\n\n"
    Then the evidence question is asked
    And the ledger holds the question "probe-1" as "Does the literature say X?" asked at "2026-11-14T10:00:00.000Z"
    And the evidence desk published "SKILL.md" as "the skill"
    And the evidence desk published "answer.schema.json" as "{}"

  Scenario Outline: a question of <size> characters is <verdict>
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T10:00:00.000Z"
    When the evidence question "a" is asked with a text of <size> characters
    Then the evidence asked identifiers of the desk are "<asked>"

    Examples:
      | size | verdict  | asked |
      | 1    | accepted | a     |
      | 2000 | accepted | a     |
      | 2001 | refused  |       |

  Scenario: a question of 2001 characters is refused with the issue, and nothing is written
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T10:00:00.000Z"
    When the evidence question "a" is asked with a text of 2001 characters
    Then the evidence question is refused as "QUESTION_INVALID" saying:
      """
      $.question Too big: expected string to have <=2000 characters
      """
    And the evidence desk published nothing named "SKILL.md"

  Scenario: a question of blanks is refused
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T10:00:00.000Z"
    When the evidence question "a" is asked with the text " \n  "
    Then the evidence question is refused as "QUESTION_INVALID" saying:
      """
      $.question Too small: expected string to have >=1 characters
      """
    And the evidence asked identifiers of the desk are ""
    And the evidence desk published nothing named "SKILL.md"

  Scenario: an identifier that is not valid is refused, with the question's issues too
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T10:00:00.000Z"
    When the evidence question "Bad_Id" is asked with the text ""
    Then the evidence question is refused as "QUESTION_INVALID" saying:
      """
      $.id Invalid string: must match pattern /^[a-z0-9][a-z0-9-]{0,62}$/
      $.question Too small: expected string to have >=1 characters
      """
    And the evidence asked identifiers of the desk are ""

  Scenario: a question already in the ledger is refused and nothing is written
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T10:00:00.000Z"
    And the evidence question "a" is asked with the text "first"
    And the evidence clock now reads "2026-11-14T11:00:00.000Z"
    And the evidence skill is replaced by the file "SKILL.md" holding "a later skill"
    When the evidence question "a" is asked with the text "second"
    Then the evidence question is refused as "QUESTION_EXISTS" saying:
      """
      a is already in the ledger
      """
    And the ledger holds the question "a" as "first" asked at "2026-11-14T10:00:00.000Z"
    And the evidence desk published "SKILL.md" as "the skill"
