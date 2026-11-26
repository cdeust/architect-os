Feature: The Claude review
  claude-review.yml runs the official mode of anthropics/claude-code-action (examples/pr-review-comprehensive.yml at
  v1.0.290: track_progress, the action's comment tools) on the owner's subscription, and keeps this repository's
  stricter rules (docs/infrastructure.md, "The Claude review"): managed settings that deny the shell, the web, writes,
  reads of .git and outside the checkout, with a hook that refuses a comment holding a mention, a misplaced verdict or
  a credential before it is posted; both installed by a trusted step from the commit of the run; a diff written by a
  trusted step; one pin of the action for the three workflows that use it. Each guard has a broken copy refused.

  Scenario: the review job holds the guards of the Claude review
    Given the committed review workflow
    Then the review job holds the guards of the Claude review

  Scenario: one pin of the action for every workflow that uses it
    Then the three workflows that use the action pin it to one commit

  Scenario Outline: a review workflow <kind> is rejected
    Given the committed review workflow
    Then a review workflow <kind> is rejected by the guards of the Claude review

    Examples:
      | kind                                                        |
      | that allows Bash                                            |
      | in auto mode                                                |
      | that loads other MCP servers                                |
      | without the restriction                                     |
      | without the guard of the comments                           |
      | with the restriction from the default branch                |
      | that keeps the review files in the checkout                 |
      | that checks out the review files in cone mode               |
      | that checks out the head of the PR as the working directory |
      | with a secret for the diff                                  |
      | without the bound of the diff                               |
      | with the diff after the action                              |
      | with an action on a branch                                  |
      | with the older pin                                          |
      | that prints the full output                                 |
      | that asks for gh pr comment                                 |
      | with an event expression in a command                       |
      | with broader contents                                       |

  Scenario: the managed settings of the Claude review deny and guard
    Given the committed managed settings of the Claude review
    Then they deny the shell, the web, writes and .git, and guard every comment

  Scenario Outline: managed settings of the Claude review <kind> are rejected
    Given the committed managed settings of the Claude review
    Then the review's managed settings <kind> are rejected

    Examples:
      | kind                                         |
      | that allow Bash                              |
      | that let Claude read .git                    |
      | that allow reads outside the checkout        |
      | that allow auto mode                         |
      | that let the repository add hooks            |
      | that turn every hook off, the guard included |
      | that guard the inline comments only          |
      | that run the guard from the checkout         |
      | that set an environment                      |
