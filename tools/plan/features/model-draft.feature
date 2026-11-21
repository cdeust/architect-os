Feature: An operator drafts with the chosen provider's signed-in CLI
  Scenario Outline: A native process returns a proposal or a measured refusal
    Then the Plan drafter using "<provider>" with "<reply>" records "<outcome>"

    Examples:
      | provider | reply        | outcome               |
      | claude   | complete     | proposed              |
      | gpt      | complete     | proposed              |
      | gemini   | complete     | proposed              |
      | claude   | refused      | PLAN_PROVIDER_FAILED  |
      | gpt      | tool         | PLAN_PROVIDER_FAILED  |
      | gemini   | tool         | PLAN_PROVIDER_FAILED  |
      | gemini   | refused      | PLAN_PROVIDER_FAILED  |
      | gemini   | diagnostic   | PLAN_PROVIDER_FAILED  |
      | claude   | nonzero      | PLAN_PROVIDER_FAILED  |
      | gpt      | timeout      | PLAN_PROVIDER_FAILED  |
      | gpt      | malformed    | PLAN_PROVIDER_FAILED  |
      | claude   | absent       | PLAN_PROVIDER_FAILED  |
      | gpt      | wrong step   | PLAN_PROPOSAL_INVALID |
      | gemini   | missing ID   | PLAN_PROPOSAL_INVALID |
      | gpt      | invalid run  | PLAN_DEFINE_INVALID   |
      | gemini   | BOM          | PLAN_DEFINE_INVALID   |
      | claude   | invalid UTF8 | PLAN_DEFINE_INVALID   |

  Scenario: Validate the CLI contract before opening a journal
    Then invalid draft operands refuse without a provider request and prepare keeps its own CLI

  Scenario: Pin the no-tool native commands
    Then the three native CLI invocations close their tool surfaces and pin the chosen model

  Scenario: Reject unexpected provider protocol data
    Then only native single-turn drafting events and measured counters are accepted
