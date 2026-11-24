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
      | wrong CLI version | 0 |
      | template flavor | 0 |
      | template repo | 0 |
      | template id | 0 |
      | template digest | 0 |
      | ambiguous creation | 0 |
      | unconfirmed create | 0 |
      | name in use | 0 |
      | already removed | 1 |
      | wrong name | 0 |
      | other workspace | 0 |
      | other agent | 0 |
      | MCP mode | 0 |
      | runtime mount | 0 |
      | mount source | 0 |
      | mount target | 0 |
      | readonly worktree | 0 |
      | rule scope | 0 |
      | rule inactive | 0 |
      | rule resource | 0 |
      | rule destination | 0 |
      | missing UDP | 0 |
      | missing TCP | 0 |
      | check allowed | 0 |
      | check scope | 0 |
      | check implicit | 0 |
      | check rule | 0 |
      | check action | 0 |
      | interrupted | 1 |
      | local CLI | 1 |
      | system CLI | 1 |
      | missing CLI | 0 |
      | invalid CLI failure | 0 |
      | invalid CLI code | 0 |
      | cancelled CLI | 0 |

  Scenario: The SBX policy loads and rejects a changed archive digest
    Then the committed SBX builder pins pass their schema and a broken digest is rejected

  Scenario: A workspace hard link to a sibling is refused before VM creation
    Then SBX refuses a worktree with a hard link to an outside witness

  Scenario: Only a physical tree of ordinary workspace entries reaches the VM
    Then SBX checks the workspace tree and path before any CLI call

  Scenario: Direct SBX invocation needs the admitted host runtime
    Then a direct SBX host without a run binding refuses before CLI access
