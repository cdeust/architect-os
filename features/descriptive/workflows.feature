Feature: GitHub workflows
  Every workflow pins its actions by commit SHA, installs without lifecycle scripts and checks out without
  credentials; every workflow file found in the directory runs each job on an image named with its version; gate.yml (docs/design/platform-v3-srt.md §7) has the narrow trigger, permission and secret rules of
  the CI gate; broker-live.yml (T-04R) is the only one that reaches the real upstream: it stores no credential, exchanges the identity token of its run for a short-lived access token, runs on main only, and takes the four identifiers of the owner's rule from the secret store so that the public log of a run masks them. The Examples
  list the committed workflows: a new file in .github/workflows adds its row.

  Scenario Outline: workflow <file> pins its actions, installs without scripts and checks out without credentials
    Given the committed workflow "<file>"
    Then every action it uses is pinned by a commit SHA
    And every npm ci in it has --ignore-scripts
    And every checkout in it has persist-credentials false

    Examples:
      | file                       |
      | bench-sandbox.yml          |
      | broker-live.yml            |
      | claude-review.yml          |
      | claude-security-review.yml |
      | claude.yml                 |
      | gate.yml                   |
      | gate-lane.yml              |
      | mutation-full.yml          |
      | pipeline-after-merge.yml   |
      | watch.yml                |

  Scenario: the native lane preserves separate runner jobs and permissions
    Given the committed workflow "gate-lane.yml"
    Then it satisfies the native lane workflow rules
    And Gate jobs reject explicit secrets and permissions

  Scenario: gate.yml follows the rules of the CI gate
    Given the committed workflow "gate.yml"
    Then it satisfies the gate workflow rules
    And Gate jobs reject explicit secrets and permissions

  Scenario: broker-live.yml stores no credential, asks for the identity token of its run, keeps it to main, and names nothing the log would print
    Given the committed workflow "broker-live.yml"
    Then it satisfies the live workflow rules
    And no other workflow exchanges an identity token at Anthropic or names the federation rule

  Scenario: the workflows that may ask GitHub for an identity token are a closed list
    The two of the Claude Code action need the token for the action's own GitHub access. One of them runs in the context
    of main: what keeps its token from the broker's rule is the workflow_ref claim the owner pinned on that rule.
    Then the workflows that ask for the identity token of a run are exactly:
      | broker-live.yml   |
      | claude-review.yml |
      | claude.yml        |

  Scenario Outline: a line that exchanges an identity token or names the rule is seen: <line>
    Then a line that exchanges an identity token or names the rule is seen: <line>

    Examples:
      | line                                              |
      | curl $ACTIONS_ID_TOKEN_REQUEST_URL                |
      | RULE: ${{ secrets.ANTHROPIC_FEDERATION_RULE_ID }} |
      | ORG: ${{ secrets.ANTHROPIC_ORGANIZATION_ID }}     |
      | ACCOUNT: ${{ vars.ANTHROPIC_SERVICE_ACCOUNT_ID }} |
      | SPACE: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}      |
      | curl https://api.anthropic.com/v1/oauth/token     |

  Scenario Outline: a line that does neither is not seen: <line>
    Then a line that does neither is not seen: <line>

    Examples:
      | line                                                          |
      | id-token: write                                               |
      | claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }} |
      | curl https://api.anthropic.com/v1/messages                    |

  Scenario Outline: a live workflow <kind> is rejected
    Given the committed workflow "broker-live.yml"
    Then a live workflow <kind> is rejected

    Examples:
      | kind                                               |
      | triggered by pull_request                          |
      | pushed from another branch                         |
      | with an environment                                |
      | without its main-only condition                    |
      | with broader permissions                           |
      | with one more permission                           |
      | with a stored secret                               |
      | with an identifier read from a repository variable |
      | with an identifier written into a command          |
      | with another context in an expression              |
      | with an identifier named twice                     |
      | with a traced run line                             |

  Scenario: a workflow with an unpinned action is rejected
    Given the committed workflow "gate.yml"
    Then a workflow with an unpinned action is rejected

  Scenario: a workflow with an npm ci without --ignore-scripts is rejected
    Given the committed workflow "gate.yml"
    Then a workflow with an npm ci without --ignore-scripts is rejected

  Scenario: a workflow with a checkout that keeps its credentials is rejected
    Given the committed workflow "gate.yml"
    Then a workflow with a checkout that keeps its credentials is rejected

  Scenario: every job of every workflow file runs on an image named with its version
    The files are found in their directory: a new workflow needs no row here to be judged.
    Then every job of every workflow file runs on an image named with its version
    And a new workflow file whose job runs on ubuntu-latest is refused by its name

  Scenario: an include of a matrix that sets no runner adds no label
    Given the committed workflow "bench-sandbox.yml"
    Then a copy of the workflow whose matrix includes a key that is not its runner is accepted

  Scenario Outline: a workflow whose job runs <kind> is rejected
    A label such as ubuntu-latest moves to another image without a commit of this repository, and what a job finds
    installed moves with it (docs/infrastructure.md, "Bubblewrap before the scrub").
    Given the committed workflow "<file>"
    Then a copy of the workflow whose job runs <kind> is rejected

    Examples:
      | file                     | kind                                            |
      | gate.yml                 | on ubuntu-latest                                |
      | claude.yml               | on ubuntu-latest                                |
      | pipeline-after-merge.yml | on ubuntu-latest                                |
      | gate.yml                 | on macos-latest                                 |
      | gate.yml                 | on an image this repository does not name       |
      | gate.yml                 | on a label taken from an input                  |
      | gate.yml                 | on a list of labels                             |
      | gate.yml                 | without a runner                                |
      | bench-sandbox.yml        | with a floating label in its matrix             |
      | bench-sandbox.yml        | with a label added by the include of its matrix |

  Scenario: a gate workflow triggered by pull_request_target is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow triggered by pull_request_target is rejected

  Scenario: a gate workflow that uses a secret is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow that uses a secret is rejected

  Scenario: a gate workflow with a cache is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow with a cache is rejected

  Scenario: a gate workflow with broader permissions is rejected
    Given the committed workflow "gate.yml"
    Then a gate workflow with broader permissions is rejected

  Scenario Outline: a merge that waits ends the resolver of pipeline-after-merge.yml green: <refusal>
    Given the committed workflow "pipeline-after-merge.yml"
    When its resolver is refused "<refusal>"
    Then the resolver ends green with the notice of the refusal, and writes no output

    Examples:
      | refusal                                                  |
      | merge held: Pipeline has not succeeded on this head      |
      | merge held: no Claude review ran on this head            |
      | merge held: Claude has not posted a verdict on this head |
      | merge held: Claude review verdict is block               |
      | PR head advanced after testing                           |

  Scenario Outline: a refusal that is not a wait still fails the resolver of pipeline-after-merge.yml: <refusal>
    Given the committed workflow "pipeline-after-merge.yml"
    When its resolver is refused "<refusal>"
    Then the resolver fails with the refusal on its error stream, and writes no output

    Examples:
      | refusal                                  |
      | PR label holds merge                     |
      | GitHub did not confirm a completed merge |
      | PR is closed or draft                    |

  Scenario: the waits proven are every held merge the resolver of pipeline-after-merge.yml can raise
    Given the committed workflow "pipeline-after-merge.yml"
    Then the held merges its resolver can raise are:
      | merge held: Pipeline has not succeeded on this head      |
      | merge held: no Claude review ran on this head            |
      | merge held: Claude has not posted a verdict on this head |
      | merge held: Claude review verdict is block               |

  Scenario: no job of pipeline-after-merge.yml runs after a resolver that waits
    Given the committed workflow "pipeline-after-merge.yml"
    Then its only job after the resolver runs for a pull request number alone

  Scenario: a copy of pipeline-after-merge.yml where a held merge is a failure is rejected
    Given the committed workflow "pipeline-after-merge.yml"
    Then a copy whose resolver waits for nothing fails when refused "merge held: Pipeline has not succeeded on this head"

  Scenario: the prompt of claude-review.yml ends the tracking comment with the link of the review run, then the verdict
    Given the committed workflow "claude-review.yml"
    Then its prompt ends the tracking comment with the link of the run, then the verdict

  Scenario: a claude-review.yml without the link of the run is rejected
    Given the committed workflow "claude-review.yml"
    Then a review workflow without the link of the run is rejected

  Scenario Outline: every hosted package job admits its own project commands in <file>
    Given the committed workflow "<file>"
    Then each hosted package job provisions its root before setup and admits its project commands

    Examples:
      | file              |
      | gate.yml          |
      | gate-lane.yml     |
      | mutation-full.yml |
      | broker-live.yml   |
      | watch.yml         |
      | bench-sandbox.yml |

  Scenario Outline: <file> builds before each Stryker run, since the configuration of Stryker loads helpers from the build
    Given the committed workflow "<file>"
    Then each Stryker run of the workflow follows a build in its job
    And a copy of the workflow without the build before Stryker is refused

    Examples:
      | file              |
      | gate-lane.yml     |
      | mutation-full.yml |

  Scenario Outline: the independent advisory runner refuses <fault>
    Given the committed workflow "watch.yml"
    Then a copy with "<fault>" is refused by hosted admission policy

    Examples:
      | fault                   |
      | a late marker           |
      | a bare audit            |
      | a raised severity       |
      | a cached setup          |
      | a bare operational Node |
      | an unguarded npx        |

  Scenario Outline: every job of <file> that runs the gate points its destination first at the first parent of its head, the reference of gate.json from env
    Given the committed workflow "<file>"
    Then every job that runs the gate points the destination of gate.json before it
    And a copy of the workflow without-the-fetch is refused
    And a copy of the workflow with-the-fetch-after-the-gate is refused
    And a copy of the workflow with-the-branch-written-into-the-command is refused
    And a copy of the workflow with-another-branch is refused
    And a copy of the workflow with-the-live-branch-fetched is refused

    Examples:
      | file          |
      | gate.yml      |
      | gate-lane.yml |
