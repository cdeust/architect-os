Feature: Gateway port adapters
  Every adapter of a gateway port satisfies the contract of its port. Adding an adapter means adding one Examples row.

  Scenario Outline: Authenticator contract: resolves a valid token to its identity
    Given the "<adapter>" authenticator accepting token "t-1" for subject "alice"
    Then authenticating with token "t-1" resolves to the identity '{"subject":"alice"}'

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: Authenticator contract: rejects a missing or unknown token with UNAUTHORIZED
    Given the "<adapter>" authenticator accepting token "t-1" for subject "alice"
    Then authenticating without a token is refused with code "UNAUTHORIZED"
    And authenticating with token "nope" is refused with code "UNAUTHORIZED"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: QuotaPolicy contract: allows up to the limit then throws QUOTA_EXCEEDED
    Given the "<adapter>" quota policy with a limit of 2 calls
    When subject "a" consumes "recall" 2 times
    Then subject "a" consuming "recall" is refused with code "QUOTA_EXCEEDED"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: QuotaPolicy contract: counts per identity and per tool
    Given the "<adapter>" quota policy with a limit of 2 calls
    When subject "a" consumes "recall" 2 times
    Then subject "b" can consume "recall"
    And subject "a" can consume "remember"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: AuditLog contract: records entries in order without loss
    Given the "<adapter>" audit log
    When the audit log records the entry '{"tool":"recall","outcome":"ok"}'
    And the audit log records the entry '{"tool":"remember","outcome":"error","error_code":"QUOTA_EXCEEDED"}'
    Then the audit log reads back '[{"tool":"recall"},{"tool":"remember","error_code":"QUOTA_EXCEEDED"}]'

    Examples:
      | adapter    |
      | in-memory  |
      | json lines |

  Scenario Outline: ServiceClient contract: routes to the owner and returns its answer untouched
    Given the "<adapter>" service client where "memory/recall" answers '{"ok":true}'
    When the service client invokes "memory" tool "recall" with arguments '{"query":"q"}'
    Then the service client response matches '{"isError":false,"structured":{"ok":true}}'

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario Outline: ServiceClient contract: throws SERVICE_UNAVAILABLE for a service it cannot reach
    Given the "<adapter>" service client where "memory/recall" answers '{"ok":true}'
    When the service client invokes "ghost" tool "recall" with arguments '{}'
    Then the service client invocation is refused with code "SERVICE_UNAVAILABLE"

    Examples:
      | adapter   |
      | in-memory |
      | mcp       |

  Scenario: InMemoryQuota window resets after the window elapses
    Given an in-memory quota policy with a limit of 1 call per 1000 ms on a manual clock
    When subject "a" consumes "t" 1 times
    And the quota clock moves to 1001 ms
    Then subject "a" can consume "t"

  Scenario: McpServiceClient failures wraps transport errors and keeps the service error flag
    Given an MCP service client whose "memory" client fails with 'down'
    When the service client invokes "memory" tool "recall" with arguments '{}'
    Then the service client invocation is rejected with a message containing "down"
    Given an MCP service client whose "memory" client answers an error with the text 'boom'
    When the service client invokes "memory" tool "recall" with arguments '{}'
    Then the service client response matches '{"isError":true,"text":"boom"}'

  Scenario Outline: TaskRegistry contract: a task opened is ended with its reason
    Given the "<adapter>" task registry
    When the registry opens the task '{"task":"task-1","client":"cli","profile":"local","deadline_at":"2026-11-06T10:00:00.000Z"}'
    And the registry ends "task-1" with "cancelled"
    Then the registry reads back "task-1" ended with "cancelled"

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: TaskTokens contract: a token granted is honoured until it is retired
    Given the "<adapter>" task tokens
    When the tokens grant "token-1" to "task-1"
    Then the token "token-1" is honoured for "task-1"
    When the tokens retire "token-1"
    Then the token "token-1" is not honoured

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: Ids contract: identifiers of a kind are distinct and name their kind
    Given the "<adapter>" identifiers
    Then 3 identifiers of the kind "call" are distinct and start with "call-"

    Examples:
      | adapter    |
      | sequential |

  Scenario Outline: ModuleClient contract: a call reaches the tool of its module and its answer comes back untouched
    Given the "<adapter>" module client
    When the module client calls "judge" tool "grade" with '{"x":1}' and the call identifier "call-1"
    Then the module answer is 'judge/grade {"x":1}'

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: DataClient contract: an operation reaches data and its answer comes back untouched
    Given the "<adapter>" data client
    When the data client executes "tasks.get" with '{"task":"task-1"}'
    Then the data answer is 'tasks.get {"task":"task-1"}'

    Examples:
      | adapter   |
      | in-memory |

  Scenario Outline: TaskSandboxes contract: the sandboxes of a task are stopped
    Given the "<adapter>" task sandboxes
    When the sandboxes of "task-1" are stopped
    Then the sandboxes of "task-1" are gone

    Examples:
      | adapter   |
      | in-memory |
