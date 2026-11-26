Feature: The released policy identifies the programs and paths that require maintenance

  Scenario Outline: the owner installation selects the forge executable for its host
    Then on <platform> <arch> the installed forge program is "<program>"

    Examples:
      | platform | arch  | program              |
      | darwin   | arm64 | /opt/homebrew/bin/gh |
      | darwin   | x64   | /usr/local/bin/gh    |
      | linux    | arm64 | /usr/bin/gh          |

  Scenario Outline: directory boundaries, directories at any depth and basename patterns classify a committed path
    Then the released judge classifies "<path>" as "<kind>"

    Examples:
      | path                     | kind     |
      | tools/test               | ordinary |
      | tools/test-gate-notes/x  | ordinary |
      | tools/test-gate          | judge    |
      | tools                    | judge    |
      | tools/test-gate/.hidden  | judge    |
      | TOOLS/TEST-GATE/config   | judge    |
      | other/tools/test-gate/x  | ordinary |
      | nested/package.json      | judge    |
      | package.json.txt         | ordinary |
      | node_modules/x/index.js  | judge    |
      | tools/node_modules/x.js  | judge    |
      | tools/node_modules       | judge    |
      | NODE_MODULES/x           | judge    |
      | tools/node_modules_x/y   | ordinary |
      | my-node_modules/x        | ordinary |
      | nested/tool.cjs          | judge    |
      | nested/tool.cjs.txt      | ordinary |
