Feature: the gateway launches its modules in their sandboxes and routes the calls of a task to them over MCP (docs/design/platform-v3-srt.md, §2, brick 1b.4)
  The gateway loads its topology whole, launches each module of topology/modules.mcp.json through the SandboxRunner at
  its first call, and speaks MCP on its stdio: the call identifier goes in `_meta`, the deadline cancels the request at
  the module. A module whose sandbox ended is launched again at its next call; after 3 launches in a row without an
  answer it is unavailable. The tasks are written to the registry of data, over its MCP server. Here the sandboxes are
  fakes whose modules are real MCP servers of the SDK, data runs over its in-memory store, and the time is manual.

  Background:
    Given the gateway over the topology gateway/features/fixtures/topology.json, its modules in fake sandboxes and data over MCP
    And the task "task-1" opened by "cli" with the profile "local"

  Scenario: a call reaches its module over MCP with its call identifier, and data holds the task
    When "task-1" calls "judge.grade" over MCP with '{"x":1}'
    Then the answer over MCP is 'judge/grade {"x":1}'
    And the module "judge" received "grade" with the call identifier "call-1"
    And the module "judge" saw the client '{"name":"architect-os-gateway","version":"0.1.0"}'
    And data holds the task '{"task":"task-1","client":"cli","profile":"local","deadline_at":"2026-11-06T09:00:10.000Z"}'

  Scenario: two calls in a row launch their module once
    When "task-1" calls "judge.grade" over MCP with '{}'
    And "task-1" calls "judge.grade" over MCP with '{"second":true}'
    Then the answer over MCP is 'judge/grade {"second":true}'
    And the sandboxes launched are "judge"

  Scenario Outline: the answer of a module is forwarded as it is: <case>
    Given the module "judge" answers '<answer>'
    When "task-1" calls "judge.grade" over MCP with '{}'
    Then the answer over MCP is '<forwarded>'

    Examples:
      | case                | answer                                                                       | forwarded                                          |
      | an error            | {"content":[{"type":"text","text":"bad input"}],"isError":true}              | {"text":"bad input","isError":true}                |
      | structured content  | {"content":[{"type":"text","text":"{}"}],"structuredContent":{"n":1}}        | {"text":"{}","isError":false,"structured":{"n":1}} |
      | no content          | {"content":[]}                                                               | {"text":"","isError":false}                        |
      | no text             | {"content":[{"type":"image","data":"AA==","mimeType":"image/png"}]}          | {"text":"","isError":false}                        |

  Scenario: a call past its deadline is cancelled at the module
    Given the module "judge" hangs until its call is cancelled
    When "task-1" calls "judge.grade" over MCP with '{}' without waiting
    And 2000 ms pass for the gateway
    Then the call over MCP is refused with "DEADLINE_EXCEEDED"
    And the module "judge" saw the call "call-1" cancelled

  Scenario: a module killed is launched again at its next call
    When "task-1" calls "judge.grade" over MCP with '{}'
    And the sandbox of "judge" is killed
    And "task-1" calls "judge.grade" over MCP with '{"again":true}'
    Then the answer over MCP is 'judge/grade {"again":true}'
    And the sandboxes launched are "judge, judge"

  Scenario: a module killed during its call is unavailable for that call, and launched again at the next
    Given the module "judge" hangs until its call is cancelled
    When "task-1" calls "judge.grade" over MCP with '{}' without waiting
    And the sandbox of "judge" is killed
    Then the call over MCP is refused with "SERVICE_UNAVAILABLE" saying "module judge did not answer:"
    Given the module "judge" no longer hangs
    When "task-1" calls "judge.grade" over MCP with '{}'
    Then the answer over MCP is 'judge/grade {}'
    And the sandboxes launched are "judge, judge"

  Scenario: two calls at once launch their module once
    When "task-1" calls "judge.grade" over MCP twice at once
    Then both answers over MCP are 'judge/grade {}'
    And the sandboxes launched are "judge"

  Scenario: after an answer, the launches of a module are counted from zero again
    When "task-1" calls "judge.grade" over MCP with '{}'
    And the sandbox of "judge" is killed
    And the sandbox of "judge" fails its next 2 launches
    And "task-1" calls "judge.grade" over MCP with '{"again":true}'
    Then the answer over MCP is 'judge/grade {"again":true}'
    And the sandboxes launched are "judge, judge, judge, judge"

  Scenario: a module that writes what is not MCP is stopped, and counts as a failed launch
    Given the sandbox of "judge" writes what is not MCP at its next 3 launches
    When "task-1" calls "judge.grade" over MCP with '{}'
    Then the call over MCP is refused with "SERVICE_UNAVAILABLE"
    And the sandboxes ended are "judge, judge, judge"

  Scenario: stopping the gateway stops every module it launched
    When "task-1" calls "judge.grade" over MCP with '{}'
    And "task-1" calls "memory.recall" over MCP with '{}'
    And the gateway stops its modules
    Then the sandboxes ended are "judge, memory-recall"

  Scenario: a module that fails two launches answers at the third
    Given the sandbox of "judge" fails its next 2 launches
    When "task-1" calls "judge.grade" over MCP with '{}'
    Then the answer over MCP is 'judge/grade {}'
    And the sandboxes launched are "judge, judge, judge"

  Scenario: a module that fails three launches in a row is unavailable, and is not launched a fourth time
    Given the sandbox of "judge" fails its next 3 launches
    When "task-1" calls "judge.grade" over MCP with '{}'
    Then the call over MCP is refused with "SERVICE_UNAVAILABLE" saying "module judge failed 3 launches in a row"
    When "task-1" calls "judge.grade" over MCP with '{}'
    Then the call over MCP is refused with "SERVICE_UNAVAILABLE"
    And the sandboxes launched are "judge, judge, judge"

  Scenario: the end of a task is written to the registry of data
    When the client completes "task-1" over MCP
    Then data holds the task '{"task":"task-1","ending":"completed"}'

  Scenario: a topology whose catalogue is invalid is refused whole: no module is launched, nothing is routed
    When the gateway is loaded with a catalogue where "judge" calls itself
    Then loading the gateway fails saying "judge calls itself"
    And the sandboxes launched are ""
