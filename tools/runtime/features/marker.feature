Feature: The marker of a runtime root (domain: its exact bytes)
  The installer writes `<root>/.architect-os-runtime-root` once: the line `architect-os-runtime-root/v2` and the line
  `environment=<name>`, each ending with one LF, in printable ASCII. Anything else is invalid, except a marker that
  names no environment, which is told apart; whether the policy knows the name is the admission's question.

  Scenario Outline: the runtime marker "<text>" reads as <reading>
    When the runtime marker bytes "<text>" are read
    Then the runtime marker reads as "<reading>"

    Examples:
      | text                                                                                 | reading                   |
      | architect-os-runtime-root/v2\nenvironment=workstation\n                              | environment=workstation   |
      | architect-os-runtime-root/v2\nenvironment=hosted-runner\n                            | environment=hosted-runner |
      | architect-os-runtime-root/v2\nenvironment=server\n                                   | environment=server        |
      | architect-os-runtime-root/v2\nenvironment=laptop\n                                   | environment=laptop        |
      | architect-os-runtime-root/v2\nenvironment=a b~\n                                     | environment=a b~          |
      | architect-os-runtime-root/v2\nenvironment==\n                                        | environment==             |
      | architect-os-runtime-root/v2\n                                                       | no-environment            |
      | architect-os-runtime-root/v2\nenvironment=\n                                         | no-environment            |
      | architect-os-runtime-root/v1\n                                                       | invalid                   |
      | architect-os-runtime-root/v1\nenvironment=workstation\n                              | invalid                   |
      | architect-os-runtime-root/v3\nenvironment=workstation\n                              | invalid                   |
      | Architect-os-runtime-root/v2\nenvironment=workstation\n                              | invalid                   |
      | architect-os-runtime-root/v2 \nenvironment=workstation\n                             | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=workstation                                | invalid                   |
      | architect-os-runtime-root/v2                                                         | invalid                   |
      |                                                                                      | invalid                   |
      | \n                                                                                   | invalid                   |
      | architect-os-runtime-root/v2\r\nenvironment=workstation\r\n                          | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=workstation\r\n                            | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=workstation\nenvironment=server\n          | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=workstation\nenvironment=workstation\n     | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=workstation\n\n                            | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=workstation\nx\n                           | invalid                   |
      | architect-os-runtime-root/v2\n\nenvironment=workstation\n                            | invalid                   |
      | architect-os-runtime-root/v2\nenv=workstation\n                                      | invalid                   |
      | architect-os-runtime-root/v2\n environment=workstation\n                             | invalid                   |
      | architect-os-runtime-root/v2\nENVIRONMENT=workstation\n                              | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=wörkstation\n                         | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=work\tstation\n                            | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=work\u001fstation\n                        | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=work\u007fstation\n                        | invalid                   |
      | architect-os-runtime-root/v2\nenvironment=work\u0000station\n                        | invalid                   |
      | environment=workstation\narchitect-os-runtime-root/v2\n                              | invalid                   |

  Scenario Outline: a runtime marker of <size> bytes reads as <reading>
    When a runtime marker of <size> bytes that names an environment is read
    Then the runtime marker reads as an environment: <environment>

    Examples:
      | size | reading                 | environment |
      | 256  | the environment it names | yes         |
      | 257  | invalid                 | no          |
