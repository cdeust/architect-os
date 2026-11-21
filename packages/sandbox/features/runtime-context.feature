Feature: Host entry verifies the allocation binding and its locations
  Background:
    Given a bound run for the runtime entry check

  Scenario: The entry validates every location
    Then every runtime location must equal its published path

  Scenario: The host configuration is explicitly present or absent
    Then runtime entry accepts only preserved host identity states

  Scenario: The public entry stops a refused command
    Then the runtime guard reports its refusal and accepts its bound context

  Scenario Outline: The checker refuses <fault>
    Then the runtime checker refuses "<fault>"

    Examples:
      | fault                            |
      | missing context                  |
      | another allocation binding       |
      | run at a different depth         |
      | invalid run name                 |
      | binding has an extra field       |
      | noncanonical base64              |
      | unknown binding                  |
      | invalid JSON                     |
      | wrong schema                     |
      | wrong receipt run                |
      | wrong root device                |
      | wrong root inode                 |
      | different receipt bytes          |
      | larger receipt                   |
      | different environment marker     |
      | linked marker                    |
      | linked receipt                   |
      | linked run                       |
      | linked cache                     |
      | aliased root                     |
      | hardlinked receipt               |
      | hardlinked npm config            |
      | nonempty npm config              |
      | directory for npm global config  |
      | file for a directory             |
      | missing run directory            |

  Scenario Outline: The descriptor is bounded while the receipt is read with <observation>
    Then runtime receipt reading handles "<observation>"

    Examples:
      | observation        |
      | early EOF          |
      | short reads        |
      | growth during read |
      | oversized file     |

  Scenario Outline: The allocation name must match the complete grammar for <name>
    Then the runtime checker refuses a run name shaped like "<name>"

    Examples:
      | name      |
      | xrAb9cX4  |
      | rAb9cX4x  |
      | rAb9-X4   |
      | rAb9cX    |

  Scenario Outline: Every opened descriptor is closed on <result>
    Then runtime receipt descriptors are closed after <result>

    Examples:
      | result  |
      | success |
      | refusal |

  Scenario: An opened file on another device or with the wrong type is never read
    Then runtime entry checks the opened receipt type and device before reading

  Scenario: Every published location must remain on the admitted device
    Then runtime entry rejects a published location on a different device

  Scenario: A filesystem root is refused before its paths are inspected
    Then runtime entry rejects a filesystem root before inspecting its paths

  Scenario: A valid allocation moved elsewhere preserves its inode and loses its parent
    Then a bound allocation moved out of the run parent is refused

  Scenario: The allocation directories are resolved before reading any receipt
    Then a linked allocation is refused before reading a receipt

  Scenario: The receipt is private while the installer marker is public
    Then the launcher marker may have two names while the receipt remains private

  Scenario: Inode identities above the safe Number range are exact
    Then the allocation binding retains exact filesystem integer precision

  Scenario: A physically valid run cannot normalize a misspelled root
    Then runtime entry requires the canonical spelling of the root itself
