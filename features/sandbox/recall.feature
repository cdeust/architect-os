Feature: recall end to end under a real srt (docs/design/platform-v3-srt.md, §8, brick 1b.5)
  The expected output of brick 1b.5: recall through a real srt, before a fake upstream. The gateway runs in this
  process over the committed topology: the module memory and the worker of memory-agent are its children under srt,
  each in its profile, module and worker, launched from their built entry points. The worker reaches the model through
  the broker only, with the token of its task as its key; the broker spends its own key, here a fake one in a throwaway
  file, before a fake model on the loopback. The module memory reaches data through the callback of the gateway only.
  No real call, no real key.

  Scenario: the owner recalls a memory through the worker and the module, both under srt
    Given the platform of the committed topology under srt, data in memory holding the memory "alpha fact", and the broker before a fake model that searches the memory for "alpha" then answers '{"summary":"one fact","memories":[]}'
    When the owner opens a task and calls "memory.recall" with '{"query":"alpha"}'
    Then the call answers ok with the data '{"summary":"one fact","memories":[]}' and the evidence of the memory "alpha fact"
    And the fake model was asked by the model "haiku" through the broker, with the key of the broker and never the token of the task
    When the owner completes the task
    Then the sandbox of the worker of the task is stopped
    And the broker refuses the token of the task
