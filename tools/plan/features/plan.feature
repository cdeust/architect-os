Feature: Prepare and explicitly approve one step from Define v1
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
      | unknown criterion      | PLAN_INPUT_INVALID |
      | incomplete coverage    | PLAN_INPUT_INVALID |
      | repeated criterion     | PLAN_INPUT_INVALID |
      | proposal command       | PLAN_INPUT_INVALID |
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
