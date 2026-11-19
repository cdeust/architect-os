Feature: The free space of a runtime admission (domain: integer arithmetic, strictly above each floor)
  A sample counts the blocks available to an unprivileged caller, in their unit; its bytes are their product, as an
  integer. The root is compared first, then the home, each with its own floor and strictly above it, even when the two
  are on one device: the bytes are never added.

  Scenario Outline: a runtime sample of <blocks> blocks of <unit> bytes holds <bytes> available bytes
    When a runtime space sample of "<blocks>" blocks of "<unit>" bytes is observed
    Then the runtime space observation holds "<bytes>" available bytes on its device

    Examples:
      | blocks           | unit | bytes               |
      | 10               | 4096 | 40960               |
      | 3                | 512  | 1536                |
      | 0                | 4096 | 0                   |
      | 7                | 1    | 7                   |
      | 2251799813685249 | 4096 | 9223372036854779904 |

  Scenario Outline: a runtime sample of <blocks> blocks of <unit> bytes proves nothing
    When a runtime space sample of "<blocks>" blocks of "<unit>" bytes is observed
    Then the runtime space observation is none

    Examples:
      | blocks | unit |
      | 10     | 0    |
      | 10     | -1   |
      | -1     | 4096 |

  Scenario Outline: with floors of 1000 bytes for the root and 500 for the home, <root> and <home> available bytes are <decision>
    Given a runtime reserve with a root floor of "1000" bytes and a home floor of "500" bytes
    When the runtime root holds "<root>" available bytes and the runtime home "<home>"
    Then the runtime space decision is "<decision>"

    Examples:
      | root | home | decision |
      | 999  | 501  | root-low |
      | 1000 | 501  | root-low |
      | 1001 | 501  | enough   |
      | 1001 | 499  | home-low |
      | 1001 | 500  | home-low |
      | 0    | 0    | root-low |
      | 999  | 499  | root-low |
      | 5000 | 5000 | enough   |

  Scenario Outline: a floor above the precision of a JavaScript number is compared byte for byte: <root> bytes are <decision>
    Given a runtime reserve with a root floor of "9007199254740993" bytes and a home floor of "1" bytes
    When the runtime root holds "<root>" available bytes and the runtime home "2"
    Then the runtime space decision is "<decision>"

    Examples:
      | root             | decision |
      | 9007199254740993 | root-low |
      | 9007199254740994 | enough   |
