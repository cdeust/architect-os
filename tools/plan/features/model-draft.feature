Feature: An operator chooses the provider that drafts one Plan
  Scenario Outline: A single request yields a proposal or a measured refusal
    Then the Plan drafter using "<provider>" with "<reply>" records "<outcome>"

    Examples:
      | provider | reply       | outcome               |
      | claude   | complete    | proposed              |
      | gpt      | complete    | proposed              |
      | gemini   | complete    | proposed              |
      | claude   | truncated   | PLAN_PROVIDER_FAILED  |
      | gpt      | refused     | PLAN_PROVIDER_FAILED  |
      | gemini   | blocked     | PLAN_PROVIDER_FAILED  |
      | gpt      | wrong step  | PLAN_PROPOSAL_INVALID |
      | gemini   | missing ID  | PLAN_PROPOSAL_INVALID |
      | claude   | rate limit  | PLAN_PROVIDER_FAILED  |
      | gpt      | timed out   | PLAN_PROVIDER_FAILED  |
      | gpt      | invalid run | PLAN_DEFINE_INVALID   |
      | claude   | missing key | PLAN_KEY_MISSING      |
      | gpt      | length          | PLAN_PROVIDER_FAILED  |
      | gpt      | nontext         | PLAN_PROVIDER_FAILED  |
      | gpt      | malformed usage | proposed              |
      | gemini   | BOM             | PLAN_DEFINE_INVALID   |
      | claude   | invalid UTF8    | PLAN_DEFINE_INVALID   |

      | claude   | missing content | PLAN_PROVIDER_FAILED  |
      | gemini   | missing content | PLAN_PROVIDER_FAILED  |

  Scenario: Validate the CLI contract before opening a journal
    Then invalid draft operands refuse without a provider request and prepare keeps its own CLI
