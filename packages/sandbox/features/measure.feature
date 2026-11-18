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
        "costByModel": { "claude-haiku-4-5": 0.0070908, "claude-sonnet-5-5": 0.07 },
        "permissionDenials": 2,
        "ignoredLines": 1,
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
        "costByModel": {},
        "permissionDenials": 0,
        "ignoredLines": 1,
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
        "costByModel": { "claude-sonnet-5-5": 0.5 },
        "permissionDenials": 0,
        "ignoredLines": 0,
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
        "costByModel": { "claude-sonnet-5-5": 0.5 },
        "permissionDenials": 0,
        "ignoredLines": 0,
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
        "costByModel": {},
        "permissionDenials": 0,
        "ignoredLines": 0,
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
        "costByModel": {},
        "permissionDenials": 0,
        "ignoredLines": 0,
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
        "costByModel": { "claude-opus-5-5": 0.25 },
        "permissionDenials": 0,
        "ignoredLines": 0,
        "report": "Verdict given.",
        "structuredOutput": { "verdict": "accept", "findings": [], "not_checked": [] }
      }
      """

  Scenario: a session killed while writing ends on a truncated line: one ignored line, a line of two spaces is another, an empty line is not counted
    When I measure the fixture "session-truncated.jsonl"
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
        "costByModel": {},
        "permissionDenials": 0,
        "ignoredLines": 2,
        "report": ""
      }
      """

  Scenario: the cost of each model is the costUSD of its modelUsage, two models give two keys
    When I measure the fixture "build-exact.jsonl"
    Then the measure costs by model
      """
      { "claude-haiku-4-5": 0.0625, "claude-sonnet-5-5": 0.5 }
      """

  Scenario: the cost of one model
    When I measure the fixture "review-sonnet.jsonl"
    Then the measure costs by model
      """
      { "claude-sonnet-5-5": 0.125 }
      """

  Scenario: a model named __proto__ keeps its cost: its name is read as a pair, never as a key a library drops
    When I measure the fixture "result-model-proto.jsonl"
    Then the measure costs by model
      """
      { "__proto__": 0.25, "claude-sonnet-5-5": 0.25 }
      """

  Scenario Outline: a result whose modelUsage is not an object of models with a costUSD each is not a result: <fixture>
    When I measure the fixture "<fixture>"
    Then the measure is not completed, with no cost by model and no model

    Examples:
      | fixture                         |
      | result-model-without-cost.jsonl |
      | result-cost-string.jsonl        |
      | result-usage-null.jsonl         |
      | result-usage-list.jsonl         |
      | result-usage-number.jsonl       |
