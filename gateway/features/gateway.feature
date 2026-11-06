Feature: the gateway routes the calls of a task to its modules, within the bounds of the task (docs/design/platform-v3-srt.md, §2, brick 1b.4)
  A client opens a task under its profile; the profile fixes its deadline, its number of calls and its depth. Each call
  of a module gets an opaque call identifier, tied to its task, its caller, its depth and its deadline (the shortest of
  the deadline of its parent and the timeout_ms of the module), invalidated at its return. A module calls back with it,
  to a module of its calls_allowed or to a data operation whose tables are in its writes_tables: the gateway takes the
  task and the caller from the identifier, never from an argument. A bound reached, or the cancellation by the owner,
  ends the task: its calls in flight are cancelled and their identifiers invalidated, its token retired, its sandboxes
  stopped and its end written to the registry; nothing of it is routed afterwards, verify included. Every call and every
  refusal is written to the audit log with its code. Here the modules, data, the registry, the broker, the sandboxes and
  the time are the in-memory adapters of their ports; a module answers its name, its tool and its
  arguments, and data the operation and its arguments.

  Background:
    Given the gateway over the topology gateway/features/fixtures/topology.json
    And the client "cli" opened the task "task-1" with the profile "local"

  Scenario: a call of the client reaches its module with a fresh call identifier, invalid once it returned
    When the client calls "judge.grade" for "task-1" with '{"candidates":["a"]}'
    Then the call answers 'judge/grade {"candidates":["a"]}'
    And the module "judge" was called with "call-1" for "task-1", at depth 1, with a timeout of 2000 ms
    And "call-1" is not a call identifier
    And the audit log holds "task-1 client judge.grade ok"
    And the last audit entry took 0 ms

  Scenario: a call that answers within its deadline is routed, and audited with its duration
    Given the module "judge" answers after 500 ms
    When the client calls "judge.grade" for "task-1" with '{}' without waiting
    And 500 ms pass
    Then the call answers 'judge after 500 ms'
    And the audit log holds "task-1 client judge.grade ok"
    And the last audit entry took 500 ms

  Scenario: the failure of a module reaches its caller and is audited as INTERNAL
    Given the module "judge" fails
    When the client calls "judge.grade" for "task-1" with '{}'
    Then the call fails with "the module failed"
    And the audit log holds "task-1 client judge.grade INTERNAL"
    And the task "task-1" is open

  Scenario: a module calls back a module of its calls_allowed, one level deeper, within the deadline of its parent
    Given the module "memory-recall" calls back "judge.grade" with '{"candidates":["b"]}' before it answers
    When the client calls "memory.recall" for "task-1" with '{"query":"q"}'
    Then the call answers 'memory-recall/recall {"query":"q"} <- judge/grade {"candidates":["b"]}'
    And the module "judge" was called with "call-2" for "task-1", at depth 2, with a timeout of 1000 ms
    And the audit log holds "task-1 memory-recall judge.grade ok, task-1 client memory.recall ok"

  Scenario: a module writes through data the tables of its writes_tables
    Given the module "memory-write" calls back the data operation "memory.insert" with '{"kind":"note","content":"c"}' before it answers
    When the client calls "memory.remember" for "task-1" with '{}'
    Then the call answers 'memory-write/remember {} <- memory.insert {"kind":"note","content":"c"}'
    And the audit log holds "task-1 memory-write memory.insert ok, task-1 client memory.remember ok"

  Scenario Outline: a call is refused and logged, and the task goes on: <defect>
    Given <setup>
    When the client calls "<address>" for "task-1" with '{}'
    Then the call is refused with "<code>"
    And the refusal says "<message>"
    And the audit log holds "<audit>"
    And the task "task-1" is open

    Examples:
      | defect                             | setup                                                                                        | address       | code            | message                             | audit                                                                                 |
      | a module outside the profile       | no module behaviour                                                                          | scout.explore | FORBIDDEN_CALL  | client may not call scout           | task-1 client scout.explore FORBIDDEN_CALL                                            |
      | a tool of no module                | no module behaviour                                                                          | judge.vote    | UNKNOWN_TOOL    | no module serves judge.vote         | task-1 client judge.vote UNKNOWN_TOOL                                                 |
      | a module outside its calls_allowed | the module "judge" calls back "memory.remember" with '{}' before it answers                  | judge.grade   | FORBIDDEN_CALL  | judge may not call memory-write     | task-1 judge memory.remember FORBIDDEN_CALL, task-1 client judge.grade FORBIDDEN_CALL |
      | a table outside its writes_tables  | the module "judge" calls back the data operation "memory.insert" with '{}' before it answers | judge.grade   | FORBIDDEN_WRITE | judge may not write memory.memories | task-1 judge memory.insert FORBIDDEN_WRITE, task-1 client judge.grade FORBIDDEN_WRITE |
      | a data operation that is not one   | the module "judge" calls back the data operation "sql" with '{}' before it answers           | judge.grade   | UNKNOWN_TOOL    | no data operation sql               | task-1 judge sql UNKNOWN_TOOL, task-1 client judge.grade UNKNOWN_TOOL                 |

  Scenario: a call beyond the depth of the profile is refused and logged
    Given the client "cli" opened the task "task-2" with the profile "shallow"
    And the module "memory-recall" calls back "judge.grade" with '{}' before it answers
    When the client calls "memory.recall" for "task-2" with '{}'
    Then the call is refused with "DEPTH_EXCEEDED"
    And the refusal says "depth 2 beyond 1"
    And the audit log holds "task-2 memory-recall judge.grade DEPTH_EXCEEDED, task-2 client memory.recall DEPTH_EXCEEDED"
    And the task "task-2" is open

  Scenario: a call past its deadline is cancelled and its identifier invalidated, and the task goes on
    Given the module "judge" waits until its call is cancelled
    When the client calls "judge.grade" for "task-1" with '{}' without waiting
    And 1999 ms pass
    Then the module "judge" has its call in flight
    When 1 ms passes
    Then the call is refused with "DEADLINE_EXCEEDED"
    And the refusal says "call call-1 cancelled"
    And the module "judge" saw its call cancelled
    And "call-1" is not a call identifier
    And the audit log holds "task-1 client judge.grade DEADLINE_EXCEEDED"
    And the last audit entry took 2000 ms
    And the task "task-1" is open

  Scenario: within one passage of time, the deadline of a call falls before the deadline of its task
    Given the module "judge" waits until its call is cancelled
    When the client calls "judge.grade" for "task-1" with '{}' without waiting
    And 10000 ms pass
    Then the call is refused with "DEADLINE_EXCEEDED"
    And the task "task-1" ended with "deadline": its identifiers invalid, its token retired, its sandboxes stopped

  Scenario Outline: a call identifier that is not one of a call in flight is refused and logged: <defect>
    When a module calls back "judge.grade" with the call identifier "<id>"
    Then the call is refused with "UNAUTHORIZED"
    And the refusal says "not a call identifier"
    And the audit log holds "- unknown judge.grade UNAUTHORIZED"

    Examples:
      | defect                    | id      |
      | an identifier never given | call-9  |
      | the token of the task     | token-1 |
      | the name of the task      | task-1  |

  Scenario: a data operation with an identifier that is not one of a call in flight is refused and logged
    When a module calls back the data operation "tasks.get" with the call identifier "call-9"
    Then the call is refused with "UNAUTHORIZED"
    And the audit log holds "- unknown tasks.get UNAUTHORIZED"

  Scenario: the call identifier of a call that returned is refused
    When the client calls "judge.grade" for "task-1" with '{}'
    And a module calls back "judge.grade" with the call identifier "call-1"
    Then the call is refused with "UNAUTHORIZED"

  Scenario: the deadline of the task ends it, and neither verify nor any module is reached afterwards
    Given the module "memory-write" waits until its call is cancelled
    When the client calls "memory.remember" for "task-1" with '{}' without waiting
    And 9999 ms pass
    Then the task "task-1" is open
    When 1 ms passes
    Then the call is refused with "TASK_ENDED"
    And the module "memory-write" saw its call cancelled
    And the task "task-1" ended with "deadline": its identifiers invalid, its token retired, its sandboxes stopped
    When the client calls "verify.check" for "task-1" with '{}'
    Then the call is refused with "UNKNOWN_TASK"
    And the refusal says "no open task task-1"
    And the module "verify" was never called
    And the audit log holds in any order "task-1 gateway task.end:deadline ok, task-1 client memory.remember TASK_ENDED, task-1 client verify.check UNKNOWN_TASK"

  Scenario: the call beyond the number of calls of the profile ends the task, and verify is not reached
    When the client calls "judge.grade" for "task-1" with '{}'
    And the client calls "judge.grade" for "task-1" with '{}'
    And the client calls "judge.grade" for "task-1" with '{}'
    And the client calls "verify.check" for "task-1" with '{}'
    Then the call is refused with "MAX_CALLS_EXCEEDED"
    And the refusal says "3 calls already"
    And the module "verify" was never called
    And the task "task-1" ended with "max_calls": its identifiers invalid, its token retired, its sandboxes stopped
    And the audit log holds "task-1 client judge.grade ok, task-1 client judge.grade ok, task-1 client judge.grade ok, task-1 gateway task.end:max_calls ok, task-1 client verify.check MAX_CALLS_EXCEEDED"

  Scenario: the owner cancels a task while a call is in flight
    Given the module "judge" waits until its call is cancelled
    When the client calls "judge.grade" for "task-1" with '{}' without waiting
    And the client of the profile "owner" cancels "task-1"
    Then the call is refused with "TASK_ENDED"
    And the module "judge" saw its call cancelled
    And the task "task-1" ended with "cancelled": its identifiers invalid, its token retired, its sandboxes stopped
    And the audit log holds in any order "task-1 owner task.end:cancelled ok, task-1 owner task.cancel ok, task-1 client judge.grade TASK_ENDED"

  Scenario: ending a task leaves the calls of another task in flight
    Given the module "judge" waits until its call is cancelled
    And the client "cli" opened the task "task-2" with the profile "local"
    When the client calls "judge.grade" for "task-2" with '{}' without waiting
    And the client calls "judge.grade" for "task-1" with '{}' without waiting
    And the client of the profile "owner" cancels "task-1"
    Then the call is refused with "TASK_ENDED"
    And "call-1" is the identifier of a call of "task-2" in flight
    And the task "task-1" ended with "cancelled": its identifiers invalid, its token retired, its sandboxes stopped

  Scenario: a module that answers once its call is cancelled is not routed
    Given the module "judge" answers once its call is cancelled
    When the client calls "judge.grade" for "task-1" with '{}' without waiting
    And 2000 ms pass
    Then the call is refused with "DEADLINE_EXCEEDED"
    And the audit log holds "task-1 client judge.grade DEADLINE_EXCEEDED"

  Scenario: data down when a bound ends the task: the calls, the token and the sandboxes end all the same, and the failure is audited
    Given the registry is unavailable
    When 10000 ms pass
    Then the token of "task-1" is retired and its sandboxes stopped
    And the audit log holds "task-1 gateway task.end:deadline SERVICE_UNAVAILABLE"
    When the client calls "judge.grade" for "task-1" with '{}'
    Then the call is refused with "UNKNOWN_TASK"

  Scenario Outline: a cancellation is refused and logged: <defect>
    When the client of the profile "<profile>" cancels "<task>"
    Then the cancellation is refused with "<code>"
    And the refusal says "<message>"
    And the task "task-1" is open
    And the audit log holds "<task> <profile> task.cancel <code>"

    Examples:
      | defect                    | profile | task   | code           | message              |
      | a profile not the owner's | local   | task-1 | FORBIDDEN_CALL | local may not cancel |
      | a profile of no topology  | root    | task-1 | FORBIDDEN_CALL | root may not cancel  |
      | a task that is not open   | owner   | task-9 | UNKNOWN_TASK   | no open task task-9  |

  Scenario: a completed task ends once, with its token retired and its sandboxes stopped
    When the client completes "task-1"
    Then the task "task-1" ended with "completed": its identifiers invalid, its token retired, its sandboxes stopped
    When the client completes "task-1"
    Then the completion is refused with "UNKNOWN_TASK"
    And the audit log holds "task-1 client task.end:completed ok, task-1 client task.complete ok, task-1 client task.complete UNKNOWN_TASK"

  Scenario: a task is opened only under a profile of the topology
    When the client "cli" opens a task with the profile "root"
    Then the opening is refused with "UNKNOWN_PROFILE"
    And the refusal says "no profile root"
    And the registry holds the tasks "task-1"
