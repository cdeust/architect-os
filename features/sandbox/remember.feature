Feature: remember end to end under a real srt (docs/design/platform-v3-srt.md, §8, brick 1b.5)
  The same platform as recall.feature: the committed topology, the module memory and the worker of memory-agent under
  srt in their profiles, the broker before a fake model. remember takes the same path, through memory.insert. The
  fake model answers with the id the insert returned, read from its tool result.

  Scenario: the owner remembers a memory through the worker and the module, both under srt
    Given the platform of the committed topology under srt, data in memory holding the memory "alpha fact", and the broker before a fake model that inserts the memory "beta fact" tagged "x,y" then answers with the id it got
    When the owner opens a task and calls "memory.remember" with '{"content":"beta fact","tags":["x","y"]}'
    Then the call answers ok with a memory id
    And the store holds exactly one memory more, "beta fact" tagged "x,y", whose id is the memory id of the answer
    And the fake model was asked by the model "haiku" through the broker, with the key of the broker and never the token of the task
    When the owner completes the task
    Then the sandbox of the worker of the task is stopped
    And the broker refuses the token of the task
