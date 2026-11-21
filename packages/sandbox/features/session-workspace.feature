Feature: Only the intended checkout and session are reopened beneath a runtime

  Scenario: Every native filesystem entry is literal on the pinned engine
    Then native session settings preserve every filesystem rule as exact paths

  Scenario Outline: Workspace visibility and parent write scopes
    Then session workspace binding handles "<case>"

    Examples:
      | case                               |
      | checkout outside the runtime       |
      | own checkout read fallback         |
      | own checkout keeps existing reads  |
      | linked checkout and git metadata   |
      | ordinary prefix neighbour          |
      | mutable runtime root               |
      | mutable run collection             |
      | mutable session collection         |
      | foreign checkout                   |
      | foreign primary repository         |
      | shared cache                       |
      | durable state                      |
      | complete current run               |
      | checkout contains all runtime data |
      | checkout equals runtime root       |
      | protected cache child              |
      | protected state child              |
      | run collection itself              |
      | checkout is session collection     |

  Scenario: The public host template vocabulary includes the admitted runtime
    Then the public host template variables identify the runtime and session locations
