Feature: RouterServices
  The services of the clients' front, reached through the task router: one task per call, opened for the subject of the
  caller under the profile of the gateway, completed whatever the call did (docs/design/platform-v3-srt.md, §2).

  Background:
    Given a router double and the services of the profile "owner"

  Scenario: calls the address of the service and the tool as the client of the task
    When the services invoke "memory" tool "recall" with arguments '{"query":"q"}' for the subject "alice"
    Then the router calls were "open:alice/owner, call:task-1 memory.recall {\"query\":\"q\"}, complete:task-1"

  Scenario: returns the answer of the call
    When the services invoke "memory" tool "recall" with arguments '{}' for the subject "alice"
    Then the services answered with the answer of the router

  Scenario: completes the task after a refusal and returns the refusal of the call, not that of complete
    Given the router refuses the call with "SERVICE_UNAVAILABLE" and refuses to complete with "UNKNOWN_TASK"
    When the services invoke "memory" tool "recall" with arguments '{}' for the subject "alice"
    Then the invocation is refused with code "SERVICE_UNAVAILABLE"
    And the router calls were "open:alice/owner, call:task-1 memory.recall {}, complete:task-1"

  Scenario: returns the rejection of complete after an answer
    Given the router refuses to complete with "UNKNOWN_TASK"
    When the services invoke "memory" tool "recall" with arguments '{}' for the subject "alice"
    Then the invocation is refused with code "UNKNOWN_TASK"

  Scenario: opens one task per call
    When the services invoke "memory" tool "recall" with arguments '{}' for the subject "alice"
    And the services invoke "memory" tool "remember" with arguments '{}' for the subject "bob"
    Then the router calls were "open:alice/owner, call:task-1 memory.recall {}, complete:task-1, open:bob/owner, call:task-2 memory.remember {}, complete:task-2"
