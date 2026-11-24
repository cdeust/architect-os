Feature: Test gate diff against the first parent
  `git diff --unified=0 --no-renames <first parent>` against the working tree (O-2: never a merge-base, never a
  branch compared to main), plus untracked files as whole additions. Lines are numbered in the working tree.

  Background:
    Given a gate repository
    And the gate repository file "src/long.mjs" reads:
      """
      // 1
      // 2
      // 3
      // 4
      // 5
      // 6
      // 7
      // 8
      // 9
      // 10
      // 11
      // 12
      // 13
      // 14
      // 15
      """
    And the gate repository file "src/gone.mjs" reads:
      """
      -- a line that shows as --- once removed
      """
    And the gate first parent is committed

  Scenario: modified, added and deleted files, multi-digit hunks, a hunk without count, a pure deletion
    Given the gate repository file "src/long.mjs" reads:
      """
      // 1
      // 2
      // 4
      // 5
      // 6
      // 7
      // 8
      // 9
      // ten
      // eleven
      // twelve
      // 13
      // fourteen
      // 15
      """
    And the gate repository file "src/added.mjs" reads:
      """
      diff --git a/fake b/fake
      @@ -1 +1 @@
      deleted file mode 100644
      """
    And the gate repository file "src/gone.mjs" is removed
    And the gate head is committed
    Then the gate changes against the first parent are:
      """
      src/added.mjs: 1,2,3
      src/gone.mjs (supprimé):
      src/long.mjs: 9,10,11,13
      """

  Scenario: untracked files are additions, line by line, the last one included
    Given the gate head is committed
    And the gate repository file "src/new.mjs" reads:
      """
      export const a = 1;
      export const b = 2;
      """
    Then the gate changes against the first parent are:
      """
      src/new.mjs: 1,2,3
      """

  Rule: what a session wrote in the tree hides none of the lines it changed

    The gate reads the attributes of the empty tree, the paths as git lists them between NUL bytes, and the content of
    each changed path as text. Each scenario below gave a changed file with no changed line, or no file at all, when the
    gate read one porcelain diff of the whole tree.

    Scenario: an attribute file that marks a changed file as without diff hides none of its lines
      Given the gate repository file "src/.gitattributes" reads:
        """
        gone.mjs -diff
        """
      And the gate repository file "src/gone.mjs" reads:
        """
        a changed line
        """
      And the gate head is committed
      Then the gate changes against the first parent are:
        """
        src/.gitattributes: 1
        src/gone.mjs: 1
        """

    Scenario: the same attribute file, left out of the commit by an ignore rule, hides none of its lines either
      Given the gate repository file ".gitignore" reads:
        """
        reports/
        .gitattributes
        """
      And the gate repository file "src/.gitattributes" reads:
        """
        gone.mjs binary
        """
      And the gate repository file "src/gone.mjs" reads:
        """
        a changed line
        """
      And the gate head is committed
      Then the gate changes against the first parent are:
        """
        .gitignore: 2
        src/gone.mjs: 1
        """

    Scenario: a NUL byte in a changed file does not make it a file without changed lines
      Given the gate repository file "src/gone.mjs" reads "a changed line" then a NUL byte
      And the gate head is committed
      Then the gate changes against the first parent are:
        """
        src/gone.mjs: 1
        """

    Scenario: a path that git would quote in a header keeps its name and its lines
      Given the gate repository file 'src/we"ird\name.mjs' reads:
        """
        one
        two
        """
      And the gate head is committed
      Then the gate changes against the first parent are:
        """
        src/we"ird\name.mjs: 1,2
        """

    Scenario: an attribute that makes git call a rewritten file unchanged does not hide its line
      Given the gate repository file "src/id.mjs" reads:
        """
        // $Id$
        """
      And the gate head is committed
      And the gate repository file ".gitattributes" reads:
        """
        *.mjs ident
        """
      And the gate head is committed
      And the gate repository file "src/id.mjs" reads:
        """
        // $Id: a line the first parent does not hold $
        """
      Then the gate changes against the first parent are:
        """
        .gitattributes: 1
        src/id.mjs: 1
        """

  Scenario: a production caller sees only its requested files
    Then the Gate path selector filters tracked, changed and untracked files
