Feature: Hosted runtime admission
  Scenario: each hosted runner privately provisions its own root
    Then separate hosted jobs publish only their own private marked root and refuse reuse

  Scenario: every invocation in a hosted job allocates a fresh run
    Then two payloads in a hosted job receive distinct matching admission receipts

  Scenario Outline: the host removes the broker credential after <outcome> exchange
    Given the committed workflow "broker-live.yml"
    Then the broker workflow removes its synthetic credential after <outcome> exchange

    Examples:
      | outcome    |
      | successful |
      | failed     |

  Scenario: hosted npm install disables the package lifecycle
    Given the committed workflow "watch.yml"
    Then the hosted install leaves the lifecycle witness untouched

  Scenario: Provider access stays inside the admitted retrieval steps
    Then every Gate download keeps its token scoped to an admitted retrieval step

  Scenario Outline: Gate restores evidence through admission for <source>
    Then the "<source>" Gate download refuses before touching reports and restores its own evidence when admitted

    Examples:
      | source     |
      | linux base |
      | macos base |
      | lane       |
      | aggregate  |
