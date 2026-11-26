Feature: The full Linux gate publishes its checked commit and artifacts under private durable state

  Background:
    Given a private Gate state and a checkout with a green Linux proof

  Scenario: A later admission can verify the previous full gate after its run is gone
    Then the Gate receipt carries the original report, base, commit and directory identities

  Scenario: Interrupted publication cannot replace the last complete proof
    Then a failed Gate publication keeps the previous receipt and removes its partial copy

  Scenario Outline: publish verifies <kind>
    Then the Gate refuses to publish an invalid "<kind>" and keeps its previous receipt

    Examples:
      | kind |
      | job |
      | base commit |
      | count |
      | negative count |
      | shape |
      | pickles |
      | sha |
      | red report |
      | report commit |
      | workflow prefix |
      | report line |
      | run directory |
      | run name |
      | regular checkout |
      | regular root |

  Scenario Outline: read verifies <kind>
    Then the Gate reader refuses a "<kind>" receipt

    Examples:
      | kind |
      | version |
      | job |
      | commit |
      | run identifier |
      | uppercase sha |
      | malformed sha prefix |
      | malformed sha suffix |
      | root device |
      | root inode |
      | checkout device |
      | checkout inode |
      | digest |
      | report bytes |
      | base bytes |
      | green digest over red bytes |
      | extra field |
      | linked directory |
      | linked root |
      | separate checkout |
      | hardlinked |
      | linked |
      | readable by another account |
      | extra permission bits |
      | malformed |
      | directory at latest |

  Scenario Outline: Physical receipt evidence handles <case>
    Then the retained Gate receipt exercises "<case>"

    Examples:
      | case |
      | private durability |
      | physical identities |
      | unsafe state directory |
      | alternate uid |
      | alternate device |
      | changed named inode |
      | changed named device |
      | moved parent after reading |
      | missing receipt |
      | invalid encoding option |
      | incomplete hash prefix |
      | incomplete hash suffix |
      | run prefix |
      | run suffix |
      | invalid directory message |
      | invalid proof message |

  Scenario: a checked receipt gives the destination commit its report names
    Then a checked Gate receipt whose report names the destination "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" reads as that commit and its destination

  Scenario Outline: the destination commit of a report: <case>
    Then the destination of the Gate report "<report>" is "<destination>"

    Examples:
      | case                              | report                                                                                                   | destination |
      | the line of the report            | # V{lf}- tête : x{lf}- destination : refs/remotes/origin/main à aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 2 commit(s) jugé(s){lf} | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |
      | no commit of the destination      | - destination : refs/remotes/origin/main à aucune, 0 commit(s) jugé(s)                                   | none |
      | no line of the destination        | # V{lf}- tête : aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa                                                                                     | none |
      | a commit of 39 characters         | - destination : refs/remotes/origin/main à aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 1 commit(s) jugé(s)                                 | none |
      | a commit in upper case            | - destination : refs/remotes/origin/main à AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA, 1 commit(s) jugé(s)                              | none |
      | a line that does not start with it | x- destination : refs/remotes/origin/main à aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 1 commit(s) jugé(s)                                    | none |
      | a reference with a space          | - destination : refs main à aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 1 commit(s) jugé(s)                                                     | none |
      | a commit of 41 characters         | - destination : refs/remotes/origin/main à aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 1 commit(s) jugé(s)                                     | none |
