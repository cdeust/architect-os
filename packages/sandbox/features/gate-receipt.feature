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
