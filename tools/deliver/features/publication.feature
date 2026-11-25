Feature: The destinations move only on the owner's approval of the exact commit, and no run passes over it in silence

  Publication is phase 5: the push of the commit to the branches of the descriptive file. The trial branch, the gate
  and the CI come before it and publish nothing. The background of each scenario holds the owner's approval of the
  publication of "h1" in "cdeust/architect-os", written by `tools/deliver/approve` into the owner's directory of the
  scenario; a scenario removes or changes it.

  Background:
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"

  Scenario: the approved commit is published (positive control of the refusals below)
    When I run the delivery command with "step"
    Then the delivery command exited 0
    And the remote of the delivery command holds "feat/gate-1a" at the commit "h1"
    And the remote of the delivery command holds "main" at the commit "h1"

  Scenario: without an approval, a delivery to its end stops before the trial branch
    Given the delivery owner withdraws the publication approval
    When I run the delivery command with "step"
    Then the delivery preflight refused "publication sans approbation du propriétaire" without a trial
    And the remote of the delivery command holds "main" at the commit "p0"
    And the home of the delivery command holds no delivery log

  Scenario Outline: an approval of another commit or another repository is refused by name
    Given the delivery owner approves the publication of "<commit>" in "<repository>"
    When I run the delivery command with "step"
    Then the delivery preflight refused "approbation de publication d'un autre commit" without a trial
    And the remote of the delivery command holds "main" at the commit "p0"

    Examples:
      | commit | repository          |
      | p0     | cdeust/architect-os |
      | h1     | another/repository  |

  Scenario Outline: an approval given <ago> seconds ago for <life> seconds is refused by name
    Given the delivery owner record of publication was given <ago> seconds ago for <life> seconds
    When I run the delivery command with "step"
    Then the delivery preflight refused "<reason>" without a trial

    Examples:
      | ago   | life   | reason                                   |
      | 7200  | 7199   | approbation de publication périmée       |
      | 7200  | 3600   | approbation de publication périmée       |
      | 60    | 86401  | approbation de publication non recevable |
      | -600  | 3600   | approbation de publication non recevable |

  Scenario: an approval given an hour ago for two hours still publishes (positive control of the bounds)
    Given the delivery owner record of publication was given 3600 seconds ago for 7200 seconds
    When I run the delivery command with "step"
    Then the delivery command exited 0
    And the remote of the delivery command holds "main" at the commit "h1"

  Scenario: a maintenance record in the place of the publication record is not receivable
    Given the delivery owner record of publication has "kind" set to '"maintenance"'
    When I run the delivery command with "step"
    Then the delivery preflight refused "approbation de publication non recevable" without a trial

  Scenario Outline: an approval that someone else than the owner could have written is refused by name
    Given the owner's approval directory of the delivery command is altered: <change>
    When I run the delivery command with "step"
    Then the delivery preflight refused "approbation de publication non recevable" without a trial

    Examples:
      | change                        |
      | the record writable by all    |
      | the directory writable by all |
      | the owner another uid         |

  Scenario: a record supplied from the worktree, or named by the environment, grants no publication
    Given only the candidate holds exact publication records
    When I run the delivery command with "step"
    Then the delivery preflight refused "publication sans approbation du propriétaire" without a trial

  Scenario: until the CI, no approval is asked, the receipt says so, and no destination moves
    Given the delivery owner withdraws the publication approval
    When I run the delivery command with "step --until ci"
    Then the delivery command exited 0
    And the delivery command printed on its standard output:
      """
      {"outcome":"ready","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":1,"polls":1,"run":42},"gate":"ran","approval":"until-ci","published":[],"ruleSuites":{}}
      """
    And the remote of the delivery command holds "sentinel/gate-1a-step" at the commit "h1"
    And the remote of the delivery command holds "feat/gate-1a" at the commit "p0"
    And the remote of the delivery command holds "main" at the commit "p0"
    And the log of the delivery command holds 1 lines

  Scenario: an approval withdrawn while the gate runs stops the run before the first destination
    Given the gate of the delivery command withdraws the publication approval when it runs
    When I run the delivery command with "step"
    Then the delivery command exited 1
    And the delivery command wrote on its standard error:
      """
      préalables
      branche d'essai
      porte
      CI
      publication
      stopped at publication: publication sans approbation du propriétaire
      """
    And the remote of the delivery command holds "feat/gate-1a" at the commit "p0"
    And the remote of the delivery command holds "main" at the commit "p0"
    And the log of the delivery command holds 1 lines

  Rule: the owner's command writes the one record the delivery reads

    Scenario Outline: the owner approves a commit for <hours> hours, and the delivery then publishes it
      Given the delivery owner withdraws the publication approval
      When the owner runs the approval command with "<arguments>"
      Then the approval command wrote the publication record of "h1" for <hours> hours
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the remote of the delivery command holds "main" at the commit "h1"

      Examples:
        | arguments                                   | hours |
        | publication cdeust/architect-os HASH        | 24    |
        | publication cdeust/architect-os HASH 1      | 1     |

    Scenario: the owner approves a maintenance with its intent
      When the owner runs the approval command with "maintenance cdeust/architect-os HASH Require_the_macOS_job 2"
      Then the approval command wrote the maintenance record of "h1" for 2 hours

    Scenario Outline: the owner's command refuses "<arguments>" and writes nothing
      When the owner runs the approval command with '<arguments>'
      Then the approval command refused with "<code>" and wrote nothing

      Examples:
        | arguments                                              | code                       |
        | publication cdeust/architect-os                        | USAGE                      |
        | publish cdeust/architect-os HASH                       | USAGE                      |
        | publication cdeust/architect-os HASH 24 extra          | USAGE                      |
        | maintenance cdeust/architect-os HASH                   | USAGE                      |
        | publication cdeust HASH                                | APPROVE_REPOSITORY_REFUSED |
        | publication a/b/c HASH                                 | APPROVE_REPOSITORY_REFUSED |
        | publication ../b HASH                                  | APPROVE_REPOSITORY_REFUSED |
        | publication a/.. HASH                                  | APPROVE_REPOSITORY_REFUSED |
        | publication a/b"c HASH                                 | APPROVE_REPOSITORY_REFUSED |
        | publication cdeust/architect-os 0123                   | APPROVE_COMMIT_REFUSED     |
        | publication cdeust/architect-os HASH0                  | APPROVE_COMMIT_REFUSED     |
        | publication cdeust/architect-os ABCDEF0123ABCDEF0123ABCDEF0123ABCDEF0123 | APPROVE_COMMIT_REFUSED |
        | publication cdeust/architect-os HASH 0                 | APPROVE_HOURS_REFUSED      |
        | publication cdeust/architect-os HASH 024               | APPROVE_HOURS_REFUSED      |
        | publication cdeust/architect-os HASH 169               | APPROVE_HOURS_REFUSED      |
        | publication cdeust/architect-os HASH 1.5               | APPROVE_HOURS_REFUSED      |
        | maintenance cdeust/architect-os HASH ___               | APPROVE_INTENT_REQUIRED    |
        | maintenance cdeust/architect-os HASH say_"yes"         | APPROVE_INTENT_REFUSED     |
        | maintenance cdeust/architect-os HASH back\\slash       | APPROVE_INTENT_REFUSED     |

    Scenario: without a directory named for a scenario, the owner's command writes only as root
      When the approval command is run as this user into the owner directory
      Then the approval command refused with "APPROVE_REQUIRES_ROOT" and wrote nothing
