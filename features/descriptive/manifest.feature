Feature: modules, their catalogue, their servers and the profiles of the clients (docs/design/platform-v3-srt.md, §5)
  The gateway reads three files together: the catalogue that manifest-registry writes from the manifests, the servers of
  topology/modules.mcp.json and the profiles of topology/clients.json. Each rule is one line of the schemas of
  packages/contracts/src/modules.ts and one row here; a topology that breaks one is refused whole, and nothing of it is
  routed. Until manifest-registry writes it, the committed catalogue is topology/catalog.json, written by hand in its
  output format (brick 1b.5).

  Scenario: the committed catalogue, servers and client profiles hold together
    Given the committed topology
    Then the topology is valid
    And the committed catalogue has the modules "memory, memory-agent"

  Scenario Outline: the schema <file> a tool of the committed catalogue names is the JSON schema of <contract>
    Then the committed schema "<file>" is the JSON schema of <contract>

    Examples:
      | file                                          | contract                                |
      | modules/memory/schemas/search.in.json         | the input of the internal tool memory_search |
      | modules/memory/schemas/insert.in.json         | the input of the internal tool memory_insert |
      | modules/memory-agent/schemas/recall.in.json   | the input of the intent tool recall     |
      | modules/memory-agent/schemas/recall.out.json  | the data of the intent tool recall      |
      | modules/memory-agent/schemas/remember.in.json | the input of the intent tool remember   |
      | modules/memory-agent/schemas/remember.out.json | the data of the intent tool remember   |

  Scenario: every schema a tool of the committed catalogue names is a committed file under its module
    Given the committed topology
    Then every schema a tool names is a file under modules/<module>/

  Scenario: every agent module of the committed catalogue runs the task profile its manifest names (brick 1b.5)
    Given the committed topology
    Then the server of every agent module names agents/<profile>.md, a task profile of that name

  Scenario: the fixture topology holds
    Given the fixture topology
    Then the topology is valid

  Scenario Outline: a topology is refused when <defect>
    Given the fixture topology
    When the fixture topology is changed so that <defect>
    Then the topology is refused saying "<message>"

    Examples:
      | defect                                              | message                                                  |
      | a tool of kind agent is marked stable               | a tool of kind agent cannot be marked stable             |
      | a tool of kind agent has no agent block             | a tool of kind agent needs the agent block               |
      | a module without a tool of kind agent has one       | the agent block without a tool of kind agent             |
      | a module calls itself                               | judge calls itself                                       |
      | calls_allowed makes a cycle                         | calls_allowed cycle: memory-recall -> judge -> memory-recall |
      | calls_allowed makes a cycle below the first module  | calls_allowed cycle: judge -> memory-write -> judge      |
      | a module may call what is not a module              | judge may call web-scout, which is not a module          |
      | two modules write one table                         | memory.memories is written by judge and memory-write     |
      | two modules have one name                           | two modules of one name                                  |
      | two tools of a module have one name                 | two tools of one name                                    |
      | two tools of two modules have one address           | two tools of one address                                 |
      | a deadline is zero                                  | timeout_ms                                               |
      | a result has no token                               | max_result_tokens                                        |
      | the egress is an empty list                         | egress                                                   |
      | a manifest has a field the schema does not know     | cache                                                    |
      | a server is reached over http                       | type                                                     |
      | a module has no server                              | modules [judge, memory-recall, memory-write, scout] but servers [judge, memory-recall, memory-write] |
      | a server has no module                              | but servers [judge, memory-recall, memory-write, scout, spare] |
      | a profile sees what is not a module                 | local sees web-scout, which is not a module              |
      | two profiles have one name                          | two profiles of one name                                 |
      | a profile allows no call                            | max_calls                                                |

  Scenario Outline: a topology holds when <path> is <value>
    Given the fixture topology
    When the fixture topology has <path> set to <value>
    Then the topology is valid

    Examples:
      | path                                 | value |
      | catalog.modules.1.version            | "10.20.30" |
      | catalog.modules.2.writes_tables.0    | "memories" |
      | catalog.modules.1.tools.0.validator  | "verify" |
      | catalog.modules.1.tools.0.validator  | "spec-lint" |
      | catalog.modules.1.tools.0.validator  | "none" |
      | catalog.modules.3.agent.model_min    | "haiku" |
      | catalog.modules.3.agent.model_min    | "opus" |
      | catalog.modules.3.tools.1            | {"name":"cite","description":"Cites a file","input_schema":"./schemas/cite.in.json","kind":"data","max_result_tokens":10,"validator":"none"} |
      | clients.profiles.0.model             | "haiku" |
      | clients.profiles.0.model             | "opus" |
      | clients.profiles.0.effort            | "low" |
      | clients.profiles.0.effort            | "high" |
      | clients.profiles.0.mode              | "catalog" |
      | clients.profiles.1                   | {"name":"ci","modules":["judge"],"model":"haiku","effort":"low","mode":"catalog","max_duration_ms":60000,"max_calls":5,"max_depth":1} |

  Scenario Outline: a topology is refused at <path> when it is <value>
    Given the fixture topology
    When the fixture topology has <path> set to <value>
    Then the topology is refused at <path>

    Examples:
      | path                                    | value |
      | catalog.modules.0.calls_allowed.0       | "1judge" |
      | catalog.modules.0.calls_allowed.0       | "judge!" |
      | catalog.modules.2.writes_tables.0       | "1memory.memories" |
      | catalog.modules.2.writes_tables.0       | "memory.memories!" |
      | catalog.modules.1.tools.0.name          | "1grade" |
      | catalog.modules.1.tools.0.name          | "grade!" |
      | catalog.modules.1.tools.0.input_schema  | "a./schemas/grade.in.json" |
      | catalog.modules.1.tools.0.input_schema  | "./schemas/grade.in.json.bak" |
      | catalog.modules.0.tools.0.output_schema | "a./schemas/recall.out.json" |
      | catalog.modules.0.tools.0.output_schema | "./schemas/recall.out.json.bak" |
      | catalog.modules.3.agent.profile         | "1scout" |
      | catalog.modules.3.agent.profile         | "scout!" |
      | catalog.modules.1.version               | "v0.1.0" |
      | catalog.modules.1.version               | "0.1.0-rc" |
      | catalog.modules.1.domain                | "1judge" |
      | catalog.modules.1.domain                | "judge!" |
      | servers.mcpServers.judge.command        | "/usr/bin/node" |
      | servers.mcpServers.judge.command        | "node --inspect" |
      | clients.profiles.0.name                 | "1local" |
      | clients.profiles.0.name                 | "local!" |

  Scenario: a profile is not the owner's unless it says so
    Given the fixture topology
    Then the parsed topology has clients.profiles.0.owner equal to false
