Feature: The admission policy tools/runtime/admission.json (a descriptive file: its schema, the committed copy, and every broken copy)
  The policy names exactly three environments an installer may write in the marker of a root, each with a floor for
  the filesystem of the root and one for the filesystem of the actual home, as canonical positive decimal strings of
  bytes. Every reserve is provisional until step 4 measures the peaks (docs/design/orchestration-fable-5-2.md §14).

  Scenario: the committed runtime admission policy loads with its three provisional reserves
    When the committed runtime admission policy is decoded
    Then the runtime admission policy is accepted with version 1
    And the runtime reserve of "workstation" has a root floor of "34359738368" bytes and a home floor of "17179869184" bytes
    And the runtime reserve of "hosted-runner" has a root floor of "4294967296" bytes and a home floor of "2147483648" bytes
    And the runtime reserve of "server" has a root floor of "68719476736" bytes and a home floor of "17179869184" bytes
    And every runtime reserve is provisional, with a basis, and a review that names step 4

  Scenario Outline: a copy of the runtime admission policy with <path> set to <value> is rejected at <field>
    Given a copy of the committed runtime admission policy
    When the runtime policy copy has <path> set to <value>
    Then the runtime policy copy is rejected at "<field>"

    Examples:
      | path                                         | value         | field                                         |
      | version                                      | 2             | $.version                                     |
      | version                                      | "1"           | $.version                                     |
      | description                                  | ""            | $.description                                 |
      | description                                  | " "           | $.description                                 |
      | description                                  | 1             | $.description                                 |
      | extra                                        | 1             | $.extra                                       |
      | environments                                 | []            | $.environments                                |
      | environments                                 | null          | $.environments                                |
      | environments.laptop                          | {}            | $.environments.laptop                         |
      | environments.workstation                     | "x"           | $.environments.workstation                    |
      | environments.workstation.extra               | 1             | $.environments.workstation.extra              |
      | environments.workstation.rootFloorBytes      | "0"           | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "-1"          | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "+1"          | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "01"          | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "1.5"         | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "1e9"         | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | " 1"          | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "1 "          | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | "0x10"        | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | ""            | $.environments.workstation.rootFloorBytes     |
      | environments.workstation.rootFloorBytes      | 1024          | $.environments.workstation.rootFloorBytes     |
      | environments.hosted-runner.homeFloorBytes    | "0"           | $.environments.hosted-runner.homeFloorBytes   |
      | environments.hosted-runner.homeFloorBytes    | "2GiB"        | $.environments.hosted-runner.homeFloorBytes   |
      | environments.server.homeFloorBytes           | null          | $.environments.server.homeFloorBytes          |
      | environments.server.status                   | "measured"    | $.environments.server.status                  |
      | environments.server.basis                    | ""            | $.environments.server.basis                   |
      | environments.server.basis                    | 1             | $.environments.server.basis                   |
      | environments.hosted-runner.review            | "\t"          | $.environments.hosted-runner.review           |
      | environments.hosted-runner.review            | ["step 4"]    | $.environments.hosted-runner.review           |

  Scenario Outline: a copy of the runtime admission policy without <path> is rejected at <field>
    Given a copy of the committed runtime admission policy
    When the runtime policy copy has no <path>
    Then the runtime policy copy is rejected at "<field>"

    Examples:
      | path                                    | field                                       |
      | description                             | $.description                               |
      | version                                 | $.version                                   |
      | environments                            | $.environments                              |
      | environments.workstation                | $.environments.workstation                  |
      | environments.hosted-runner              | $.environments.hosted-runner                |
      | environments.server                     | $.environments.server                       |
      | environments.server.rootFloorBytes      | $.environments.server.rootFloorBytes        |
      | environments.workstation.homeFloorBytes | $.environments.workstation.homeFloorBytes   |
      | environments.workstation.status         | $.environments.workstation.status           |
      | environments.hosted-runner.basis        | $.environments.hosted-runner.basis          |
      | environments.server.review              | $.environments.server.review                |

  Scenario Outline: a runtime policy text that is <form> is rejected as a whole
    When the runtime policy text '<text>' is decoded
    Then the runtime policy copy is rejected at "$"

    Examples:
      | form         | text       |
      | not JSON     | {"version" |
      | empty        |            |
      | an array     | []         |
      | a string     | "policy"   |
      | null         | null       |

  Scenario: a runtime policy copy whose floors are the smallest canonical values is accepted
    Given a copy of the committed runtime admission policy
    When the runtime policy copy has environments.server.rootFloorBytes set to "1"
    And the runtime policy copy has environments.server.homeFloorBytes set to "9"
    Then the runtime admission policy copy is accepted, with the server floors 1 and 9 bytes

  Scenario: a runtime policy copy with a floor above the precision of a JavaScript number keeps every byte
    Given a copy of the committed runtime admission policy
    When the runtime policy copy has environments.workstation.rootFloorBytes set to "9007199254740993"
    Then the runtime admission policy copy is accepted, with the workstation root floor 9007199254740993 bytes
