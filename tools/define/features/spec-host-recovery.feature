Feature: Recover a Spec host transaction from its durable artifacts

  Scenario Outline: Bind both independent reviews and verify both artifacts on resume
    Then the Spec host verifies the "<case>" terminal projection

    Examples:
      | case           |
      | reviewed       |
      | Define author  |
      | Define review  |
      | Plan author    |
      | Plan review    |
      | changed Define |
      | changed Plan   |

  Scenario Outline: Resume only a matching pending transaction
    Then the Spec host handles the "<case>" transaction

    Examples:
      | case                 |
      | resume without state |
      | new with state       |
      | changed config       |
      | interrupted start    |
      | changed action       |
      | uncertain submission |
      | acknowledged submit  |
      | foreign answer run   |
      | stale answer         |
      | bound answer         |
      | foreign submit run   |

  Scenario Outline: Validate every page of a batch before reserving quota
    Then the Spec host refuses the "<case>" page

    Examples:
      | case                |
      | other run           |
      | initial offset      |
      | paginated question  |
      | count               |
      | total changed       |
      | excess turns        |
      | offset gap          |
      | past total          |
      | next run            |
      | next offset         |
      | next kind           |
      | next batch          |
      | next purpose        |
      | missing last page   |
      | duplicate turn      |
      | surplus duplicate   |

  Scenario Outline: Account for model turns across recovery and provider errors
    Then the Spec host checks "<case>" before accepting a native result

    Examples:
      | case                  |
      | conflicting quota     |
      | authorize error       |
      | changed model         |
      | native billing        |
      | native provider       |
      | native model          |
      | empty text            |
      | native exception      |
      | missing receipt       |
      | recover complete turn |

  Scenario: Persist the transaction before each external operation
    Then the Spec host checkpoints each side effect and safely resubmits recorded writes

  Scenario Outline: Admit every participant before a mixed batch
    Then the Spec host audits the "<case>" mixed batch

    Examples:
      | case                    |
      | exhausted reviewer      |
      | unauthenticated author  |
      | successful panel        |
      | partial receipt mapping |
      | surplus receipts        |
      | ambiguous earlier batch |

  Scenario: Reject a bad producer start before querying its state
    Then the Spec host rejects a malformed producer run identifier

  Scenario: Reuse an immutable written artifact when the producer repeats the request
    Then the Spec host acknowledges the same producer file twice
