Feature: Worker of an agent tool (docs/design/platform-v3-srt.md, §2, brick 1b.5)
  The worker of an agent tool takes the input of its call from the gateway on its own stdio, runs the agent of its task
  profile, agents/<name>.md, and gives its output once. Every failure is an output with a named code. Its evidence is
  cut to its bounds (decision 3), never refused. Scripted agents here: no network, no Anthropic call.

  Scenario: the committed task profile memory loads, its tools those of the platform and its prompt the body
    When I read the committed task profile "agents/memory.md"
    Then the task profile is named "memory" with the model "haiku"
    And the task profile has exactly the tools:
      | mcp__platform__memory_search |
      | mcp__platform__memory_insert |
    And the task profile prompt starts with "You serve one call of a tool of the memory domain."

  Scenario Outline: a task profile <defect> is refused
    Then a copy of "agents/memory.md" with <defect> is refused saying "<message>"

    Examples:
      | defect                            | message                                   |
      | no frontmatter                    | starts with its frontmatter               |
      | the misspelt field allowed_tools  | allowed_tools                             |
      | an empty prompt                   | the agent memory has no prompt            |
      | a tool of no platform server      | tools                                     |
      | the model gpt                     | model                                     |
      | an uppercase name                 | name                                      |
      | a name with a space               | name                                      |
      | text before its frontmatter       | starts with its frontmatter               |
      | a tool behind a prefix            | tools                                     |
      | a tool followed by more           | tools                                     |

  Scenario Outline: a task profile with the model <model> loads
    Then a copy of "agents/memory.md" with the model <model> loads with the model "<model>"

    Examples:
      | model  |
      | sonnet |
      | opus   |

  Scenario: an ok output carries the data and the evidence of the agent, which gets its run
    Given a scripted task agent that answers '{"summary":"one fact","memories":[]}' with the evidence '[{"source":"memory","ref":"m1","excerpt":"alpha"},{"source":"memory","ref":"m2"}]'
    When the worker serves '{"tool":"recall","input":{"query":"alpha"},"limits":{"max_turns":3}}'
    Then the worker gave the output '{"status":"ok","data":{"summary":"one fact","memories":[]},"evidence":[{"source":"memory","ref":"m1","excerpt":"alpha"},{"source":"memory","ref":"m2"}],"cost":{"input_tokens":3,"output_tokens":2,"usd":0.0002}}'
    And the task agent ran the tool "recall" with the input '{"query":"alpha"}', 3 turns and the profile "memory"
    And the task agent got the JSON schema, draft-07, of the data of "recall"
    And a relay of the task agent to "memory.search" reaches the channel

  Scenario: the evidence of an output is cut to its bounds, never refused (decision 3)
    Given a scripted task agent that answers '{"summary":"s","memories":[]}' with 51 evidences of a source of 65, a ref of 257 and an excerpt of 2001 characters
    When the worker serves '{"tool":"recall","input":{"query":"q"},"limits":{"max_turns":3}}'
    Then the worker output is "ok" with 50 evidences of a source of 64, a ref of 256 and an excerpt of 2000 characters

  Scenario: the agent stopped at its max_turns is a failed output with the code the gateway reads, its cost kept
    Given a scripted task agent stopped at its max_turns
    When the worker serves '{"tool":"recall","input":{"query":"q"},"limits":{"max_turns":3}}'
    Then the worker gave the output '{"status":"failed","data":null,"evidence":[],"cost":{"input_tokens":3,"output_tokens":2,"usd":0.0002},"error":{"code":"MAX_TURNS_EXCEEDED","message":"stopped at 3 turns"}}'

  Scenario Outline: a run that cannot complete is a failed output WORKER_FAILED: <case>
    Given a scripted task agent that <behaviour>
    When the worker serves '<input>'
    Then the worker gave a failed output "WORKER_FAILED" saying "<message>"

    Examples:
      | case                     | behaviour                     | input                                                                         | message                 |
      | the agent fails          | throws the error "boom"       | {"tool":"recall","input":{"query":"q"},"limits":{"max_turns":3}}              | boom                    |
      | the agent throws a value | throws the value "not an error" | {"tool":"recall","input":{"query":"q"},"limits":{"max_turns":3}}            | not an error            |
      | a tool without contract  | answers nothing               | {"tool":"draft","input":{},"limits":{"max_turns":3}}                          | no contract for draft   |
      | a budget in dollars      | answers nothing               | {"tool":"recall","input":{},"limits":{"max_turns":3,"max_budget_usd":1}}      | max_budget_usd          |
      | no max_turns             | answers nothing               | {"tool":"recall","input":{},"limits":{}}                                      | max_turns               |
      | an input that is no task | answers nothing               | "recall"                                                                      | expected object         |

  Scenario: the channel over MCP asks the gateway for the input, relays, and gives the output once
    Given an MCP gateway that answers task_input with '{"tool":"recall","input":{"query":"q"},"limits":{"max_turns":2}}'
    Then the channel input is '{"tool":"recall","input":{"query":"q"},"limits":{"max_turns":2}}'
    And the channel relays "memory.search" with '{"query":"q"}' as the call '{"address":"memory.search","arguments":{"query":"q"}}', its answer '[{"id":"m1"}]' and no error
    And the channel relays "memory.search" with '{}' to a refusal '{"code":"FORBIDDEN_CALL"}' flagged as an error
    And the channel relays "memory.search" with '{}' to an answer without text, read as ""
    And the channel relays "memory.search" with '{}' to an answer with no content, read as ""
    And the channel relays "memory.search" with '{}' to an answer with an empty content, read as ""
    And the channel gives the output '{"status":"ok","data":{},"evidence":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}' as the arguments of task_complete
    And the channel fails when the gateway refuses the output with "already given"

  Scenario Outline: evidence of a relayed answer: <case>
    Then the evidence of the answer '<answer>' from "memory" is '<evidence>'

    Examples:
      | case                                | answer                                                    | evidence                                                                       |
      | records with an id and a content    | [{"id":"m1","content":"alpha"},{"id":"m2","content":"b"}] | [{"source":"memory","ref":"m1","excerpt":"alpha"},{"source":"memory","ref":"m2","excerpt":"b"}] |
      | a record whose content is no text   | [{"id":"m1","content":3}]                                 | [{"source":"memory","ref":"m1"}]                                               |
      | one record, not an array            | {"id":"m9"}                                               | [{"source":"memory","ref":"m9"}]                                               |
      | records without a text id           | [{"id":7},{"content":"x"},null]                           | []                                                                             |
      | a refusal that is not JSON          | not json                                                  | []                                                                             |
