Feature: the review verdict contract

  Scenario: the committed JSON schema is exactly the one the contract generates
    Then the committed review verdict schema is the JSON schema of the verdict contract

  Scenario: a valid verdict parses
    When I parse a valid verdict
    Then the parsed verdict is the valid verdict

  Scenario Outline: a broken verdict is refused: <defect>
    When I break a copy of the valid verdict with <defect>
    Then parsing the broken verdict fails

    Examples:
      | defect                       |
      | an unknown level             |
      | an unknown verdict           |
      | a missing verdict            |
      | a missing findings           |
      | a missing not_checked        |
      | a missing level              |
      | a missing file               |
      | a missing line               |
      | a missing quote              |
      | a missing reason             |
      | an extra key at the top      |
      | an extra key in a finding    |
      | a non-integer line           |
      | a missing criteria           |
      | an unknown criterion status  |
      | a criterion id that is not an acceptance id |
      | a missing evidence           |
      | a missing criterion reason   |
      | an extra key in a criterion  |
      | an evidence on line 0        |
      | an evidence quote on two lines |
      | an evidence quote with a carriage return |
      | an empty evidence quote      |
      | an evidence quote of 301 characters |
      | an empty evidence file       |
      | an evidence file of 301 characters |
      | eleven proofs for a criterion |
      | a missing claims             |
      | an unknown claim status      |
      | a claim id that is not a claim id |
      | a claim id with a suffix     |
      | a claim id with a prefix     |
      | a missing claim evidence     |
      | a missing claim reason       |
      | an extra key in a claim      |
      | a claim evidence quote on two lines |
      | eleven proofs for a claim    |

  Scenario Outline: blocks: <case>
    Given a verdict "<verdict>" with finding levels "<levels>"
    Then the verdict blocks is <blocks>

    Examples:
      | case                              | verdict         | levels                  | blocks |
      | accept without finding            | accept          |                         | false  |
      | accept with a proposal only       | accept          | proposal                | false  |
      | accept with a correctness         | accept          | proposal,correctness    | true   |
      | accept with a contradiction       | accept          | contradiction           | true   |
      | request_changes                   | request_changes | proposal                | true   |

  Scenario: an evidence of 300 characters and ten proofs for a criterion parse
    Then a verdict of 300 quote characters on the boundary parses

  Scenario Outline: blocks on criteria: <case>
    Given a verdict "accept" with criteria statuses "<statuses>"
    Then the verdict blocks is <blocks>

    Examples:
      | case                         | statuses            | blocks |
      | every criterion met          | met,met             | false  |
      | one criterion unmet          | met,unmet           | true   |
      | one criterion not established | not_established,met | true   |

  Scenario Outline: blocks on claims: <case>
    Given a verdict "accept" with claim statuses "<statuses>"
    Then the verdict blocks is <blocks>

    Examples:
      | case                    | statuses             | blocks |
      | every claim verified    | verified,verified    | false  |
      | one claim refuted       | verified,refuted     | true   |
      | one claim not checked   | not_checked,verified | true   |

  Scenario Outline: the host checks the claims of a verdict against the build: <case>
    Then the claims of the valid verdict against "<ids>" are refused with: <reason>

    Examples:
      | case                 | ids       | reason                                                          |
      | exactly the build's  | CL-1      | none                                                            |
      | a build without claim |          | revendications du verdict ["CL-1"], attendues []                |
      | a claim left out     | CL-1 CL-2 | revendications du verdict ["CL-1"], attendues ["CL-1","CL-2"]   |
      | another claim        | CL-2      | revendications du verdict ["CL-1"], attendues ["CL-2"]          |

  Scenario Outline: the evidence of a claim: <case>
    Then a verdict whose claim "<status>" cites '<evidence>' is refused with: "<reason>"

    Examples:
      | case                                  | status      | evidence                                                      | reason                                               |
      | a verified claim with its line        | verified    | [{"file":"src/a.ts","line":12,"quote":"x = 1"}]               | none                                                 |
      | a verified claim without proof        | verified    | []                                                            | CL-1 verified sans preuve                            |
      | a refuted claim without proof         | refuted     | []                                                            | CL-1 refuted sans preuve                             |
      | a claim not checked without proof     | not_checked | []                                                            | none                                                 |
      | a refuted claim whose quote is absent | refuted     | [{"file":"src/a.ts","line":12,"quote":"y = 2"}]               | CL-1 : preuve refusée (citation absente de la ligne) |
      | a claim not checked citing a lost file | not_checked | [{"file":"src/b.ts","line":1,"quote":"x"}]                   | CL-1 : preuve refusée (fichier absent)               |
      | a second proof that is wrong          | verified    | [{"file":"src/a.ts","line":12,"quote":"x"},{"file":"src/a.ts","line":11,"quote":"x = 1"}] | CL-1 : preuve refusée (citation absente de la ligne) |

  Scenario: the host checks the proofs of every claim, not only of the first
    Then a verdict whose second claim cites a line the host does not find is refused with: "CL-2 : preuve refusée (citation absente de la ligne)"

  Scenario Outline: the host checks the criteria of a verdict against the Step: <case>
    Then the criteria of the valid verdict against "<ids>" are refused with: <reason>

    Examples:
      | case                     | ids           | reason                                                       |
      | exactly the Step's       | AC-001        | none                                                         |
      | a Step without criteria  |               | critères du verdict ["AC-001"], attendus []                  |
      | a criterion left out     | AC-001 AC-002 | critères du verdict ["AC-001"], attendus ["AC-001","AC-002"] |
      | another criterion        | AC-002        | critères du verdict ["AC-001"], attendus ["AC-002"]          |

  Scenario: the acceptance block lists each identifier as a JSON string, in order
    Then the acceptance block for "AC-002 AC-001" is:
      """
      ## Acceptance criteria the verdict covers

      The host requires `criteria` to give one entry for each identifier below, in this order, and no other.

      - "AC-002"
      - "AC-001"
      """
