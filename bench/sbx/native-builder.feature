Feature: The production SBX builder uses the pinned client offline

  Scenario: A native tool edits the mounted worktree through the host Responses proxy
    Then the isolated production client writes its file and leaves the protected witnesses intact
