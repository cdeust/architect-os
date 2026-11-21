Feature: Host journals append to the private state of the admitted root
  Scenario Outline: A new writer reopens <file> without truncating either history
    Given an admitted state folder and a historical home log named "<file>"
    Then two host journal writers append while the historical file remains untouched

    Examples:
      | file             |
      | usage.jsonl      |
      | deliveries.jsonl |

  Scenario Outline: The journal refuses <defect> without writing a record
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then a journal append refuses "<defect>" without changing the historical log

    Examples:
      | defect                                 |
      | a symbolic link to the historical file |
      | a hard link to the historical file     |
      | a directory at the log path            |
      | a public log                           |
      | an absent shared state directory       |
      | a shared state symlink                 |
      | a public state directory               |
      | a linked intermediate directory        |
      | a root moved behind a symlink          |

  Scenario: Nested journal folders retain the permissions of shared state
    Given an admitted state folder and a historical home log named "deliveries.jsonl"
    Then new nested state directories and their journal are private
    And the state directory rejects non-component names and the filesystem root

  Scenario: A host journal keeps the identity of its open history
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then the host refuses to reopen a replaced or missing journal

  Scenario: A descriptive file cannot place its journal outside state
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then state templates accept only component paths below the shared state

  Scenario: The physical state remains private and reports filesystem errors
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then state lookups reject unmarked spellings and preserve directory errors

  Scenario Outline: The actual descriptor identifies <defect>
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then a private journal rejects "<defect>" on its opened descriptor

    Examples:
      | defect         |
      | another owner  |
      | another device |
      | a special file |

  Scenario Outline: The parent or final name changes at open when <change>
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then the journal rejects "<change>" after the file was opened

    Examples:
      | change                     |
      | the file name moved devices |
      | the file name was replaced |
      | the parent moved devices   |
      | the parent was replaced    |
      | the parent became a link   |

  Scenario: The journal identity includes the device and inode
    Given an admitted state folder and a historical home log named "usage.jsonl"
    Then a journal refuses the same inode number on a replacement device
