Feature: The approved Plan is read by the real Step host
  Scenario: Ticket estimates and dependencies survive stdio, local approval, and Step recording
    Given an isolated Define plugin that returns delivery tickets
    When the host invokes the Define reader over stdio
    And the host reads the matching verified proposal over stdio
    Given a recorded delivery Plan input
    And the Plan reads the saved Define and verified proposal CLI output
    When I prepare the Plan once
    Then the approved Step inputs contain the tickets and the operator build configuration
    When the operator records an approval of the preview
    And I materialize the Plan
    Then the materialized files match the preview and its manifest
    Given a step folder
    And the step uses the materialized Plan folder
    And the build session writes the fixture "session.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the sessions started were "code.json"
    And the Step record binds the two approved input files
    And the Step record preserves the approved tickets and builder model

  Scenario: One prepared delivery step links every acceptance criterion into the Step record
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan
    Then the materialized files match the preview and its manifest
    Given a step folder
    And the step uses the materialized Plan folder
    And the build session writes the fixture "session.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the sessions started were "code.json"
    And the Step record binds the two approved input files
    And the approved Step intake still matches the Plan manifest byte for byte

  Scenario: Operator approval of the Plan alone cannot start the Builder
    Given a recorded delivery Plan input
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan
    Given a step folder
    And the step uses the materialized Plan folder
    And the step has "missing" admission evidence
    When I run the step with the arguments "<folder>"
    Then the step exits with 2
    And the step stderr is "architect-os step: STEP_ADMISSION_REQUIRED"
    And no session was started
    And the approved Step intake still matches the Plan manifest byte for byte

  Scenario: A routed Plan reaches the real Step host, which derives the same route from its frozen table and records it
    Given an isolated Define plugin that returns delivery tickets
    When the host invokes the Define reader over stdio
    And the host reads the matching verified proposal over stdio
    Given a recorded delivery Plan input
    And the Plan reads the saved Define and verified proposal CLI output
    And the Plan policy routes the Step with one check and the providers "anthropic"
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan
    Then the materialized files match the preview and its manifest
    Given a step folder
    And the step uses the materialized Plan folder
    And the build session writes the fixture "session.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 1
    And the sessions started were "code.json"
    And the Step record binds the two approved input files
    And the published record field "outcome" is "waiting"
    And the published record field "routing.passes" is [{"pass":1,"band":1,"provider":"anthropic","model":"claude-haiku-5-5","effort":"medium","signal":"review_waiting"}]
