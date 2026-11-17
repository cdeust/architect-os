Feature: The ports of the delivery command (each contract, one row per adapter)
  Commits and runs are described by the scenario; their hashes and ids are the adapter's. The row of each real adapter comes with the step that builds it.

  Rule: Repository

    Scenario Outline: the head is a full hash, and the tree is clean until a file changes
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository is at the commit "c1"
      Then the delivery repository head is 40 lower-case hexadecimal characters
      And the delivery repository is clean
      When a file of the delivery worktree changes
      Then the delivery repository is not clean

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a branch the remote does not have, and a branch it has
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote holds the branch "main" at the commit "c1"
      When the delivery repository fetches
      Then the delivery remote head of "other" is undefined
      And the delivery remote head of "main" is the commit "c1"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a push to a branch whose remote hash is an ancestor
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1"
      And the delivery remote holds the branch "main" at the commit "c1"
      When I push the commit "c2" to the delivery branch "main"
      And the delivery repository fetches
      Then the delivery push answered "pushed"
      And the delivery remote head of "main" is the commit "c2"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a push to a branch the remote does not have
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      When I push the commit "c1" to the delivery branch "fresh"
      And the delivery repository fetches
      Then the delivery push answered "pushed"
      And the delivery remote head of "fresh" is the commit "c1"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a push of a commit that does not descend from the remote hash is refused and changes nothing
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2"
      And the delivery remote holds the branch "main" at the commit "c1"
      When I push the commit "c2" to the delivery branch "main"
      And the delivery repository fetches
      Then the delivery push answered "refused"
      And the delivery remote head of "main" is the commit "c1"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a commit is its own ancestor, a parent is an ancestor of its child, not the other way
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1"
      And the delivery repository holds the commit "c3"
      Then the delivery commit "c1" is an ancestor of "c1"
      And the delivery commit "c1" is an ancestor of "c2"
      And the delivery commit "c2" is not an ancestor of "c1"
      And the delivery commit "c3" is not an ancestor of "c2"
      And the delivery commit "c1" is not an ancestor of "c3"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: the lines removed from a file between two commits
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery repository holds the commit "c2" after "c1"
      And the delivery repository holds the commit "c3" after "c2" that removed 1 lines from "a.md"
      And the delivery repository holds the commit "c4" after "c3" that removed 2 lines from "a.md"
      And the delivery repository holds the commit "c5" after "c4" that removed 4 lines from "b.md"
      Then the delivery repository counts 0 deleted lines in "a.md" from "c1" to "c2"
      And the delivery repository counts 1 deleted lines in "a.md" from "c2" to "c3"
      And the delivery repository counts 2 deleted lines in "a.md" from "c3" to "c4"
      And the delivery repository counts 3 deleted lines in "a.md" from "c2" to "c4"
      And the delivery repository counts 3 deleted lines in "a.md" from "c2" to "c5"
      And the delivery repository counts 4 deleted lines in "b.md" from "c2" to "c5"
      And the delivery repository counts 0 deleted lines in "a.md" from "c4" to "c4"
      And the delivery repository counts 0 deleted lines in "b.md" from "c1" to "c3"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a remote branch deleted is absent after a fetch
      Given a delivery repository of the <adapter> adapter
      And the delivery repository holds the commit "c1"
      And the delivery remote holds the branch "trial" at the commit "c1"
      When I delete the delivery remote branch "trial"
      And the delivery repository fetches
      Then the delivery remote head of "trial" is undefined

      Examples:
        | adapter   |
        | in-memory |

  Rule: Forge

    Scenario Outline: a hash no run exists for
      Given a delivery forge of the <adapter> adapter
      Then the delivery forge has no run of the commit "0000000000000000000000000000000000000001"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a run is given back with its jobs
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000002" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000002" the run 7, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false},{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a rerun is recorded, and the run is then not completed, without jobs
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000003" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000003" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      When I ask the delivery forge to rerun the failed jobs of the run 9
      Then the delivery forge recorded the rerun of the run 9
      And the delivery forge run of the commit "0000000000000000000000000000000000000003" is not completed and has no jobs

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a rerun changes the run it names and no other
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000011" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      And the delivery forge holds for the commit "0000000000000000000000000000000000000012" the run 10, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false}]'
      Then the delivery forge has no run of the commit "0000000000000000000000000000000000000013"
      And the delivery forge gives for the commit "0000000000000000000000000000000000000011" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      And the delivery forge gives for the commit "0000000000000000000000000000000000000012" the run 10, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false}]'
      When I ask the delivery forge to rerun the failed jobs of the run 9
      Then the delivery forge run of the commit "0000000000000000000000000000000000000011" is not completed and has no jobs
      And the delivery forge gives for the commit "0000000000000000000000000000000000000012" the run 10, completed "yes", with the jobs '[{"name":"gate-linux","conclusion":"success","hadRunner":true,"failedStep":false}]'

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a rerun of a run the forge does not have changes nothing
      Given a delivery forge of the <adapter> adapter
      And the delivery forge holds for the commit "0000000000000000000000000000000000000014" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000014" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'
      When I ask the delivery forge to rerun the failed jobs of the run 77
      Then the delivery forge gives for the commit "0000000000000000000000000000000000000014" the run 9, completed "yes", with the jobs '[{"name":"gate-macos","conclusion":"cancelled","hadRunner":false,"failedStep":false}]'

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a rule suite of a push nobody made, and of one evaluated
      Given a delivery forge of the <adapter> adapter
      And the delivery forge evaluated the push of the commit "0000000000000000000000000000000000000004" to the branch "main" as "<suite>"
      Then the delivery forge rule suite of the branch "main" and the commit "0000000000000000000000000000000000000004" is "<suite>"
      And the delivery forge rule suite of the branch "other" and the commit "0000000000000000000000000000000000000004" is nothing
      And the delivery forge rule suite of the branch "main" and the commit "0000000000000000000000000000000000000005" is nothing

      Examples:
        | adapter   | suite  |
        | in-memory | pass   |
        | in-memory | fail   |
        | in-memory | bypass |

  Rule: Gate

    Scenario Outline: no verdict, then the verdict of a green gate, and the exit code
      Given a delivery gate of the <adapter> adapter
      And the delivery gate leaves the verdict "0000000000000000000000000000000000000006" and exits 0
      Then the delivery gate verdict is nothing
      When I run the delivery gate
      Then the delivery gate exited 0
      And the delivery gate verdict names "0000000000000000000000000000000000000006"

      Examples:
        | adapter   |
        | in-memory |

    Scenario Outline: a red gate gives its exit code
      Given a delivery gate of the <adapter> adapter
      And the delivery gate leaves the verdict "none" and exits 3
      When I run the delivery gate
      Then the delivery gate exited 3
      And the delivery gate verdict is nothing

      Examples:
        | adapter   |
        | in-memory |

  Rule: Clock

    Scenario Outline: a sleep resolves
      Given a delivery clock of the <adapter> adapter
      When I sleep 1 seconds on the delivery clock
      Then the delivery clock sleep resolved

      Examples:
        | adapter   |
        | in-memory |

    Scenario: the in-memory clock counts the seconds and does not wait
      Given a delivery clock of the in-memory adapter
      When I sleep 3600 seconds on the delivery clock
      And I sleep 5 seconds on the delivery clock
      Then the in-memory delivery clock counted 3605 seconds

  Rule: DeliveryLog

    Scenario Outline: the entries appended are kept in order, whole
      Given a delivery log of the <adapter> adapter
      When I append to the delivery log an entry "delivered" of the commit "0000000000000000000000000000000000000007"
      And I append to the delivery log an entry "stopped" of the commit "0000000000000000000000000000000000000008"
      Then the delivery log holds, in order and whole, what was appended

      Examples:
        | adapter   |
        | in-memory |
