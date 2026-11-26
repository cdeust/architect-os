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
      | with a secret for the diff                    |
      | without the bound of the diff                 |
      | without the cut of a long diff                |
      | with a step that may fail silently            |
      | that tracks progress                          |
      | that prints the full output                   |
      | that allows Bash                              |
      | that loads other MCP servers                  |
      | with a reviewer that may comment              |
      | without the shape of the answer               |
      | with a review job that may write              |
      | with a publish job that holds the secret      |
      | with a publish job that may write contents    |
      | with a publish job that runs a script of the default branch |

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

  Scenario: the shape of the findings is the schema the publisher checks
    Then the shape of the findings is a schema the publisher checks and the command line can carry

  Scenario Outline: the publisher neutralises a finding whose text tries to <attempt>
    The reviewer's JSON is untrusted: a prompt injected by the diff shapes it. An app such as Codex obeys an @mention
    whoever writes it, and a merge resolver reads a line `Verdict:`.
    Then the publisher renders a finding whose text tries to <attempt>
    And the comment has no @mention, no verdict line, and renders nothing of the finding

    Examples:
      | attempt           |
      | mention an app    |
      | pass a verdict    |
      | hide HTML         |
      | close a code span |
      | insert a link     |
      | show an image     |
      | use an entity     |

  Scenario: the publisher says when no finding passed
    Then the publisher renders an empty list as a comment that says no finding passed

  Scenario: the publisher cuts a long comment at a finding
    Then the publisher cuts a comment that would pass its bound at a finding, with a line that says so

  Scenario Outline: a shape of the findings <kind> is rejected
    Given the committed workflow "claude-security-review.yml"
    Then a shape of the findings <kind> is rejected

    Examples:
      | kind                                 |
      | that allows another key              |
      | that allows another key in a finding |
      | that allows a LOW finding            |
      | that lowers the confidence floor     |
      | that lifts the number of findings    |
      | that lifts the length of a field     |
      | that drops a required field          |

  Scenario: the publisher posts one comment and gives gh nothing but its token
    Then the publisher posts one comment with the findings, and gives gh nothing but its token

  Scenario: the publisher posts a fixed notice for a refused answer
    Then the publisher posts the fixed notice for a refused answer and says why in the job summary

  Scenario: the publisher posts nothing for a pull request number that is not a number
    Then the publisher posts nothing for a pull request number that is not a number

  Scenario: the publisher says when gh fails
    Then the publisher exits 3 and says so in the job summary when gh fails

  Scenario: the publisher leaves out a run link of another host
    Then the publisher leaves out a run link that is not a run of GitHub

  Scenario Outline: the publisher refuses an answer <kind>
    Then the publisher refuses an answer <kind>

    Examples:
      | kind                             |
      | not JSON                         |
      | without findings                 |
      | with another key                 |
      | with a finding of another key    |
      | with a finding without its file  |
      | with a LOW finding               |
      | with a low confidence            |
      | with a line that is not a number |
      | with a fractional line           |
      | with a line that is a boolean    |
      | with a confidence that is a boolean |
      | with a description too long      |
      | with too many findings           |
      | with a confidence that is not finite |
      | with an infinite confidence |
      | holding a key of Anthropic cut by a zero-width space |
      | holding a key of Anthropic cut by a zero-width non-joiner |
      | holding a key of Anthropic cut by a zero-width joiner |
      | holding a key of Anthropic cut by a word joiner |
      | holding a key of Anthropic cut by a byte order mark |
      | holding a key of Anthropic cut by a soft hyphen |
      | holding a key of Anthropic cut by a left-to-right mark |
      | holding a key of Anthropic cut by a right-to-left mark |
      | holding a key of Anthropic cut by a right-to-left override |
      | holding a GitHub token cut by a zero-width space |
      | holding a GitHub token cut by a zero-width non-joiner |
      | holding a GitHub token cut by a zero-width joiner |
      | holding a GitHub token cut by a word joiner |
      | holding a GitHub token cut by a byte order mark |
      | holding a GitHub token cut by a soft hyphen |
      | holding a GitHub token cut by a left-to-right mark |
      | holding a GitHub token cut by a right-to-left mark |
      | holding a GitHub token cut by a right-to-left override |
      | holding the shape of a key of Anthropic |
      | holding the shape of a GitHub token |
      | holding the shape of a fine-grained GitHub token |

  Scenario Outline: a refused answer <where> is not published, even in the job summary
    The reason of a refusal names a place of the schema, never a byte of the answer: the job summary is rendered.
    Then a refused answer <where> reaches neither the comment nor the job summary

    Examples:
      | where                            |
      | with an unknown key              |
      | with an unknown key in a finding |

  Scenario: the publisher leaves out a run link of GitHub with a suffix
    Then the publisher leaves out a run link of GitHub followed by anything
