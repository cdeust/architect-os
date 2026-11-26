Feature: the gate has two entries, and only the runs of a pull request are in a concurrency group
  A run of the gate starts 36 jobs, and the account's limit on concurrent jobs is shared by all its runs: the run of a
  superseded pull-request commit keeps runners for a verdict no one reads. gate.yml, the pull-request entry, puts the
  runs of one pull request in one group and cancels the one in progress. A run on main publishes the base of the count
  that the next run reads, and a run on a trial branch is the one the delivery waits for: neither may be cancelled
  through a group. `cancel-in-progress: false` would not protect them from a later run that names their group, a group
  cannot be empty and `concurrency` cannot be left out conditionally, so those runs have their own entry,
  gate-push.yml, which declares no group at all (docs/infrastructure.md, "The two entries of the gate").

  The ruleset of main requires the checks gate-linux and gate-macos, and a job of a called workflow reports as
  `<caller job> / <job>`: both verdict jobs stay jobs of each entry. The push entry is written whole from the
  pull-request entry by `npm run workflow:gate-push`: its own head, then the same bytes from the line `jobs:` to the end.

  The scenarios compare the parsed files with literal values and check that keys are absent; they evaluate no
  expression. What they cannot see is a group that another workflow computes at run time: it could only cancel a run of
  a pull request, since no other run of the gate is in a group, and a cancelled run gives no green check.

  Scenario: the committed entries keep the rule of the concurrency groups of the gate
    Given the committed workflows of the gate and the readers of its runs
    Then the pull-request entry cancels the superseded run of its pull request, and no other run of the gate is in a group

  Rule: the pull-request entry declares one literal group per pull request, at workflow level, and cancels in progress

    Scenario Outline: a copy where <fault> is refused
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "<refusal>"

      Examples:
        | fault                                                    | refusal                                                                                 |
        | gate.yml has one group for all pull requests             | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml is grouped by the head branch                   | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml is grouped by the ref                           | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml is grouped by the run                           | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml falls back to the run when the number is absent | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml computes cancel-in-progress by an expression    | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml never cancels in progress                       | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml writes cancel-in-progress as a string           | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml has no cancel-in-progress                       | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml has one more key in its concurrency block       | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml has no concurrency block                        | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml writes its group in the string form             | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | gate.yml declares its group on a job instead             | gate.yml does not declare exactly the group of its pull request, cancelling in progress |
        | a job of gate.yml declares a group too                   | the job gate-macos of gate.yml declares a concurrency key                               |

  Rule: the pull-request entry is triggered by pull_request alone, so the number its group reads always exists

    Scenario Outline: a copy where <fault> is refused, since a run without a pull request would join the group gate-pr-
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "<refusal>"

      Examples:
        | fault                                             | refusal                                            |
        | gate.yml is also triggered by push                | gate.yml is triggered by pull_request alone        |
        | gate.yml is also triggered by workflow_dispatch   | gate.yml is triggered by pull_request alone        |
        | gate.yml is also triggered by pull_request_target | gate.yml is triggered by pull_request alone        |
        | gate.yml is also triggered by merge_group         | gate.yml is triggered by pull_request alone        |
        | gate.yml is also triggered by schedule            | gate.yml is triggered by pull_request alone        |
        | gate.yml is also triggered by workflow_call       | gate.yml is triggered by pull_request alone        |
        | gate.yml filters its pull_request trigger         | the pull_request trigger of gate.yml has no filter |

  Rule: the two entries hold the same keys above their jobs, and the same permissions, since the generator copies only the jobs

    Scenario Outline: a copy where <fault> is refused
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "<refusal>"

      Examples:
        | fault                                             | refusal                                                                      |
        | gate.yml gains an environment above its jobs      | gate.yml holds other keys than name, on, concurrency, permissions and jobs   |
        | gate-push.yml gains an environment above its jobs | gate-push.yml holds other keys than name, on, permissions and jobs           |
        | gate.yml widens its permissions                   | the permissions of gate-push.yml are not those of gate.yml                   |

  Rule: the push entry and the lane workflow declare no concurrency key, at workflow level nor on a job

    Scenario Outline: a copy where <fault> is refused, since a run in a group can be cancelled by a later run that names it
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "<refusal>"

      Examples:
        | fault                                             | refusal                                                    |
        | gate-push.yml declares a group                    | gate-push.yml declares a concurrency key                   |
        | gate-push.yml declares a group in the string form | gate-push.yml declares a concurrency key                   |
        | gate-push.yml declares an empty concurrency key   | gate-push.yml declares a concurrency key                   |
        | a job of the two entries declares a group         | the job gate-linux of gate.yml declares a concurrency key  |
        | gate-lane.yml declares a group                    | gate-lane.yml declares a concurrency key                   |
        | the replay job of gate-lane.yml declares a group  | the job replay of gate-lane.yml declares a concurrency key |

    Scenario: a copy where only a job of the push entry declares a group is refused
      Given a copy of the committed workflows of the gate where a job of gate-push.yml declares a group
      Then that copy of the workflows of the gate is refused: "the job gate-linux of gate-push.yml declares a concurrency key"

  Rule: no other workflow file, ending in .yml or in .yaml, names a group of the gate, at workflow level nor on a job

    Scenario Outline: a copy where <fault> is refused
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "<refusal>"

      Examples:
        | fault                                                                                 | refusal                                                                             |
        | another workflow names a group of the gate                                            | other.yml declares a concurrency group whose name begins with gate-                 |
        | a workflow file ending in .yaml names a group of the gate                             | other.yaml declares a concurrency group whose name begins with gate-                |
        | another workflow names a group of the gate in the string form                         | other.yml declares a concurrency group whose name begins with gate-                 |
        | another workflow names a group of the gate in another case                            | other.yml declares a concurrency group whose name begins with gate-                 |
        | a job of another workflow names a group of the gate                                   | the job one of other.yml declares a concurrency group whose name begins with gate-  |
        | a job of a workflow file ending in .yaml names a group of the gate in the string form | the job one of other.yaml declares a concurrency group whose name begins with gate- |
        | a committed workflow takes a group of the gate                                        | claude-review.yml declares a concurrency group whose name begins with gate-         |

    Scenario Outline: a copy where <addition> is accepted
      Given a copy of the committed workflows of the gate where <addition>
      Then that copy of the workflows of the gate is accepted

      Examples:
        | addition                                                                                      |
        | another workflow declares a group of its own name                                             |
        | a workflow file ending in .yaml declares a group of its own name on a job, in the string form |
        | another workflow declares a group that holds gate- after its first characters                 |
        | another workflow declares no group                                                            |

  Rule: the push entry is written whole from the pull-request entry, and the committed file is what the command writes

    Scenario: npm run workflow:gate-push writes gate-push.yml from gate.yml, with its own head and the jobs unchanged
      Then the command that writes the push entry writes it once from the pull-request entry, then changes nothing

    Scenario Outline: a copy where <fault> is refused, since the push entry would no longer be the one the command writes
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "gate-push.yml is not what npm run workflow:gate-push writes from gate.yml"

      Examples:
        | fault                                                                     |
        | one byte of the jobs of gate.yml changes                                  |
        | one byte of the jobs of gate-push.yml changes                             |
        | gate-push.yml ends with one more line                                     |
        | gate.yml has one more job                                                 |
        | one character of a comment of the head of gate-push.yml changes           |
        | gate-push.yml loses the comment that says it is generated                 |

  Rule: each reader of a gate run names the entry it reads

    Each verdict job requests its own base through the admitted main-push retrieval script. The delivery waits for the
    run of a trial branch, a run of the push entry. The resolver of pipeline-after-merge.yml merges on a run of a pull
    request, a run of the pull-request entry, which it names by path and by display name.

    Scenario Outline: a copy where <fault> is refused
      Given a copy of the committed workflows of the gate where <fault>
      Then that copy of the workflows of the gate is refused: "<refusal>"

      Examples:
        | fault                                                     | refusal                                                                    |
        | both entries fetch the base outside the gate retrieval script | the job gate-linux does not read the base of the count from the push entry |
        | only gate-macos requests the Linux base                       | the job gate-macos does not read the base of the count from the push entry |
        | the delivery waits for the pull-request entry             | the delivery does not wait for the push entry                              |
        | the push entry takes the name of the pull-request entry   | gate-push.yml is not named gate-push                                       |
        | the pull-request entry takes another name                 | gate.yml is not named gate                                                 |
        | the resolver is woken by the push entry too               | pipeline-after-merge.yml is not woken by the pull-request entry alone      |
        | the resolver reads the runs of the push entry             | pipeline-after-merge.yml does not read the pull-request entry              |
