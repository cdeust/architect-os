Feature: DataStore contract
  Every DataStore adapter satisfies the same behaviour: the in-memory store and the SQL store on a real Postgres.

  Scenario Outline: creates a running run and reads it back
    Given the <adapter> data store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{"query":"q"}}'
    And I keep the answer id as "run"
    Then the answer matches '{"service":"memory","tool":"recall","status":"running","input":{"query":"q"}}'
    When I execute "runs.get" with the input '{"run_id":"$run"}'
    Then the answer matches '{"id":"$run","status":"running"}'

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |

  Scenario Outline: orders events by a per-run sequence starting at 0
    Given the <adapter> data store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"run.created","payload":{}}'
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"worker.started","payload":{"image":"x"}}'
    And I execute "runs.events" with the input '{"run_id":"$run"}'
    Then the answer lists events "0 run.created, 1 worker.started"
    And item 1 of the answer matches '{"payload":{"image":"x"}}'

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |

  Scenario Outline: completes a run once and refuses a second completion with INVALID_OPERATION
    Given the <adapter> data store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And I execute "runs.complete" with the input '{"run_id":"$run","status":"ok","result":{"memory_id":"m"}}'
    Then the answer matches '{"status":"ok","result":{"memory_id":"m"}}'
    And the answer has a string field "completed_at"
    When I execute "runs.complete" with the input '{"run_id":"$run","status":"failed","result":null}' and it is refused
    Then the failure code is "INVALID_OPERATION"

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |

  Scenario Outline: reports an unknown run as NOT_FOUND on every run operation
    Given the <adapter> data store
    When I execute "runs.get" with the input '{"run_id":"00000000-0000-4000-8000-000000000000"}' and it is refused
    Then the failure code is "NOT_FOUND"
    When I execute "runs.events" with the input '{"run_id":"00000000-0000-4000-8000-000000000000"}' and it is refused
    Then the failure code is "NOT_FOUND"
    When I execute "runs.appendEvent" with the input '{"run_id":"00000000-0000-4000-8000-000000000000","type":"run.created","payload":{}}' and it is refused
    Then the failure code is "NOT_FOUND"
    When I execute "runs.complete" with the input '{"run_id":"00000000-0000-4000-8000-000000000000","status":"ok","result":null}' and it is refused
    Then the failure code is "NOT_FOUND"

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |

  Scenario Outline: finds inserted memories by text, without non-matching ones, within the limit
    Given the <adapter> data store
    And a unique tag
    When I execute "memory.insert" with the input '{"content":"The deploy key $tag rotates monthly","tags":["ops"]}'
    And I keep the answer id as "first"
    And I execute "memory.insert" with the input '{"content":"alpha $tag two","tags":[]}'
    And I execute "memory.search" with the input '{"query":"key $tag","limit":5}'
    Then the answer ids are "$first"
    And item 0 of the answer matches '{"tags":["ops"]}'
    When I execute "memory.insert" with the input '{"content":"alpha $tag one","tags":[]}'
    And I execute "memory.search" with the input '{"query":"alpha $tag","limit":1}'
    Then the answer has 1 items

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |

  Scenario Outline: ranks by cosine similarity when an embedding is given
    Given the <adapter> data store
    When I execute "memory.insert" with the input '{"content":"far","tags":[],"embedding":"$axis1"}'
    And I execute "memory.insert" with the input '{"content":"near","tags":[],"embedding":"$axis0"}'
    And I execute "memory.search" with the input '{"query":"","embedding":"$axis0","limit":2}'
    Then item 0 of the answer matches '{"content":"near","score":1}'

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |

  Scenario Outline: keeps usage records and sums them per task, layer and model, absent tokens counting 0
    Given the <adapter> data store
    When I execute "usage.append" with the input '{"at":"2026-11-05T10:00:00.000Z","layer":"broker","task":"t1","parent":"c1","status":200,"route":"/v1/messages","model":"m1","input_tokens":10,"output_tokens":5,"cache_read_input_tokens":2,"cache_creation_input_tokens":1}'
    Then the answer has a string field "id"
    When I execute "usage.append" with the input '{"at":"2026-11-05T10:00:01.000Z","layer":"broker","task":"t1","status":200,"model":"m1","input_tokens":1,"output_tokens":1}'
    And I execute "usage.append" with the input '{"at":"2026-11-05T10:00:02.000Z","layer":"client","task":"t1","status":200,"model":"m1","input_tokens":100}'
    And I execute "usage.append" with the input '{"at":"2026-11-05T10:00:03.000Z","layer":"broker","task":"t1","status":400,"error_type":"invalid_request_error"}'
    And I execute "usage.append" with the input '{"at":"2026-11-05T10:00:04.000Z","layer":"broker","task":"t2","status":200,"model":"m2","output_tokens":7}'
    And I execute "usage.aggregate" with the input '{}'
    Then the answer matches:
      """
      [
        {"task":"t1","layer":"broker","requests":1,"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},
        {"task":"t1","layer":"broker","model":"m1","requests":2,"input_tokens":11,"output_tokens":6,"cache_read_input_tokens":2,"cache_creation_input_tokens":1},
        {"task":"t1","layer":"client","model":"m1","requests":1,"input_tokens":100,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},
        {"task":"t2","layer":"broker","model":"m2","requests":1,"input_tokens":0,"output_tokens":7,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}
      ]
      """
    And item 0 of the answer has no field "model"
    When I execute "usage.aggregate" with the input '{"task":"t2"}'
    Then the answer matches '[{"task":"t2","layer":"broker","model":"m2","requests":1}]'
    When I execute "usage.aggregate" with the input '{"limit":2}'
    Then the answer has 2 items
    When I execute "usage.aggregate" with the input '{"task":"t3"}'
    Then the answer has 0 items

    @in-memory
    Examples:
      | adapter   |
      | in-memory |

    @postgres
    Examples:
      | adapter  |
      | postgres |
