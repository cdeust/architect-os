Feature: The host reserves private outputs for an admitted step

  Background:
    Given a bound run for the runtime entry check
    And private directories for an admitted step

  Scenario: Distinct steps share the run and preserve prior attempts
    Then the host reserves private retained and disposable directories for distinct steps
    And repeating the step refuses and preserves its evidence

  Scenario: The admission controls the roots
    Then a step refuses an unbound allocation
    And a step refuses outputs below or equal to the intake or candidate

  Scenario: The stream directory cannot redirect an allocation
    Then an existing link in the stream path refuses the step

  Scenario: The host rolls back its own empty reservation when the stream path is occupied
    Then existing stream evidence survives a partial reservation and its retry

  Scenario: The host verifies the run temporary directory before opening its child
    Then a shared run temporary directory refuses the step

  Scenario Outline: Rollback preserves another owner or their evidence and the original cause
    Then a failed stream reservation preserves a retained directory that was <action>

    Examples:
      | action    |
      | replaced  |
      | populated |
      | removed   |
      | remounted |
