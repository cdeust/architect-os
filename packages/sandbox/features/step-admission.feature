Feature: The Step admission receipt binds the approved work and its launcher

  Scenario: Accept the exact approved subject and every required role
    Then the Step admission matches the approved tree, digests and role models

  Scenario Outline: Refuse an independently changed subject
    Then Step admission refuses a changed "<field>"

    Examples:
      | field              |
      | step name          |
      | worktree           |
      | commit             |
      | tree               |
      | clean flag         |
      | input bytes        |
      | launcher bytes     |
      | approved manifest  |
      | Define digest      |
      | proposal digest    |
      | reviewed Plan      |
      | Define review      |
      | Plan review        |
      | missing review     |
      | renamed scout      |
      | build model        |

  Scenario Outline: Match each source and input in the approved manifest to the Step
    Then Step admission refuses approved manifest field "<field>" for a different input

    Examples:
      | field         |
      | step          |
      | define        |
      | proposal      |
      | reviewed_plan |
      | files         |

  Scenario: Unordered digest keys retain the approved input identity
    Then Step admission accepts reverse-ordered file digest keys

  Scenario: Resolve the fixed location of host admission receipts
    Then the Step authority is located in the operating-system user's configuration directory

  Scenario: Read the exact receipt and close its descriptor
    Then the Step host reads private UTF-8 authority bytes through a single protected descriptor

  Scenario Outline: Refuse unusable authority bytes before Step execution
    Then the Step authority reader refuses "<condition>"

    Examples:
      | condition                   |
      | missing path                |
      | relative path               |
      | different parent            |
      | worktree authority          |
      | shared directory            |
      | shared receipt              |
      | extra hard link             |
      | directory receipt           |
      | oversized receipt           |
      | invalid UTF-8               |
      | invalid JSON                |

  Scenario Outline: Enforce the exact one-mebibyte byte limit at its boundary
    Then an authority receipt of <size> bytes is "<decision>"

    Examples:
      | size    | decision |
      | 1048575 | accepted |
      | 1048576 | accepted |
      | 1048577 | refused  |

  Scenario: Freeze only the supplied launcher files and dispose the private copy
    Then the frozen Step launcher is a private read-only snapshot with its original file layout

  Scenario Outline: Reject ownership or size observations that no longer match the opened receipt
    Then the Step authority rejects a descriptor with "<observation>" and closes it

    Examples:
      | observation       |
      | other file owner  |
      | grew during read  |
      | shrank during read |

  Scenario Outline: Refuse a parent that cannot act as a private authority directory
    Then Step authority refuses parent observation "<observation>" before opening the receipt

    Examples:
      | observation    |
      | wrong owner    |
      | not directory  |

  Scenario Outline: Abandon partial launcher copies and preserve the failing cause
    Then the frozen launcher cleans its temporary directory after "<condition>"

    Examples:
      | condition                   |
      | copy inside worktree        |
      | noncanonical file name      |
      | storage failure             |

  Scenario: A build-only Step binds no scout or review launcher
    Then a build-only Step admission verifies using only the build launcher files

  Scenario: Unavailable Step input bytes are not an approved empty file
    Then Step admission rejects a missing input value when an empty file was approved

  Scenario: A specimen may both admit and refuse independent cases
    Then Step admission accepts a specimen with successful pass and refuse replays

  Scenario Outline: Every replay must match its own expected verdict and findings
    Then Step admission refuses a specimen with "<discrepancy>"

    Examples:
      | discrepancy           |
      | duplicate case ID     |
      | changed case digest   |
      | different verdict     |
      | different findings    |
      | different model route |
      | different prompt      |

  Scenario Outline: Keep each layer of the approved receipt bound to its subject
    Then Step admission rejects receipt discrepancy "<discrepancy>"

    Examples:
      | discrepancy               |
      | changed approval digest   |
      | changed Step name         |
      | changed manifest approval |
      | changed input hashes      |
      | different Define for Plan |
      | shared review provider    |
      | shared review model       |
      | prefixed oracle digest    |
      | suffixed oracle digest    |

  Scenario Outline: Require the canonical authority and receipt paths
    Then Step authority rejects a changed canonical "<location>" before opening the receipt

    Examples:
      | location  |
      | directory |
      | receipt   |

  Scenario: A host without an effective user identity cannot authorize a Step
    Then Step authority refuses a platform without a user identity
