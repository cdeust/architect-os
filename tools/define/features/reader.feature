Feature: Read a validated Define handoff without answering the gate
  Scenario Outline: The Define source handles the same run and result through each adapter
    Given the "<adapter>" Define source has a "<reply>" reply
    When the host uses that Define source
    Then the source contract reports "<reply>" for the requested run

    Examples:
      | adapter | reply   |
      | memory  | valid   |
      | memory  | refused |
      | stdio   | valid   |
      | stdio   | refused |

  Scenario: The host accepts a criterion linked to multiple requirements
    Given a Define reply changed to "multiple links"
    When the host reads the Define reply
    Then the Define reader preserves the two links to the criterion

  Scenario: The host reads planning data over the plugin's stdio launcher
    Given an isolated Define plugin that returns the delivery planning data
    When the host invokes the Define reader over stdio
    Then the Define reader writes the three linked requirements and criteria
    And the plugin received only the versioned read for the requested run

  Scenario Outline: The host refuses an invalid or unrelated reply
    Given a Define reply changed to "<case>"
    When the host reads the Define reply
    Then the Define reader refuses with "<error>"

    Examples:
      | case                 | error                 |
      | producer refusal     | DEFINE_REFUSED        |
      | empty content        | DEFINE_REPLY_INVALID  |
      | extra content        | DEFINE_REPLY_INVALID  |
      | nontext content      | DEFINE_REPLY_INVALID  |
      | scalar content       | DEFINE_REPLY_INVALID  |
      | null content         | DEFINE_REPLY_INVALID  |
      | missing content type | DEFINE_REPLY_INVALID  |
      | missing text field   | DEFINE_REPLY_INVALID  |
      | nonstring text       | DEFINE_REPLY_INVALID  |
      | malformed JSON       | DEFINE_REPLY_INVALID  |
      | null payload         | DEFINE_REPLY_INVALID  |
      | scalar payload       | DEFINE_REPLY_INVALID  |
      | wrong envelope       | DEFINE_REPLY_INVALID  |
      | extra envelope       | DEFINE_REPLY_INVALID  |
      | newer version        | DEFINE_REPLY_INVALID  |
      | different run        | DEFINE_RUN_MISMATCH   |
      | empty run            | DEFINE_REPLY_INVALID  |
      | input command        | DEFINE_REPLY_INVALID  |
      | inline executor      | DEFINE_REPLY_INVALID  |
      | inline arguments     | DEFINE_REPLY_INVALID  |
      | invalid requirement  | DEFINE_REPLY_INVALID  |
      | FR prefix            | DEFINE_REPLY_INVALID  |
      | FR suffix            | DEFINE_REPLY_INVALID  |
      | AC prefix            | DEFINE_REPLY_INVALID  |
      | AC suffix            | DEFINE_REPLY_INVALID  |
      | invalid criterion    | DEFINE_REPLY_INVALID  |
      | no requirements      | DEFINE_REPLY_INVALID  |
      | no criteria          | DEFINE_REPLY_INVALID  |
      | no criterion links   | DEFINE_REPLY_INVALID  |
      | duplicate FR         | DEFINE_REPLY_INVALID  |
      | duplicate AC         | DEFINE_REPLY_INVALID  |
      | repeated link        | DEFINE_REPLY_INVALID  |
      | unknown link         | DEFINE_REPLY_INVALID  |
      | uncovered FR         | DEFINE_REPLY_INVALID  |
      | reference-only text  | DEFINE_REPLY_INVALID  |
      | punctuation only     | DEFINE_REPLY_INVALID  |

  Scenario Outline: Invalid arguments do not start the plugin
    Given the Define invocation has "<missing>"
    When the host reads the Define reply
    Then the Define reader refuses with "usage: define <run_id> <prd-gen-plugin-root>"
    And it never opens a Define source

    Examples:
      | missing          |
      | no run or root   |
      | no plugin root   |
      | an extra operand |

  Scenario: A plugin that cannot be started leaves no planning data
    Given an isolated directory without a Define launcher
    When the host invokes the Define reader over stdio
    Then the Define reader reports a transport failure
