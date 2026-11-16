Feature: The worker of the first realisation, with the real Claude Code binary (docs/design/platform-v3-srt.md, §8, brick 1b.7)
  What the worker container of the stack of compose.yaml runs, less its file of entry: the worker core on a WorkerInput,
  the committed prompts, and the Agent SDK with the real Claude Code binary, against a fake model on the loopback. No
  real call, no real key. Before this feature that agent had never run in a scenario; its first run found that the
  binary refused the output schema the worker gave it.

  Scenario: a recall runs through the real binary: its tool is relayed, its answer is evidence, its output is the structure of the contract
    Given a fake model that asks the memory tools of the stack to search for "alpha", then answers '{"summary":"one fact","memories":[{"id":"m1","content":"alpha","tags":[],"score":1}]}'
    When the worker of the stack runs "recall" with '{"query":"alpha"}' under the token of its run, its environment holding another key, its internal tool answering '[{"id":"m1","content":"alpha"}]'
    Then the worker of the stack ended with the code 0 and the output '{"status":"ok","data":{"summary":"one fact","memories":[{"id":"m1","content":"alpha","tags":[],"score":1}]},"evidence":[{"source":"memory","ref":"m1","excerpt":"alpha"}]}'
    And the output of the worker of the stack carries a cost: input tokens, output tokens, a dollar amount
    And the worker of the stack relayed "memory_search" with '{"query":"alpha","limit":5}', once

  Scenario: the model is asked with the token of the run, and with no other key
    Given a fake model that asks the memory tools of the stack to search for "alpha", then answers '{"summary":"one fact","memories":[{"id":"m1","content":"alpha","tags":[],"score":1}]}'
    When the worker of the stack runs "recall" with '{"query":"alpha"}' under the token of its run, its environment holding another key, its internal tool answering '[{"id":"m1","content":"alpha"}]'
    Then the fake model was asked for messages at least once, and every request it received, whatever its path, carried the token of the run as its key
