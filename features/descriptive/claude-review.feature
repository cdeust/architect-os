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

  Scenario: every workflow that runs the action fixes its permission mode and forbids auto and bypass
    A new pin of the action cannot change the mode in silence: each sets it once, default or acceptEdits, and installs
    managed settings that forbid auto and bypass, block reads outside the checkout and deny by name what a credential
    of the runner sits behind, from a sparse checkout of the commit of the run, before the action.
    Then every workflow that runs the action fixes its mode and forbids auto and bypass:
      | claude.yml                 |
      | claude-review.yml          |
      | claude-security-review.yml |

  Scenario Outline: "<file>" <kind> is rejected
    Then "<file>" <kind> is rejected by the rule of the permission mode

    Examples:
      | file                       | kind                                          |
      | claude.yml                 | in auto mode                                  |
      | claude.yml                 | without the scrub of its subprocesses         |
      | claude-review.yml          | without the scrub of its subprocesses         |
      | claude-security-review.yml | without the scrub of its subprocesses         |
      | claude.yml                 | without a mode                                |
      | claude.yml                 | with two modes                                |
      | claude.yml                 | without its managed settings                  |
      | claude.yml                 | with managed settings from the default branch |
      | claude.yml                 | with its settings checked out in cone mode    |
      | claude-review.yml          | in auto mode                                  |
      | claude-review.yml          | without a mode                                |
      | claude-review.yml          | without its managed settings                  |
      | claude-security-review.yml | in auto mode                                  |
      | claude-security-review.yml | without a mode                                |
      | claude-security-review.yml | without its managed settings                  |
      | claude-security-review.yml | with managed settings from the default branch |

  Scenario Outline: managed settings that do not forbid <mode> are rejected
    Then managed settings that do not forbid <mode> are rejected by the rule of the permission mode

    Examples:
      | mode                       |
      | auto mode                  |
      | bypass mode                |
      | reads outside the checkout |
      | .git/**                    |
      | //proc/**                  |
      | ~/.claude/**               |
      | ~/.config/gh/**            |
      | ~/.git-credentials         |
      | ~/.gitconfig               |
      | //home/runner/work/_temp/  |

  Scenario: every workflow that runs the action proves bubblewrap before it starts
    With the scrub, Claude Code refuses to start on Linux without bubblewrap (run 45771449067 of the security review),
    and the action installs it only for allowed_non_write_users, in a step that may fail. Each job installs what that
    step installs, lifts the restriction of user namespaces of Ubuntu 24.04, and creates a namespace, before the action,
    on the image the proof is written for (docs/infrastructure.md, "Bubblewrap before the scrub").
    Then every workflow that runs the action proves bubblewrap before it, on a named image:
      | claude.yml                 |
      | claude-review.yml          |
      | claude-security-review.yml |

  Scenario Outline: "<file>" <kind> is refused
    Then "<file>" <kind> is rejected by the rule of bubblewrap

    Examples:
      | file                       | kind                                                            |
      | claude.yml                 | without the proof of bubblewrap                                 |
      | claude-review.yml          | without the proof of bubblewrap                                 |
      | claude-security-review.yml | without the proof of bubblewrap                                 |
      | claude.yml                 | on a floating runner label                                      |
      | claude-review.yml          | on a floating runner label                                      |
      | claude-security-review.yml | on a floating runner label                                      |
      | claude.yml                 | with the proof of bubblewrap after the action                   |
      | claude-review.yml          | with the proof of bubblewrap after the action                   |
      | claude-security-review.yml | with the proof of bubblewrap after the action                   |
      | claude-review.yml          | with a proof of bubblewrap that may fail                        |
      | claude-security-review.yml | with a proof of bubblewrap on another condition than the action |
      | claude.yml                 | that installs bubblewrap without proving it                     |
      | claude-review.yml          | that reads the version of bubblewrap and creates no namespace   |
      | claude-security-review.yml | that reads the version of bubblewrap and creates no namespace   |
      | claude-security-review.yml | that leaves user namespaces restricted                          |
      | claude.yml                 | whose proof of bubblewrap goes on after a failure               |
      | claude-review.yml          | on an image the proof of bubblewrap is not written for          |

  Scenario: the job of the @claude bot reads with its own token
    Its token is in the environment of Claude Code; the bot writes with the token of the Claude app.
    Then the job of the @claude bot reads with its own token and writes with the token of the Claude app
