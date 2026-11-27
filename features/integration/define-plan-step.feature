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

  Scenario: The receipt npm run admit issues for an approved reviewed Plan admits the production Step host, for those inputs only
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan
    Then the reviewed Plan folder holds exactly the approved files of the preview
    When the host runs npm run admit for the materialized Plan on a clean linked worktree with measured specimens
    Then the production Step host admits the materialized folder with the issued receipt
    When the approved brief is changed after issuance
    Then the production Step host refuses the materialized folder with "STEP_ADMISSION_EVIDENCE_MISMATCH"

  Scenario: A materialized reviewed Plan folder starts no session in the production Step host without a receipt
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan
    Then the reviewed Plan folder holds exactly the approved files of the preview
    And the production Step host on a clean linked worktree refuses the materialized folder without a receipt and starts no session
