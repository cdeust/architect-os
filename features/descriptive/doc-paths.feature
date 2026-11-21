Feature: the documents cite paths that exist
  CLAUDE.md and docs/ describe the tree as it is: a path they cite between backticks, from the root of the repository,
  names a file or a directory of it. Two commits removed the first realisation and Docker and left their paths in
  these documents, and the gate was green because nothing read them (journal, §68). A pattern or a placeholder
  (`services/<name>/worker`, `data/sql/*.sql`) is not a path, and a path into a directory that a build or a run
  writes (dist, node_modules, reports) depends on the host: neither is checked. The Examples list the documents
  that describe the tree; the journal and the design keep the paths of what was removed, and are not among them.

  Scenario Outline: every path of the repository that <document> cites exists
    Given the committed document "<document>"
    Then every path of the repository it cites exists

    Examples:
      | document                  |
      | CLAUDE.md                 |
      | CONTRIBUTING.md           |
      | README.md                 |
      | SECURITY.md               |
      | docs/agents.md            |
      | docs/architecture.md      |
      | docs/bricks.md            |
      | docs/claude-code-watch.md |
      | docs/design.md            |
      | docs/infrastructure.md    |
      | docs/operating.md         |
      | docs/testing.md           |

  Scenario Outline: a copy of a document that cites a path that does not exist is refused: <citation>
    When a copy of the committed document "CLAUDE.md" also cites "<citation>"
    Then that copy of the document is refused for the path "<path>"

    Examples:
      | citation                           | path                             |
      | `gateway/src/no-such-file.ts`      | gateway/src/no-such-file.ts      |
      | `docs/no-such-document.md`         | docs/no-such-document.md         |
      | `gateway/src/no-such-file.ts:12`   | gateway/src/no-such-file.ts      |
      | `docs/no-such-document.md#section` | docs/no-such-document.md         |
      | `features/no-such-directory/`      | features/no-such-directory/      |

  Scenario Outline: what is not a path of the repository is not checked: <citation>
    When a copy of the committed document "CLAUDE.md" also cites "<citation>"
    Then that copy of the document is accepted

    Examples:
      | citation                          |
      | `services/<name>/no-such-file.ts` |
      | `data/sql/*.no-such-extension`    |
      | `gateway/dist/no-such-file.js`    |
      | `node_modules/no-such-package/x`  |
      | `elsewhere/no-such-file.ts`       |
      | `no-such-file.ts`                 |
      | `gateway/src no-such-file.ts`     |
