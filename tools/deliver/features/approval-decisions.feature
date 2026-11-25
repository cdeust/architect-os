Feature: The decision on an approval of the owner: this repository, this commit, now, for no longer than the policy allows

  The record is decided against the repository "cdeust/architect-os", the commit HASH, the time 1000 and a policy of
  3600 seconds; the times of a record are written relative to 1000.

  Scenario Outline: for <kind>, a record "<record>" decides "<decision>"
    Then for <kind> a record "<record>" decides "<decision>"

    Examples:
      | kind        | record                                     | decision                                                |
      | publication | present cdeust/architect-os HASH -10 3590  | approved                                                |
      | publication | present cdeust/architect-os HASH 0 1       | approved                                                |
      | publication | present cdeust/architect-os HASH -3599 1   | approved                                                |
      | publication | absent                                     | publication sans approbation du propriétaire            |
      | publication | untrusted                                  | approbation de publication non recevable                |
      | publication | present cdeust/architect-os HASH0 -10 100  | approbation de publication d'un autre commit            |
      | publication | present another/repository HASH -10 100    | approbation de publication d'un autre commit            |
      | publication | present cdeust/architect-os HASH -10 0     | approbation de publication périmée                      |
      | publication | present cdeust/architect-os HASH -3600 -1  | approbation de publication périmée                      |
      | publication | present cdeust/architect-os HASH -10 3591  | approbation de publication non recevable                |
      | publication | present cdeust/architect-os HASH 1 100     | approbation de publication non recevable                |
      | publication | present cdeust/architect-os HASH -10 -10   | approbation de publication non recevable                |
      | publication | present cdeust/architect-os HASH -10 -11   | approbation de publication non recevable                |
      | maintenance | present cdeust/architect-os HASH -10 3590  | approved                                                |
      | maintenance | absent                                     | modification du juge sans approbation de maintenance    |
      | maintenance | untrusted                                  | approbation de maintenance non recevable                |
      | maintenance | present cdeust/architect-os HASH0 -10 100  | approbation de maintenance d'un autre commit            |
      | maintenance | present another/repository HASH -10 100    | approbation de maintenance d'un autre commit            |
      | maintenance | present cdeust/architect-os HASH -10 0     | approbation de maintenance périmée                      |
      | maintenance | present cdeust/architect-os HASH -10 3591  | approbation de maintenance non recevable                |
      | maintenance | present cdeust/architect-os HASH 1 100     | approbation de maintenance non recevable                |
