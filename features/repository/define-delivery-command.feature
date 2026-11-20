Feature: Recorded Define handoff for the delivery command

  Background:
    Given a local copy of the recorded Define handoff

  Scenario: The captured artifacts carry the same run and the implementation decision is pending
    When I inspect the recorded Define handoff
    Then the handoff specimen is intact

  Scenario: The captured specification is absent
    Given the recorded specification file is missing
    When I inspect the recorded Define handoff
    Then the handoff specimen is refused with "Missing Define artifact: 01-prd.md"

  Scenario: The captured decision is for a different action
    Given the recorded decision is replaced by an incompatible action
    When I inspect the recorded Define handoff
    Then the handoff specimen is refused with "Expected the pending implementation_gate question"
