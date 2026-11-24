@sbx-offline
Feature: The production SBX builder uses the pinned client offline

  Scenario: A native tool edits the mounted worktree through the host Responses proxy
    Then the isolated production client writes its file and leaves the protected witnesses intact

  Scenario Outline: An admitted production Step uses the installed account for its native builder
    Then the production Step command runs "<model>" with the fixture account "<session>"

    Examples:
      | model         | session   |
      | gpt-6.2-astra | installed |
      | gpt-6.2-sol   | installed |
      | gpt-6.2-astra | absent    |

  Scenario: Two host processes silently rotate the installed fixture account once
    Then two native credential consumers share one rotation and release the test item

  Scenario: The trusted bootstrap has independent witnesses for each guest guard
    Then the guest bootstrap fixtures detect every forced branch condition
