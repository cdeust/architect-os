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
    A new pin of the action cannot change the mode in silence because all input keys and values, except the nonempty text of a prompt, are compared with
    the ones written for its file, chosen by the name of the file (the action keeps the last mode it is given, in either spelling), and each installs
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
      | claude.yml | with a prompt that is false |
      | claude.yml | with a prompt, where none is written |
      | claude-review.yml | without its prompt |
      | claude-security-review.yml | without its prompt |
      | claude-review.yml | with a prompt that is not a text |
      | claude-security-review.yml | with an empty prompt |
      | claude.yml | with the contents of claude-review.yml |
      | claude-review.yml | with the contents of claude.yml |
      | claude-security-review.yml | with the contents of claude-review.yml, whose condition differs |
      | claude.yml | with the inputs written for the action of claude-review.yml |
      | claude-review.yml | with the inputs written for the action of claude.yml |
      | claude-security-review.yml | with the inputs written for the action of claude-review.yml |
      | claude-review.yml | with another list of allowed bots |
      | claude-security-review.yml | with another list of allowed bots |
      | claude.yml | with a second permission mode, in the equals spelling, after the canonical one |
      | claude-review.yml | with a second permission mode, in the equals spelling, after the canonical one |
      | claude-security-review.yml | with a second permission mode, in the equals spelling, after the canonical one |
      | claude.yml | with its permission mode in the equals spelling alone |
      | claude-review.yml | with its permission mode in the equals spelling alone |
      | claude-security-review.yml | with its permission mode in the equals spelling alone |
      | claude.yml | with a tool added to its arguments |
      | claude.yml | with an input the rule does not know |
      | claude.yml | with another secret as the credential of the action |
      | claude.yml | with an environment on the installer of the managed settings |
      | claude.yml | with an action that does not wait for its managed settings |
      | claude-review.yml | with an action that does not wait for its managed settings |
      | claude-security-review.yml | with an action that does not wait for its managed settings |
      | claude.yml | with an installer of the managed settings that ends before it installs |
      | claude-review.yml | with an installer of the managed settings that ends before it installs |
      | claude-security-review.yml | with an installer of the managed settings that ends before it installs |
      | claude.yml | with managed settings whose installation may fail |
      | claude-security-review.yml | with managed settings installed after the action |
      | claude-review.yml | with an installer of the managed settings on a condition of its own |
      | claude-review.yml | with a second job that runs the action in other capitals |

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
      | //home/runner/work/_temp/** |
      | //home/runner/work/_temp/  |

  Scenario: every action is in the one shape the rule accepts
    Claude Code refuses to start under the scrub on Linux without bubblewrap (run 45771449067 of the security review),
    and the action installs it only for allowed_non_write_users, in a step that may fail. The rule accepts one shape
    and refuses every other: the action in the steps of a job and nowhere else, one per job, on the exact condition
    that waits for the step `settings` and the step `bubblewrap`; the proof just before it, to the letter; the
    installer of the managed settings, to the letter. The workflow files are found in their directory, not listed.
    It is a net for an honest edit, not a boundary (docs/infrastructure.md, "Bubblewrap before the scrub").
    Then every action of every workflow file waits for the proof of bubblewrap and for its managed settings, and the files that run one are exactly:
      | claude-review.yml          |
      | claude-security-review.yml |
      | claude.yml                 |

  Scenario Outline: "<file>" <kind> is refused
    Then "<file>" <kind> is rejected by the rule of bubblewrap

    Examples:
      | file                       | kind                                                                                                   |
      | claude.yml                 | without the proof of bubblewrap                                                                        |
      | claude-review.yml          | without the proof of bubblewrap                                                                        |
      | claude-security-review.yml | without the proof of bubblewrap                                                                        |
      | claude.yml                 | with the proof of bubblewrap after the action                                                          |
      | claude-review.yml          | with the proof of bubblewrap after the action                                                          |
      | claude-security-review.yml | with the proof of bubblewrap after the action                                                          |
      | claude-review.yml          | with a step between the proof of bubblewrap and the action                                             |
      | claude.yml                 | with a proof of bubblewrap on another condition                                                        |
      | claude-security-review.yml | with a proof of bubblewrap on another condition                                                        |
      | claude.yml                 | whose proof updates unrelated image repositories                                                            |
      | claude.yml                 | that installs bubblewrap without proving it                                                            |
      | claude-review.yml          | that reads the version of bubblewrap and creates no namespace                                          |
      | claude-security-review.yml | that reads the version of bubblewrap and creates no namespace                                          |
      | claude-security-review.yml | that leaves user namespaces restricted                                                                 |
      | claude.yml                 | whose proof of bubblewrap goes on after a failure                                                      |
      | claude-review.yml          | whose proof of bubblewrap ends before its first line                                                   |
      | claude-review.yml          | with a proof of bubblewrap that may fail                                                               |
      | claude-security-review.yml | with a shell on the proof of bubblewrap that only checks its syntax                                    |
      | claude.yml                 | with an action that does not wait for the proof of bubblewrap                                          |
      | claude-review.yml          | with an action that does not wait for the proof of bubblewrap                                          |
      | claude-security-review.yml | with an action that does not wait for the proof of bubblewrap                                          |
      | claude.yml                 | with an action that has no condition                                                                   |
      | claude.yml                 | with the condition of another file and its steps gated to match                                        |
      | claude-review.yml          | with the condition of another file and its steps gated to match                                        |
      | claude-security-review.yml | with the condition of another file and its steps gated to match                                        |
      | claude-review.yml          | with an action that waits for the proof of bubblewrap or for anything else                             |
      | claude-security-review.yml | with an action that waits for the proof of bubblewrap or for anything else                             |
      | claude.yml                 | with the condition of the action between expression markers                                            |
      | claude.yml                 | with a space before the expression markers of the condition, which makes it a text that is always true |
      | claude-review.yml          | with a space before the expression markers of the condition, which makes it a text that is always true |
      | claude-security-review.yml | with a space before the expression markers of the condition, which makes it a text that is always true |
      | claude-review.yml          | with the condition of the action written without spaces                                                |
      | claude-security-review.yml | with the condition of the action in other capitals                                                     |
      | claude.yml                 | with the proof of bubblewrap named between square brackets in the condition                            |
      | claude-review.yml          | with a second action in the job of the first                                                           |
      | claude.yml                 | with a second action inside a group of parallel steps                                                  |
      | claude-review.yml          | with a second action inside a group of parallel steps                                                  |
      | claude-security-review.yml | with a second action inside a group of parallel steps                                                  |
      | claude.yml                 | with a group of parallel steps in the job of the action                                                |
      | claude.yml                 | with a default shell of the job that only checks the syntax                                            |
      | claude-review.yml          | with a default shell of the workflow that only checks the syntax                                       |
      | claude-security-review.yml | with a PATH of the job that the proof of bubblewrap would search                                       |
      | claude.yml                 | with a BASH_ENV of the workflow that the proof of bubblewrap would read                                |
      | claude-review.yml          | in a container                                                                                         |
      | claude.yml                 | with the scrub in the environment of the job                                                           |
      | claude-review.yml          | with the action in a second job that proves nothing                                                    |
      | claude-security-review.yml | with the base action in a second job                                                                   |
      | claude.yml                 | that calls a workflow of another repository                                                            |
      | claude-review.yml          | with a local action before its first step                                                              |
      | claude.yml                 | on a floating runner label                                                                             |
      | claude-review.yml          | on a floating runner label                                                                             |
      | claude-security-review.yml | on a floating runner label                                                                             |
      | claude-review.yml          | on an image the proof of bubblewrap is not written for                                                 |
      | watch.yml                  | with an action inside a group of parallel steps of its first job                                       |
      | gate.yml                   | with an action inside a group of parallel steps of its first job                                       |
      | watch.yml                  | with a scrubbed action added to its first job                                                          |
      | watch.yml                  | with a command that sets the scrub without the action                                                  |
      | pipeline-after-merge.yml   | with a command that sets the scrub without the action                                                  |

  Scenario Outline: a copy of "<file>" <kind> is found in the directory and refused
    A file outside the table is judged like the three: the rule reads the directory.
    Then a copy of "<file>" <kind> is refused among the workflow files, by its name

    Examples:
      | file              | kind                                                             |
      | watch.yml         | with an action inside a group of parallel steps of its first job |
      | watch.yml         | with a scrubbed action added to its first job                    |
      | bench-sandbox.yml | with a command that sets the scrub without the action            |
      | mutation-full.yml | with a command that sets the scrub without the action            |
      | claude.yml        | without the proof of bubblewrap                                  |

  Scenario Outline: no change of one key of the steps the rule holds to the letter passes in "<file>"
    A property over the committed file, not a list of cases: for the checkout of the managed settings, their installer,
    the proof and the action, every key and every key inside their mappings is deleted, replaced by false, by an empty
    text, by "x", and, for a text, given one character more; one unknown key is added to each of these steps, to each of their
    mappings, to the job and to the workflow. Each change is refused. The one exception is written: a prompt replaced by another text that
    is not empty, since the rule holds the presence of a prompt and not its text. The numbers are what the committed
    file gives: a step that gains or loses a key changes them here.
    Then each of the <changes> changes of one key of the four steps of "<file>" is refused, but <prompts> that give its prompt another text

    Examples:
      | file                       | changes | prompts |
      | claude.yml                 | 121     | 0       |
      | claude-review.yml          | 135     | 2       |
      | claude-security-review.yml | 146     | 2       |

  Scenario: the job of the @claude bot reads with its own token
    Its token is in the environment of Claude Code; the bot writes with the token of the Claude app.
    Then the job of the @claude bot reads with its own token and writes with the token of the Claude app
