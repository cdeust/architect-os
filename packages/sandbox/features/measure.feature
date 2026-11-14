Feature: the measures of a claude stream-json session

  Scenario: a complete session: two answers of three events, a line that is not JSON, a result
    When I measure the fixture "session.jsonl"
    Then the measure is
      """
      {
        "completed": true,
        "answers": 2,
        "turns": 9,
        "durationSeconds": 35,
        "costUsd": 0.0770908,
        "inputTokens": 18,
        "outputTokens": 3214,
        "cacheReadTokens": 78473,
        "cacheWriteTokens": 14827,
        "cacheReadPerAnswer": 39237,
        "models": ["claude-haiku-4-5", "claude-sonnet-5-5"],
        "permissionDenials": 2,
        "report": "Done: two files changed."
      }
      """

  Scenario: a session killed at its limit has no result: it is not completed and still counts its answers
    When I measure the fixture "session-killed.jsonl"
    Then the measure is
      """
      {
        "completed": false,
        "answers": 2,
        "turns": 0,
        "durationSeconds": 0,
        "costUsd": 0,
        "inputTokens": 0,
        "outputTokens": 0,
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cacheReadPerAnswer": 0,
        "models": [],
        "permissionDenials": 0,
        "report": ""
      }
      """

  Scenario: a result with is_error true is not completed, its figures are kept
    When I measure the fixture "result-error.jsonl"
    Then the measure is
      """
      {
        "completed": false,
        "answers": 1,
        "turns": 4,
        "durationSeconds": 12,
        "costUsd": 0.5,
        "inputTokens": 5,
        "outputTokens": 7,
        "cacheReadTokens": 1000,
        "cacheWriteTokens": 9,
        "cacheReadPerAnswer": 1000,
        "models": ["claude-sonnet-5-5"],
        "permissionDenials": 0,
        "report": "Stopped."
      }
      """

  Scenario: a result whose subtype is not success is not completed
    When I measure the fixture "result-max-turns.jsonl"
    Then the measure is
      """
      {
        "completed": false,
        "answers": 1,
        "turns": 4,
        "durationSeconds": 12,
        "costUsd": 0.5,
        "inputTokens": 5,
        "outputTokens": 7,
        "cacheReadTokens": 1000,
        "cacheWriteTokens": 9,
        "cacheReadPerAnswer": 1000,
        "models": ["claude-sonnet-5-5"],
        "permissionDenials": 0,
        "report": "Stopped."
      }
      """

  Scenario: a result that does not fit the schema is treated as absent
    When I measure the fixture "result-invalid.jsonl"
    Then the measure is
      """
      {
        "completed": false,
        "answers": 1,
        "turns": 0,
        "durationSeconds": 0,
        "costUsd": 0,
        "inputTokens": 0,
        "outputTokens": 0,
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cacheReadPerAnswer": 0,
        "models": [],
        "permissionDenials": 0,
        "report": ""
      }
      """

  Scenario: no assistant event gives 0 cache read per answer
    When I measure the fixture "no-assistant.jsonl"
    Then the measure is
      """
      {
        "completed": true,
        "answers": 0,
        "turns": 1,
        "durationSeconds": 1,
        "costUsd": 0.01,
        "inputTokens": 3,
        "outputTokens": 4,
        "cacheReadTokens": 500,
        "cacheWriteTokens": 0,
        "cacheReadPerAnswer": 0,
        "models": [],
        "permissionDenials": 0,
        "report": "Nothing to do."
      }
      """

  Scenario: a structured output is carried, the cache read per answer is rounded
    When I measure the fixture "structured.jsonl"
    Then the measure is
      """
      {
        "completed": true,
        "answers": 3,
        "turns": 3,
        "durationSeconds": 12,
        "costUsd": 0.25,
        "inputTokens": 3,
        "outputTokens": 300,
        "cacheReadTokens": 1000,
        "cacheWriteTokens": 20,
        "cacheReadPerAnswer": 333,
        "models": ["claude-opus-5-5"],
        "permissionDenials": 0,
        "report": "Verdict given.",
        "structuredOutput": { "verdict": "accept", "findings": [], "not_checked": [] }
      }
      """
