Feature: the usage forwarder of the gateway (docs/design/platform-v3-srt.md, §2, Mesure du coût, brick 1b.3)
  The gateway writes every usage record of the broker to data, with the layer `broker`. When a write finds data
  unavailable, it revokes the token of every task (the broker answers 401 to new calls), loses the records received
  meanwhile (R-9), probes data every interval, and at its return grants the tokens of the tasks still open again.
  Here the broker, data and the timer are the in-memory adapters of their ports.

  Background:
    Given a usage forwarder probing data every 250 ms
    And the gateway opened the task "task-1" with the token "tok-1" called by "call-1"
    And the gateway opened the task "task-2" with the token "tok-2"

  Scenario: a record of the broker is written to data with the layer broker
    When the broker sends the usage record '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1","parent":"call-1","model":"m1","input_tokens":3}'
    Then data holds the usage records '[{"layer":"broker","task":"task-1","parent":"call-1","model":"m1","input_tokens":3,"status":200}]'
    And the usage state is '{"data":"up","lost":0,"refused":0}'
    And the broker got the calls "grant tok-1, grant tok-2"

  Scenario Outline: a record outside the contract of the broker is refused and not written: <defect>
    When the broker sends the usage record '<record>'
    Then data holds no usage record
    And the usage state is '{"data":"up","lost":0,"refused":1}'

    Examples:
      | defect               | record                                                                        |
      | no task              | {"at":"2026-11-05T10:00:00.000Z","status":200}                                |
      | a field of content   | {"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1","content":"x"}  |
      | not an object        | "usage"                                                                       |

  Scenario: a record data refuses is counted refused, and data stays up
    Given data refuses every record
    When the broker sends the usage record '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1"}'
    Then the usage state is '{"data":"up","lost":0,"refused":1}'
    And the broker got the calls "grant tok-1, grant tok-2"

  Scenario: data unavailable: the tokens are revoked, the records lost, and granted again at the return of data
    Given data is unavailable
    When the broker sends the usage record '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1"}'
    Then the usage state is '{"data":"down","lost":1,"refused":0}'
    And the broker got the calls "grant tok-1, grant tok-2, revoke tok-1, revoke tok-2"
    And a probe of data waits 250 ms
    When the broker sends the usage record '{"at":"2026-11-05T10:00:01.000Z","status":200,"task":"task-2"}'
    And the gateway opened the task "task-3" with the token "tok-3"
    And the gateway retired the token "tok-2"
    Then the usage state is '{"data":"down","lost":2,"refused":0}'
    And the broker got the calls "grant tok-1, grant tok-2, revoke tok-1, revoke tok-2, revoke tok-2"
    When the probe of data runs
    Then the usage state is '{"data":"down","lost":2,"refused":0}'
    And a probe of data waits 250 ms
    Given data is available again
    When the broker sends the usage record '{"at":"2026-11-05T10:00:02.000Z","status":200,"task":"task-1"}'
    Then the usage state is '{"data":"down","lost":3,"refused":0}'
    And data holds no usage record
    When the probe of data runs
    Then the usage state is '{"data":"up","lost":3,"refused":0}'
    And the broker got the calls "grant tok-1, grant tok-2, revoke tok-1, revoke tok-2, revoke tok-2, grant tok-1, grant tok-3"
    And the broker honours the tokens "tok-1, tok-3"
    And no probe of data waits
    When the broker sends the usage record '{"at":"2026-11-05T10:00:03.000Z","status":200,"task":"task-3"}'
    Then data holds the usage records '[{"layer":"broker","task":"task-3"}]'

  Scenario: writes that find data unavailable together revoke each token once
    Given data is unavailable
    When the broker sends 3 usage records of the task "task-1" at once
    Then the usage state is '{"data":"down","lost":3,"refused":0}'
    And the broker got the calls "grant tok-1, grant tok-2, revoke tok-1, revoke tok-2"
    And a probe of data waits 250 ms

  Scenario: a token granted back keeps the task and the parent it was opened with
    Given data is unavailable
    When the broker sends the usage record '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1"}'
    And data is available again
    And the probe of data runs
    Then the broker honours the token "tok-1" for '{"task":"task-1","parent":"call-1"}'
    And the broker honours the token "tok-2" for '{"task":"task-2"}'

  Scenario: a token retired and opened again for another task while the tokens are granted back is granted once
    Given data is unavailable
    When the broker sends the usage record '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1"}'
    And data is available again
    And while the broker grants "tok-1" back, the gateway retires "tok-2" and opens the task "task-9" with it
    And the probe of data runs
    Then the broker honours the token "tok-2" for '{"task":"task-9"}'
    And the broker got the calls "grant tok-1, grant tok-2, revoke tok-1, revoke tok-2, grant tok-1, revoke tok-2, grant tok-2"

  Scenario: a token retired while data is up is revoked at the broker
    When the gateway retired the token "tok-1"
    Then the broker got the calls "grant tok-1, grant tok-2, revoke tok-1"
    And the broker honours the tokens "tok-2"

  Scenario Outline: a failure of data other than its unavailability is not taken for it: <failure>
    Given data fails with <failure> "a bug of the sink"
    Then the broker sending the usage record '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1"}' fails with "a bug of the sink"
    And the usage state is '{"data":"up","lost":0,"refused":0}'
    And the broker got the calls "grant tok-1, grant tok-2"

    Examples:
      | failure                       |
      | an error                      |
      | the gateway code UNKNOWN_TOOL |

  Scenario: only the notifications of the logger usage are handed to the forwarder
    Given the notifications of a broker client handed over by onUsage
    When the broker client gets a notification of the logger "usage" with '{"at":"2026-11-05T10:00:00.000Z","status":200,"task":"task-1"}'
    And the broker client gets a notification of the logger "audit" with '{"at":"2026-11-05T10:00:01.000Z","status":200,"task":"task-2"}'
    Then data holds the usage records '[{"layer":"broker","task":"task-1"}]'
    And the usage state is '{"data":"up","lost":0,"refused":0}'
