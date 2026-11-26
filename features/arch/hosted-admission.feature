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

  Scenario Outline: the base lookup distinguishes an unavailable count from a failed retrieval for <situation>
    Then the Gate fetches its Linux base for "<situation>" with outcome "<outcome>"

    Examples:
      | situation          | outcome  |
      | current            | restored |
      | legacy             | restored |
      | root               | fallback |
      | no run             | fallback |
      | missing            | fallback |
      | expired            | fallback |
      | API error          | error    |
      | malformed          | error    |
      | truncated          | error    |
      | invalid id         | error    |
      | wrong event        | error    |
      | wrong branch       | error    |
      | wrong sha          | error    |
      | artifact API error | error    |
      | download error     | error    |

  Scenario Outline: the judge downloads the producers of its own plan and refuses a run that holds another set: <situation>
    Then the Gate downloads the producers of the plan of the judge alone, for "<situation>"

    Examples:
      | situation                                                |
      | the plan the run followed                                |
      | a run that started fewer lanes, the plan being its lanes |
      | a plan of fewer lanes than the run started               |
      | a plan of more lanes than the run started                |
      | an artifact of a lane outside the plan, without its job  |
      | a job of a lane outside the plan, without its artifact   |
      | a lane job under a name no plan gives                    |
      | a lane artifact under a name no plan gives               |
      | no plan                                                  |
      | an empty plan                                            |
      | a plan that skips a lane                                 |
      | a plan that does not start at the first lane             |
      | a plan that is no list                                   |
      | a plan longer than a matrix                              |

  Scenario: the plan job gives its matrix the lanes of the plan, and nothing that is not a list of lanes
    Then the plan job announces the lanes "[1,2,3]" to its matrix and refuses "[] | [0] | [01] | [1, 2] | [1,2,] | [1000] | 1 | [a] | [1]]"

  Scenario Outline: partial reruns bind the downloaded evidence to its physical producer
    Then the Gate resolves the producer history for "<history>"

    Examples:
      | history                          |
      | repeated reuse                   |
      | missing attempt field            |
      | reuse after a genuine rerun      |
      | genuine rerun                    |
      | genuine rerun without artifact   |
      | conflicting alias artifact       |
      | changed runner                   |
      | changed steps                    |
      | missing completion               |
      | missed newer execution           |
      | copied failed producer           |
      | missing origin                   |
      | missing reused row               |
      | artifact without a job           |
      | duplicate attempt row            |
      | first attempt                    |
