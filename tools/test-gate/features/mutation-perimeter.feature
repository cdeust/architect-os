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
    And the gate writes exactly the literal mutation pattern "src/leaf.mjs"

    Examples:
      | separator |
      | LF        |
      | CRLF      |

  Scenario Outline: the installed matcher selects the literal gate path: <path>
    Given a gate repository under a bracketed directory
    And the gate first parent is committed
    And the gate repository has a source with a LF separator at "<path>"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the installed mutation matcher selects "<path>" and only that file instead of "<sibling>"

    Examples:
      | path              | sibling         |
      | src/leaf.mjs      | src/leafa.mjs   |
      | src/leaf[ab].mjs  | src/leafa.mjs   |
      | src/leaf[.mjs     | src/leaf.mjs    |
      | src/leaf].mjs     | src/leaf.mjs    |
      | src/leaf*.mjs     | src/leafa.mjs   |
      | src/leaf?.mjs     | src/leafa.mjs   |
      | src/leaf!.mjs     | src/leaf.mjs    |
      | src/leaf(1).mjs   | src/leaf1.mjs   |
      | src/leaf).mjs     | src/leaf.mjs    |

  Scenario Outline: brace syntax is refused before minimatch expands the path
    Given a gate repository
    And the gate first parent is committed
    And the gate repository has a source with a LF separator at "<path>"
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_MUTATION_PATH_PATTERN : <path>"

    Examples:
      | path              |
      | src/leaf{a,b}.mjs |
      | src/leaf{.mjs     |
      | src/leaf}.mjs     |

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

  Scenario Outline: the <job> job reads only its production inputs
    Given a gate repository
    And the gate first parent is committed
    And the gate repository holds a symlink at "docs/latest.md"
    And the gate repository holds a symlink at "<path>"
    And the gate head is committed
    When the gate plans the "<job>" job
    Then the gate exits with 0

    Examples:
      | job   | path         |
      | linux | docs/link.md |
      | macos | src/link.mjs |

  Scenario Outline: the Gate refuses invalid source bytes in <job> mutation planning
    Given a gate repository
    And the gate first parent is committed
    And the gate repository holds a production source with an invalid UTF-8 comment
    And the gate head is committed
    When the gate <operation>
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_UTF8 : src/bad.mjs"

    Examples:
      | job       | operation                    |
      | local     | plans the "linux" job         |
      | inventory | inventories the mutation scope |
      | local     | checks the "linux" job        |

  Scenario Outline: a debt command refuses a symlink read as a named workspace error
    Given a gate repository
    And the gate repository holds a symlink at "reports/mutation/mutation.json"
    And the gate repository holds a symlink for the debt registry when "<command>" reads it
    When the gate runs the debt command "<command>"
    Then the gate exits with 1
    And the gate output includes "GATE_SOURCE_LINK : <path>"

    Examples:
      | command | path                           |
      | debt    | reports/mutation/mutation.json |
      | realign | mutation-debt.json             |

  Scenario: a configuration replaced by a link is refused as a named workspace error, before any command reads it
    Given a gate repository
    And the gate configuration is absent
    And the gate repository holds a symlink at "tools/test-gate/gate.json"
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output is:
      """
      porte de test : GATE_SOURCE_LINK : tools/test-gate/gate.json
      """

  Scenario Outline: a workspace read gives nothing for a source under <parent>, and a required source is refused
    Given a gate repository
    And the gate repository file "src/leaf.mjs" reads:
      """
      export const witness = 1;
      """
    Then the gate workspace reads nothing at "<path>"

    Examples:
      | parent              | path                    |
      | a missing directory | src/missing/leaf.mjs    |
      | a regular file      | src/leaf.mjs/inner.mjs  |

  Scenario: a workspace that keeps its reports elsewhere writes there only the paths under reports/
    Given a gate repository
    Then the gate workspace writes "reports/out.json" to its report place and "notes/reports/out.json" to its tree

  Scenario: a production file whose name begins with an exclamation mark is a literal pattern, not an exclusion
    Given a gate repository
    And the gate configuration takes the production files of the root as well
    And the gate first parent is committed
    And the gate repository file "!leaf.mjs" reads:
      """
      export const witness = 1;
      """
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 0
    And the gate writes exactly the literal mutation pattern "./!leaf.mjs"

  Scenario: a repository under a directory with braces is refused before a pattern is built, since Stryker would expand them
    Given a gate repository under a braced directory
    And the gate first parent is committed
    And the gate repository file "src/leaf.mjs" reads:
      """
      export const witness = 1;
      """
    And the gate head is committed
    When the gate plans the "linux" job
    Then the gate exits with 1
    And the gate output includes "GATE_MUTATION_PATH_PATTERN : "

  Rule: a link where a directory of production sources could be is refused, since Node would load through it sources the gate never lists

    Git lists a link as one path and never descends into it: a directory of sources replaced by a link to a copy elsewhere
    showed its files as deleted, with no line to mutate, while the tests ran the copy.

    Scenario: a tracked directory of sources replaced by a committed link is refused
      Given a gate repository
      And the gate repository has a source with a LF separator at "src/leaf.mjs"
      And the gate first parent is committed
      And the gate repository replaces "src" with a directory link to a disposable sibling
      And the gate head is committed
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output is:
        """
        porte de test : GATE_SOURCE_LINK : src
        """

    Scenario: an untracked link where a module directory could be is refused
      Given a gate repository
      And the gate first parent is committed
      And the gate head is committed
      And the gate repository replaces "mod/one" with a directory link to a disposable sibling
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output is:
        """
        porte de test : GATE_SOURCE_LINK : mod/one
        """

    Scenario: a link of a root commit where the directory of sources could be is refused
      Given a gate repository
      And the gate repository replaces "src" with a directory link to a disposable sibling
      And the gate head is committed
      When the gate plans the "linux" job
      Then the gate exits with 1
      And the gate output is:
        """
        porte de test : GATE_SOURCE_LINK : src
        """

    Scenario: a regular file where a module directory could be, and a link outside the sources, are accepted
      Given a gate repository
      And the gate first parent is committed
      And the gate repository file "mod/notes" reads:
        """
        a note
        """
      And the gate repository holds a symlink at "docs/latest"
      And the gate head is committed
      And the gate repository file "mod/draft" reads:
        """
        an untracked note
        """
      When the gate plans the "linux" job
      Then the gate exits with 0

    Scenario Outline: the directory "<path>" may hold a production file of the fixture configuration: <may>
      Given a gate repository
      Then the directory "<path>" may hold a production file of the gate configuration: <may>

      Examples:
        | path           | may | reason                                         |
        | src            | yes | the first segment of src/**/*.mjs              |
        | src/a/b        | yes | under the ** of src/**/*.mjs                   |
        | mod            | yes | the first segment of mod/*/src/**/*.mjs        |
        | mod/one        | yes | the * of mod/*/src/**/*.mjs                    |
        | mod/one/src    | yes | every segment of mod/*/src matched             |
        | mod/one/lib    | no  | lib is not src                                 |
        | docs           | no  | no glob begins with docs                       |
        | leaf.mjs       | no  | a file segment is not a directory: *.mjs root  |
