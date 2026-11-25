Feature: The Claude security review
  claude-security-review.yml (docs/infrastructure.md, "The Claude security review") reviews a trusted pull request
  for security on the owner's subscription, once, and blocks nothing. Its guards hold whatever engine runs in its
  step `engine`: the trust rule of claude-review.yml, the default branch as Claude's working directory, the review
  files taken from the commit of the run alone, the credential looked for before anything uses it, Claude Code
  restricted to reading by managed settings, a diff written by a trusted step, one secret and no expression in a
  command. Each guard has a broken copy below that the rules refuse.

  Scenario: claude-security-review.yml holds the guards of an advisory review
    Given the committed workflow "claude-security-review.yml"
    Then it satisfies the security review workflow rules

  Scenario Outline: a security review workflow <kind> is rejected
    Given the committed workflow "claude-security-review.yml"
    Then a security review workflow <kind> is rejected

    Examples:
      | kind                                          |
      | triggered by pull_request_target              |
      | with one more trigger                         |
      | reviewing every push                          |
      | that cancels a review in progress             |
      | with a permission for the whole workflow      |
      | without the fork condition                    |
      | that runs on drafts                           |
      | that runs for Dependabot                      |
      | with broader contents                         |
      | with the identity token                       |
      | with an environment                           |
      | without a timeout                             |
      | with an action on a branch                    |
      | that checks out the head of the PR            |
      | that keeps the checkout credentials           |
      | that checks out the review files in cone mode |
      | that checks out the whole run commit          |
      | without the credential guard on the engine    |
      | without its skip notice                       |
      | without the restriction                       |
      | with the restriction from the default branch  |
      | with the diff after the engine                |
      | with an event expression in a command         |
      | with a secret in the environment of a step    |
      | with a second secret for the engine           |
      | with a step that may fail silently            |
      | that tracks progress                          |
      | that prints the full output                   |
      | that allows Bash                              |
      | that loads other MCP servers                  |

  Scenario: the security review blocks no merge
    The resolver merges on the gate and the Claude review alone, and the ruleset requires the two gate jobs alone.
    Then neither the merge resolver nor the ruleset of main names the security review

  Scenario: a comment of the security review is never read as a verdict
    The review comments as github-actions[bot] (the job's own token); the resolver reads verdicts of claude[bot] only.
    Then the merge resolver reads a verdict only from a comment of claude[bot]

  Scenario: the managed settings of the security review restrict Claude Code to reading the checkout
    Given the committed managed settings of the security review
    Then they deny every tool that runs a command, writes or reaches a host

  Scenario Outline: managed settings <kind> are rejected
    Given the committed managed settings of the security review
    Then managed settings <kind> are rejected

    Examples:
      | kind                                  |
      | that allow Bash                       |
      | that let Claude read .git             |
      | that allow reads outside the checkout |
      | that keep hooks                       |
      | that allow a tool                     |
      | that set an environment               |

  Scenario: the instruction files of the security review are text the reviewer can read
    Then each instruction file of the security review is text the reviewer can read

  Scenario Outline: an instruction file <kind> is rejected
    Then an instruction file <kind> is rejected

    Examples:
      | kind                       |
      | empty                      |
      | without a final newline    |
      | too large                  |
      | with a GitHub expression   |
      | without its provenance     |
      | without the license notice |
