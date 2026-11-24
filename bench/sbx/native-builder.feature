Feature: The production SBX builder uses the pinned client offline

  Scenario: A native tool edits the mounted worktree through the host Responses proxy
    Then the isolated production client writes its file and leaves the protected witnesses intact

  Scenario Outline: An admitted production Step runs its native client and publishes its record
    Then the production Step command publishes a native "<model>" patch against an offline provider

    Examples:
      | model         |
      | gpt-6.2-astra |
      | gpt-6.2-sol   |
