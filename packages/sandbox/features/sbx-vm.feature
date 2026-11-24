Feature: Admission of an SBX VM before staging the native client

  Scenario Outline: Inspect the named VM before exposing the staging operation
    Then the SBX host receives "<binding>" and stages the client <times> times

    Examples:
      | binding           | times |
      | verified          | 1     |
      | live TCP route    | 0     |
      | live UDP route    | 0     |
      | extra mount       | 0     |
      | published port    | 0     |
      | wrong kit         | 0     |
      | wrong image       | 0     |
      | MCP server        | 0     |
      | extra allow       | 0     |
      | writable socket   | 0     |
      | incomplete removal | 1    |

  Scenario: The SBX policy loads and rejects a changed archive digest
    Then the committed SBX builder pins pass their schema and a broken digest is rejected

  Scenario: A workspace hard link to a sibling is refused before VM creation
    Then SBX refuses a worktree with a hard link to an outside witness
