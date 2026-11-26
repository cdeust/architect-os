Feature: The register tools/watch/watch.json (a descriptive file: its schema, the committed copy, and every broken copy)

  Rule: the committed register loads

    Scenario: the register committed in this repository is accepted by the tool
      When the register committed in this repository is loaded
      Then the watch register is accepted with 31 sources

    Scenario: the register committed in this repository is in the form the tool writes
      When the register committed in this repository is loaded
      Then the committed watch register is byte for byte what the tool would write of it

  Rule: a register that holds a source of each kind is accepted

    Scenario: the base register of these scenarios is accepted
      Given a watch register of one source of each kind over an in-memory repository
      When the watch register is loaded
      Then the watch register is accepted

    Scenario: an index with no list of addresses yet (never read) is accepted
      Given a watch register of one source of each kind over an in-memory repository
      And the watch repository file "idx.txt" is removed
      When the watch register is loaded
      Then the watch register is accepted

  Rule: a broken copy is refused, and the reason names what is wrong

    Scenario: a register that is absent
      Given a watch register of one source of each kind over an in-memory repository
      And the watch register is absent
      When the watch register is loaded
      Then the watch register is refused with a reason holding "est absent"

    Scenario: a register that is not JSON
      Given a watch register of one source of each kind over an in-memory repository
      And the watch register text is "{ not json"
      When the watch register is loaded
      Then the watch register is refused with a reason holding "n'est pas du JSON"

    Scenario Outline: a register that breaks a rule of the schema
      Given a watch register of one source of each kind over an in-memory repository
      And the watch register field "<field>" is set to '<value>'
      When the watch register is loaded
      Then the watch register is refused with a reason holding "<reason>"

      Examples:
        | field                    | value                                    | reason                      |
        | extra                    | 1                                        | Unrecognized key            |
        | sources.0.kind           | "feed"                                   | hors schéma : $.sources.0   |
        | sources.0.extra          | 1                                        | Unrecognized key            |
        | sources.1.extra          | 1                                        | Unrecognized key            |
        | sources.1.read.extra     | 1                                        | Unrecognized key            |
        | sources.2.extra          | 1                                        | Unrecognized key            |
        | sources.3.extra          | 1                                        | Unrecognized key            |
        | sources                  | {}                                       | $.sources                   |
        | sources.0.id             | "Bad_Id"                                 | $.sources.0.id              |
        | sources.0.id             | "-lead"                                  | $.sources.0.id              |
        | sources.0.id             | "ok_not"                                 | $.sources.0.id              |
        | sources.0.package        | "../x"                                   | $.sources.0.package         |
        | sources.0.package        | "name!"                                  | $.sources.0.package         |
        | sources.0.manifests      | []                                       | $.sources.0.manifests       |
        | sources.1.read.version   | "2.1"                                    | $.sources.1.read.version a version is x.y.z |
        | sources.1.read.version   | "1.2.3-beta"                             | $.sources.1.read.version a version is x.y.z |
        | sources.1.read.version   | ["1.2.3"]                                | $.sources.1.read.version    |
        | sources.1.read.on        | "yesterday"                              | $.sources.1.read.on         |
        | sources.1.read.on        | "x2026-11-17"                            | $.sources.1.read.on         |
        | sources.1.read.on        | "2026-11-17T00"                          | $.sources.1.read.on         |
        | sources.1.url            | "http://raw.githubusercontent.com/x/y"   | $.sources.1.url an address is https: on a host of the closed list |
        | sources.1.url            | "https://example.org/CHANGELOG.md"       | $.sources.1.url an address is https: on a host of the closed list |
        | sources.1.url            | "https://code.claude.com:8443/x"         | $.sources.1.url an address is https: on a host of the closed list |
        | sources.1.url            | "not an address"                         | $.sources.1.url an address is https: on a host of the closed list |
        | sources.1.url            | "https://:secret@code.claude.com/x"      | $.sources.1.url an address is https: on a host of the closed list |
        | sources.1.url            | "https://user@code.claude.com/x"         | $.sources.1.url an address is https: on a host of the closed list |
        | sources.2.mechanisms     | []                                       | $.sources.2.mechanisms      |
        | sources.2.mechanisms     | ["../outside"]                           | $.sources.2.mechanisms.0 a repository path is relative and has no .. segment |
        | sources.2.mechanisms     | ["/etc/passwd"]                          | $.sources.2.mechanisms.0 a repository path is relative and has no .. segment |
        | sources.2.mechanisms     | ["a/../b"]                               | $.sources.2.mechanisms.0 a repository path is relative and has no .. segment |
        | sources.2.relies         | ""                                       | $.sources.2.relies          |
        | sources.2.read.sha256    | "ABCDEF"                                 | $.sources.2.read.sha256     |
        | sources.2.read.sha256    | "0000000000000000000000000000000000000000000000000000000000000000f" | $.sources.2.read.sha256 |
        | sources.3.pages          | "../idx.txt"                             | $.sources.3.pages a repository path is relative and has no .. segment |
        | sources.3.read           | {"on":"2026-11-16"}                      | Unrecognized key            |

    Scenario Outline: a package name that is accepted, scoped or not
      Given a watch register of one source of each kind over an in-memory repository
      And the watch register field "sources.0.package" is set to '"<package>"'
      And the watch repository holds the file "m/package.json" with '{"dependencies":{"<package>":"10.20.30"}}'
      When the watch register is loaded
      Then the watch register is accepted

      Examples:
        | package      |
        | zod          |
        | @x/sdk       |
        | a.b_c-d      |

    Scenario: an id that appears twice
      Given a watch register of one source of each kind over an in-memory repository
      And the watch register field "sources.1.id" is set to '"pin-a"'
      When the watch register is loaded
      Then the watch register is refused with a reason holding "identifiant en double : pin-a"

    Scenario: a mechanism that is not in the repository
      Given a watch register of one source of each kind over an in-memory repository
      And the watch repository file "src/a.ts" is removed
      When the watch register is loaded
      Then the watch register is refused with a reason holding "doc : src/a.ts est absent du dépôt"

    Scenario: a manifest that is not in the repository
      Given a watch register of one source of each kind over an in-memory repository
      And the watch repository file "m/package.json" is removed
      When the watch register is loaded
      Then the watch register is refused with a reason holding "pin-a : m/package.json n'épingle pas @x/sdk à une version exacte"

    Scenario Outline: a manifest that does not pin the package to an exact version
      Given a watch register of one source of each kind over an in-memory repository
      And the watch repository holds the file "m/package.json" with '<manifest>'
      When the watch register is loaded
      Then the watch register is refused with a reason holding "n'épingle pas @x/sdk à une version exacte"

      Examples:
        | manifest                                          |
        | {"dependencies":{"@x/sdk":"^1.0.0"}}              |
        | {"dependencies":{"@x/sdk":"latest"}}              |
        | {"dependencies":{"@x/other":"1.0.0"}}             |
        | {"devDependencies":{"@x/sdk":"1.0.0"}}            |
        | {"dependencies":{"@x/sdk":1}}                     |
        | {"dependencies":null}                             |
        | {"dependencies":{"@x/sdk":null}}                  |
        | {"dependencies":{"@x/sdk":["1.0.0"]}}             |
        | {"dependencies":{"@x/sdk":"1.0.0-rc.1"}}          |
        | {"dependencies":{"@x/sdk":"v1.0.0"}}              |
        | {"dependencies":"1.0.0"}                          |
        | null                                              |
        | 42                                                |
        | []                                                |
        | not json                                          |

    Scenario: a manifest that pins a version of several digits is accepted
      Given a watch register of one source of each kind over an in-memory repository
      And the watch repository holds the file "m/package.json" with '{"dependencies":{"@x/sdk":"10.20.30"}}'
      When the watch register is loaded
      Then the watch register is accepted

    Scenario: every fault of the schema is in the reason, one line, in order
      Given a watch register of one source of each kind over an in-memory repository
      And the watch register field "sources.0.id" is set to '"Bad_Id"'
      And the watch register field "sources.1.id" is set to '"Bad_Id"'
      When the watch register is loaded
      Then the watch register is refused with a reason holding "$.sources.0.id Invalid"
      And the watch register is refused with a reason holding "; $.sources.1.id Invalid"
