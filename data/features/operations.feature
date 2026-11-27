Feature: Data operations
  The use cases validate every input and output against the contracts before and after the store.

  Scenario: runs the lifecycle create, appendEvent, complete
    Given data operations over an in-memory store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"run.created"}'
    And I execute "runs.complete" with the input '{"run_id":"$run","status":"ok","result":{"a":1}}'
    And I execute "runs.events" with the input '{"run_id":"$run"}'
    Then the answer has 1 items
    When I execute "runs.get" with the input '{"run_id":"$run"}'
    Then the answer matches '{"status":"ok"}'

  Scenario: rejects input that does not match the contract schema with INVALID_INPUT
    Given data operations over an in-memory store
    When I execute "runs.create" with the input '{"service":1}' and it is refused
    Then the failure code is "INVALID_INPUT"
    When I execute "runs.complete" with the input '{"run_id":"not-a-uuid","status":"ok","result":null}' and it is refused
    Then the failure code is "INVALID_INPUT"
    When I execute "memory.insert" with the input '{"content":"x","embedding":[1,2]}' and it is refused
    Then the failure code is "INVALID_INPUT"

  Scenario: accepts an embedding of the contract dimension
    Given data operations over an in-memory store
    When I execute "memory.insert" with the input '{"content":"x","embedding":"$filled0.5"}'
    Then the answer has the field "id"

  Scenario: refuses a store answer that breaks the output contract
    Given data operations over a store that always answers '{"nope":true}'
    When I execute "memory.insert" with the input '{"content":"x"}' and it is refused
    Then the failure message contains "outside its contract"

  Scenario: knows exactly the typed operations and no raw SQL operation
    Given data operations over an in-memory store
    Then the operations know "runs.create"
    And the operations do not know "sql"
    And the operations do not know "query"

  Scenario: inserts and searches memory
    Given data operations over an in-memory store
    When I execute "memory.insert" with the input '{"content":"hello world"}'
    And I execute "memory.search" with the input '{"query":"hello"}'
    Then the answer has 1 items

  Scenario Outline: refuses a usage record <defect> with INVALID_INPUT
    Given data operations over an in-memory store
    When I execute "usage.append" with the input '<input>' and it is refused
    Then the failure code is "INVALID_INPUT"

    Examples:
      | defect                     | input                                                                                              |
      | without a layer            | {"at":"2026-11-05T10:00:00.000Z","task":"t1","status":200}                                         |
      | of an unknown layer        | {"at":"2026-11-05T10:00:00.000Z","layer":"worker","task":"t1","status":200}                        |
      | with negative tokens       | {"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200,"input_tokens":-1}      |
      | with a field of content    | {"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","status":200,"content":"x"}          |

  Scenario: bounds the groups of an aggregate: at most 1000, 100 by default
    Given data operations over an in-memory store
    When I execute "usage.aggregate" with the input '{"limit":1001}' and it is refused
    Then the failure code is "INVALID_INPUT"
    When I execute "usage.aggregate" with the input '{"limit":0}' and it is refused
    Then the failure code is "INVALID_INPUT"
    When I execute "usage.aggregate" with the input '{"limit":1000}'
    Then the answer has 0 items

  Scenario Outline: keeps a usage record of the layer <layer>
    Given data operations over an in-memory store
    When I execute "usage.append" with the input '{"at":"2026-11-05T10:00:00.000Z","layer":"<layer>","task":"t1","status":200}'
    And I execute "usage.aggregate" with the input '{}'
    Then the answer matches '[{"task":"t1","layer":"<layer>","requests":1}]'

    Examples:
      | layer  |
      | broker |
      | client |

  Scenario: refuses to complete a run with the status running
    Given data operations over an in-memory store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And I execute "runs.complete" with the input '{"run_id":"$run","status":"running","result":null}' and it is refused
    Then the failure code is "INVALID_INPUT"

  Scenario Outline: refuses a Step operation <defect> with INVALID_INPUT
    Given data operations over an in-memory store
    And the variable "mebibyte" holds 1048576 bytes in base64
    And the variable "beyond" holds 1048577 bytes in base64
    When I execute "steps.reserve" with the input '{"run":"r","step":"s"}'
    And I execute "<op>" with the input '<input>' and it is refused
    Then the failure code is "INVALID_INPUT"

    Examples:
      | defect                                   | op                   | input                                                                                    |
      | with a step name that is not one         | steps.reserve        | {"run":"r","step":"../s"}                                                                |
      | with a step name longer than 32          | steps.reserve        | {"run":"r","step":"abcdefghijklmnopqrstuvwxyz0123456"}                                   |
      | with a step name that ends badly         | steps.reserve        | {"run":"r","step":"s.x"}                                                                 |
      | with an empty run                        | steps.get            | {"run":"","step":"s"}                                                                    |
      | with an unknown event type               | steps.appendEvent    | {"run":"r","step":"s","type":"phase.skipped","phase":"build"}                            |
      | with an unknown phase                    | steps.appendEvent    | {"run":"r","step":"s","type":"phase.started","phase":"commit"}                           |
      | with an event of free text               | steps.appendEvent    | {"run":"r","step":"s","type":"phase.started","phase":"build","text":"x"}                 |
      | of an unknown kind                       | steps.recordArtifact | {"run":"r","step":"s","kind":"record","bytes":""}                               |
      | of a session kind without a name         | steps.recordArtifact | {"run":"r","step":"s","kind":"check","bytes":""}                                |
      | of a kind one per Step with a name       | steps.recordArtifact | {"run":"r","step":"s","kind":"build.report","name":"x","bytes":""}              |
      | with a name that is not one              | steps.recordArtifact | {"run":"r","step":"s","kind":"check","name":"A.b","bytes":""}                   |
      | with a name that ends badly              | steps.recordArtifact | {"run":"r","step":"s","kind":"check","name":"a.b","bytes":""}                   |
      | whose content is not base64              | steps.recordArtifact | {"run":"r","step":"s","kind":"build.report","bytes":"not base64!"}              |
      | of more than 1 MiB                       | steps.recordArtifact | {"run":"r","step":"s","kind":"build.report","bytes":"$beyond"}                  |

  Scenario: explains why a Step artifact is refused by its contract
    Given data operations over an in-memory store
    And the variable "beyond" holds 1048577 bytes in base64
    When I execute "steps.reserve" with the input '{"run":"r","step":"s"}'
    And I execute "steps.recordArtifact" with the input '{"run":"r","step":"s","kind":"build.report","bytes":"$beyond"}' and it is refused
    Then the failure code is "INVALID_INPUT"
    And the failure message contains "more than 1048576 bytes"
    When I execute "steps.recordArtifact" with the input '{"run":"r","step":"s","kind":"check","bytes":""}' and it is refused
    Then the failure code is "INVALID_INPUT"
    And the failure message contains "a kind of a session or a check carries a name, the others none"

  Scenario: keeps a Step artifact of exactly 1 MiB, and its bytes
    Given data operations over an in-memory store
    And the variable "mebibyte" holds 1048576 bytes in base64
    When I execute "steps.reserve" with the input '{"run":"r","step":"abcdefghijklmnopqrstuvwxyz012345"}'
    And I execute "steps.appendEvent" with the input '{"run":"r","step":"abcdefghijklmnopqrstuvwxyz012345","type":"phase.ended","phase":"reviews"}'
    Then the answer matches '{"seq":0,"type":"phase.ended","phase":"reviews"}'
    When I execute "steps.recordArtifact" with the input '{"run":"r","step":"abcdefghijklmnopqrstuvwxyz012345","kind":"build.report","bytes":"$mebibyte"}'
    And I execute "steps.get" with the input '{"run":"r","step":"abcdefghijklmnopqrstuvwxyz012345"}'
    Then the answer matches '{"artifacts":[{"kind":"build.report","bytes":"$mebibyte"}]}'

  Scenario: refuses a store answer whose artifact digest is not a SHA-256
    Given data operations over a store that always answers '{"run":"r","step":"s","kind":"build.report","sha256":"abc","recorded_at":"2026-11-26T10:00:00.000Z"}'
    When I execute "steps.recordArtifact" with the input '{"run":"r","step":"s","kind":"build.report","bytes":""}' and it is refused
    Then the failure message contains "outside its contract"
