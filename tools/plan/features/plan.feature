Feature: Prepare and explicitly approve one step from Define v1
  Scenario: Tickets affect the preview and approval but leave the operator policy intact
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    When I prepare the Plan once
    Then the approved Step inputs contain the tickets and the operator build configuration

  Scenario: A changed estimate invalidates the old approval
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    When I prepare the Plan once
    And the operator records an approval of the preview
    And the ticket estimate changes after approval
    And I materialize the Plan
    Then Plan refuses with "PLAN_NOT_APPROVED" and publishes nothing

  Scenario: Preparing twice gives the same approval digest without creating Step inputs
    Given a recorded delivery Plan input
    When I prepare the Plan twice
    Then the Plan digest is stable and no Step folder exists

  Scenario: Approval publishes the exact preview with the host's scout question
    Given a recorded delivery Plan input
    And the Plan policy includes a named scout
    When I prepare the Plan twice
    And the operator records an approval of the preview
    And I materialize the Plan
    Then the materialized files match the preview and its manifest
    And the Step folder contains the exact host scout question

  Scenario Outline: Invalid inputs do not produce a preview
    Given a recorded delivery Plan input
    And the Plan input is changed to "<change>"
    When I prepare the Plan once
    Then Plan refuses with "<error>" and publishes nothing

    Examples:
      | change                 | error              |
      | invalid utf8           | PLAN_INPUT_INVALID |
      | byte order mark        | PLAN_INPUT_INVALID |
      | historical refusal     | PLAN_INPUT_INVALID |
      | unlinked acceptance    | PLAN_INPUT_INVALID |
      | invalid handoff tickets| PLAN_INPUT_INVALID |
      | unknown criterion      | PLAN_INPUT_INVALID |
      | incomplete coverage    | PLAN_INPUT_INVALID |
      | repeated criterion     | PLAN_INPUT_INVALID |
      | proposal command       | PLAN_INPUT_INVALID |
      | proposal tickets       | PLAN_INPUT_INVALID |
      | policy tickets         | PLAN_INPUT_INVALID |
      | policy command         | PLAN_INPUT_INVALID |
      | malformed policy       | PLAN_INPUT_INVALID |
      | prototype question     | PLAN_INPUT_INVALID |
      | extra question         | PLAN_INPUT_INVALID |
      | wrong question         | PLAN_INPUT_INVALID |
      | missing question       | PLAN_INPUT_INVALID |
      | blank question         | PLAN_INPUT_INVALID |
      | blank objective        | PLAN_INPUT_INVALID |
      | blank verification     | PLAN_INPUT_INVALID |
      | unsafe step name       | PLAN_STEP_INVALID  |

  Scenario Outline: A different or missing decision cannot authorize materialization
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the Plan decision is "<decision>"
    And I materialize the Plan
    Then Plan refuses with "PLAN_NOT_APPROVED" and publishes nothing

    Examples:
      | decision          |
      | missing           |
      | rejected          |
      | wrong digest      |
      | unknown version   |
      | injected command  |
      | changed Define    |
      | changed proposal  |
      | changed policy    |
      | changed question  |

  Scenario Outline: Materialization only claims a fresh matching folder outside the Step archive
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the operator records an approval of the preview
    And the Plan destination is "<destination>"
    And I materialize the Plan
    Then Plan refuses the destination without replacing existing files

    Examples:
      | destination   |
      | relative      |
      | different name|
      | already exists|
      | worktree       |
      | worktree alias |
      | archive alias |
      | absent parent |

  Scenario Outline: Invocations of the wrong shape are refused
    Given a recorded delivery Plan input
    When I call Plan with an invalid "<mode>" invocation
    Then Plan prints usage and publishes nothing

    Examples:
      | mode        |
      | action      |
      | define      |
      | proposal    |
      | policy      |
      | prepare     |
      | materialize |
      | unknown materialize |

  Scenario Outline: Direct validation identifies a coverage or scout mismatch
    Given a recorded delivery Plan input
    And the Plan input is changed to "<change>"
    Then the Plan validation identifies the rejected coverage or question

    Examples:
      | change           |
      | unknown criterion|
      | wrong question   |

  Scenario: A failed policy write removes the claimed destination
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I simulate a failed write of the approved Step policy
    Then Plan refuses with "PLAN_PUBLISH_REFUSED" and publishes nothing

  Scenario: The publisher detects the reserved path behind a symlink
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the Plan destination is "archive alias"
    Then the Plan publisher detects the archived destination

  Scenario: The publisher reports a malformed path
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the Plan destination is "relative"
    Then the Plan publisher detects the invalid destination

  Scenario: Preview the exact independently reviewed Spec Plan
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    When I prepare the Plan once
    Then the Plan preview binds the complete review receipt

  Scenario: Refuse a changed proposal despite its earlier independent review
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    When the reviewed Plan bytes are changed after review
    And I prepare the Plan once
    Then Plan refuses with "PLAN_INPUT_INVALID" and publishes nothing

  Scenario: Operator approval alone cannot materialize the paired Spec Plan
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan
    Then Plan refuses with "PLAN_SPECIMEN_EVIDENCE_REQUIRED" and publishes nothing

  Scenario Outline: Each reviewed binding must match the independently read sources
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    Then preparing the independently reviewed receipt with a changed "<field>" rejects the binding

    Examples:
      | field           |
      | run             |
      | Define digest   |
      | proposal digest |
      | binding digest  |

  Scenario Outline: JSON primitives reach contract validation
    Given a recorded delivery Plan input
    Then Plan reports a schema error for the JSON primitive "<proposal>"

    Examples:
      | proposal |
      | null     |
      | true     |

  Scenario Outline: Reviewed criteria must match the original Define sequence as written
    Given a recorded delivery Plan input
    And the proposal uses "<change>" criterion IDs
    And the recorded proposal carries independent Define and Plan reviews
    Then preparing the reviewed proposal refuses its coverage

    Examples:
      | change          |
      | padded          |
      | reordered       |
      | extra trailing  |

  Scenario Outline: Legacy unreviewed input still supports unordered, trimmed criterion IDs
    Given a recorded delivery Plan input
    And the proposal uses "<change>" criterion IDs
    When I prepare the Plan once
    Then the prepared Plan contains the normalized criteria in the supplied order

    Examples:
      | change    |
      | padded    |
      | reordered |

  Scenario: A routed policy takes every model from the launcher table and the ticket the Step serves
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the Plan policy routes the Step with the providers "anthropic"
    When I prepare the Plan once
    Then the previewed Step builds "claude-sonnet-5-5" with "medium" on "TICKET-001" at 5 points, starting on "BAND_OF_POINTS"
    And the previewed Step escalates through the bands "3 8"
    And the previewed Step reviews by a Google wait and names no other review
    And the previewed Step binds the launcher routing table

  Scenario: A designated ticket of 13 points starts on Opus, with no band above it
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the Plan policy routes the Step to "TICKET-002" with the providers "anthropic"
    When I prepare the Plan once
    Then the previewed Step builds "claude-opus-5-5" with "high" on "TICKET-002" at 13 points, starting on "BAND_OF_POINTS"
    And the previewed Step escalates through the bands "8"

  Scenario: A small ticket starts on Haiku only when the Step has a check without a model
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the first Define ticket is estimated at 2 points
    And the Plan policy routes the Step with one check and the providers "anthropic"
    When I prepare the Plan once
    Then the previewed Step builds "claude-haiku-5-5" with "medium" on "TICKET-001" at 2 points, starting on "BAND_OF_POINTS"
    And the previewed Step escalates through the bands "1 3 8"

  Scenario: Without a check, a small ticket starts one band higher, and the preview says why
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the first Define ticket is estimated at 2 points
    And the Plan policy routes the Step with the providers "anthropic"
    When I prepare the Plan once
    Then the previewed Step builds "claude-sonnet-5-5" with "medium" on "TICKET-001" at 2 points, starting on "BAND_REQUIRES_CHECKS"
    And the previewed Step escalates through the bands "3 8"

  Scenario: A routed scout takes the scout model of the table and keeps the host's question
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the Plan policy routes the Step with a scout named "history"
    When I prepare the Plan once
    Then the previewed scout "history" runs on "claude-haiku-5-5"

  Scenario: A changed routing table invalidates the old approval
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the Plan policy routes the Step with the providers "anthropic"
    When I prepare the Plan once
    And the operator records an approval of the preview
    And the launcher routing table changes after approval
    And I materialize the Plan
    Then Plan refuses with "PLAN_NOT_APPROVED" and publishes nothing

  Scenario Outline: A routed policy that cannot be routed produces no preview: <change>
    Given a recorded delivery Plan input
    And the saved Define handoff contains ticket estimates
    And the Plan policy routes the Step with the providers "anthropic"
    And the routed Plan input is changed to "<change>"
    When I prepare the Plan once
    Then Plan refuses with "<error>" and publishes nothing

    Examples:
      | change                         | error                       |
      | a model named by the operator  | PLAN_INPUT_INVALID          |
      | two independent tickets        | ROUTING_TICKET_AMBIGUOUS    |
      | no tickets                     | ROUTING_TICKETS_REQUIRED    |
      | an unknown designated ticket   | ROUTING_TICKET_UNKNOWN      |
      | only OpenAI admitted           | ROUTING_NO_ADMITTED_BUILDER |
      | Google admitted                | PLAN_INPUT_INVALID          |
      | a scout without its question   | PLAN_INPUT_INVALID          |
      | a broken routing table         | PLAN_INPUT_INVALID          |
