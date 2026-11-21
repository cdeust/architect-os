Feature: Import a Plan proposal from an operator's Antigravity session

  Scenario Outline: Bind a single tool-free turn to the exact requested handoff
    Then the offline Antigravity exchange with "<reply>" records "<outcome>"

    Examples:
      | reply          | outcome                   |
      | accepted       | proposed                  |
      | changed Define | PLAN_AGY_REQUEST_MISMATCH |
      | wrong step     | PLAN_PROPOSAL_INVALID     |
      | missing ID     | PLAN_PROPOSAL_INVALID     |
      | tool call      | PLAN_AGY_STREAM_INVALID   |
      | subagent       | PLAN_AGY_STREAM_INVALID   |
      | wrong model    | PLAN_AGY_STREAM_INVALID   |
      | extra turn     | PLAN_AGY_STREAM_INVALID   |
      | truncated      | PLAN_AGY_STREAM_INVALID   |
      | failed run     | PLAN_AGY_RUN_FAILED       |
