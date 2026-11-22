Feature: The approved Plan is read by the real Step host
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
