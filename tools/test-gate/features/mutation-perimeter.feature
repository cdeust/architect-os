Feature: Gate source files have an unambiguous mutation perimeter
  Git counts LF-delimited lines. Stryker's Babel parser also sees lone CR, LS and PS.
  Stryker consumes patterns and its JSON reporter lists files only through their mutants.

  Scenario Outline: a separator that changes the parser's line coordinates is refused: <separator>
    Given a gate repository
    And the gate first parent is committed
    And the gate repository has a source with a <separator> separator at "src/leaf.mjs"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINE_SEPARATOR : src/leaf.mjs"

    Examples:
      | separator |
      | CR        |
      | LS        |
      | PS        |

  Scenario: a lone CR in an untracked production file is refused
    Given a gate repository
    And the gate first parent is committed
    And the gate head is committed
    And the gate repository has a source with a CR separator at "src/leaf.mjs"
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINE_SEPARATOR : src/leaf.mjs"

  Scenario: a Unicode separator in a root commit's production file is refused
    Given a gate repository
    And the gate repository has a source with a LS separator at "src/leaf.mjs"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINE_SEPARATOR : src/leaf.mjs"

  Scenario Outline: a regular source with <separator> has a literal two-line mutation plan
    Given a gate repository
    And the gate first parent is committed
    And the gate repository has a source with a <separator> separator at "src/leaf.mjs"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 0
    And the gate writes exactly the literal mutation pattern "src/leaf.mjs:1-2"

    Examples:
      | separator |
      | LF        |
      | CRLF      |

  Scenario Outline: a production path with a glob metacharacter is refused: <path>
    Given a gate repository
    And the gate first parent is committed
    And the gate repository has a source with a LF separator at "<path>"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_MUTATION_PATH_PATTERN : <path>"

    Examples:
      | path              |
      | src/leaf[ab].mjs  |
      | src/leaf[.mjs     |
      | src/leaf].mjs     |
      | src/leaf{a,b}.mjs |
      | src/leaf{.mjs     |
      | src/leaf}.mjs     |
      | src/leaf*.mjs     |
      | src/leaf?.mjs     |
      | src/leaf!.mjs     |
      | src/leaf(.mjs     |
      | src/leaf).mjs     |

  Scenario Outline: a path character that Stryker normalizes or cannot put in a range is refused: <character>
    Given a gate repository
    And the gate first parent is committed
    Then the gate refuses a <character> in the mutation path before building a pattern

    Examples:
      | character |
      | backslash |
      | LF        |
      | CR        |
      | LS        |
      | PS        |

  Scenario: a tracked production file replaced by a link is refused before its patch is read
    Given a gate repository
    And the gate repository has a source with a LF separator at "src/leaf.mjs"
    And the gate first parent is committed
    And the gate repository replaces "src/leaf.mjs" with a file link to a disposable sibling
    And the gate head is committed
    Then the gate detects the raw link at "src/leaf.mjs" without opening the path
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINK : src/leaf.mjs"

  Scenario: an untracked source link is refused
    Given a gate repository
    And the gate first parent is committed
    And the gate head is committed
    And the gate repository replaces "src/leaf.mjs" with a file link to a disposable sibling
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINK : src/leaf.mjs"

  Scenario: a source link in the root commit is refused
    Given a gate repository
    And the gate repository replaces "src/leaf.mjs" with a file link to a disposable sibling
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINK : src/leaf.mjs"

  Scenario: a workspace read refuses a link in an intermediate directory
    Given a gate repository
    And the gate repository replaces "src" with a directory link to a disposable sibling
    Then the gate workspace refuses to read source "src/leaf.mjs" with "GATE_SOURCE_LINK : src/leaf.mjs"

  Scenario: mutation inventory cannot open a canary through a linked directory
    Given a gate repository
    And the gate configuration declares the canary "probe/leaf.mjs" with:
      """
      {}
      """
    And the gate first parent is committed
    And the gate head is committed
    And the gate repository replaces "probe" with a directory link to a disposable sibling
    When the gate inventories the mutation scope
    Then the mutation inventory is refused
    And the gate output includes "GATE_SOURCE_LINK : probe/leaf.mjs"

  Scenario: a source read refuses a non-regular file
    Given a gate repository
    And the gate workspace has a directory where the source "src/leaf.mjs" is expected
    Then the gate workspace refuses to read source "src/leaf.mjs" with "GATE_SOURCE_NOT_REGULAR : src/leaf.mjs"

  Scenario: the Darwin source open asks the kernel to check every component
    Then the gate uses the Darwin flag that forbids links in every component

  Scenario: workspace reads close the descriptors on success and absence
    Given a gate repository
    And the gate repository file "src/leaf.mjs" reads:
      """
      export const witness = 1;
      """
    Then the gate workspace closes its descriptors after source reads

  Scenario Outline: a workspace read refuses a path with <kind>
    Given a gate repository
    Then the gate workspace refuses to read source "<path>" with "GATE_SOURCE_PATH_INVALID : <path>"

    Examples:
      | kind           | path                |
      | an empty part  | /src/leaf.mjs       |
      | a current part | ./src/leaf.mjs      |
      | a parent part  | src/../leaf.mjs     |
