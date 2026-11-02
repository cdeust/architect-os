Feature: Test gate domain functions, observed directly
  Order of results, boundaries at zero and initial values that an end-to-end scenario over a git repository
  cannot isolate. The functions are the pure ones of src/domain and Workspace.

  Scenario: added and removed pickles are sorted, whatever the order of the static sets
    When the gate counts the static pickles "d, c" against those "b, a" of the first parent "abc"
    Then the gate count added pickles are "c, d"
    And the gate count removed pickles are "a, b"

  Scenario Outline: the base source is <source> when the first parent is <firstParent> and no base file exists
    When the gate counts the static pickles "a" against those "a" of the first parent "<firstParent>"
    Then the gate count base source is "<source>"

    Examples:
      | firstParent | source   |
      | none        | root     |
      | abc         | fallback |

  Scenario: lines of a diff before the first file header are ignored
    When the gate parses the unified diff:
      """
      @@ -1 +1 @@
      deleted file mode 100644
      diff --git a/x.mjs b/x.mjs
      @@ -1 +1 @@
      """
    Then the gate parsed diff is:
      """
      x.mjs: 1
      """

  Scenario: a hunk that adds twelve lines lists all twelve
    When the gate parses the unified diff:
      """
      diff --git a/x.mjs b/x.mjs
      @@ -0,0 +1,12 @@
      """
    Then the gate parsed diff is:
      """
      x.mjs: 1,2,3,4,5,6,7,8,9,10,11,12
      """

  Scenario: a hunk that replaces twelve lines by twelve lists the twelve new lines
    When the gate parses the unified diff:
      """
      diff --git a/x.mjs b/x.mjs
      @@ -10,12 +10,12 @@
      """
    Then the gate parsed diff is:
      """
      x.mjs: 10,11,12,13,14,15,16,17,18,19,20,21
      """

  Scenario: a line that continues after the file header is not a header, its hunks stay with the previous file
    When the gate parses the unified diff:
      """
      diff --git a/y.mjs b/y.mjs
      @@ -1 +1 @@
      diff --git a/x b/x extra
      @@ -5 +5 @@
      """
    Then the gate parsed diff is:
      """
      y.mjs: 1,5
      """

  Scenario: a production file with no added line is not in the perimeter
    When the gate computes the perimeter of the changes "src/a.mjs:"
    Then the gate perimeter changed files are ""
    And the gate perimeter files are ""

  Scenario: the files of the perimeter are sorted, and a changed .feature adds none
    When the gate computes the perimeter of the changes "src/z.mjs:3, specs/x.feature:1, src/a.mjs:1"
    Then the gate perimeter judged files are "src/a.mjs, src/z.mjs"
    And the gate perimeter files are "src/a.mjs, src/z.mjs"

  Scenario: the retired files join the files of the perimeter in order, not the judged files
    When the gate computes the perimeter of the changes "src/m.mjs:1" with the retired files "src/a.mjs, src/z.mjs"
    Then the gate perimeter judged files are "src/m.mjs"
    And the gate perimeter files are "src/a.mjs, src/m.mjs, src/z.mjs"

  Scenario: only the changed lines count
    Given a gate perimeter over "src/m.mjs" with changed lines "src/m.mjs:1"
    When the gate judges the mutation report:
      """
      {
        "mutate": ["src/m.mjs"],
        "files": {
          "src/m.mjs": {
            "source": ["export const a = 1;", "export const b = 2;", "export const c = 3;"],
            "mutants": [
              { "id": "1", "mutatorName": "StringLiteral", "status": "Killed", "startLine": 1, "endLine": 1 },
              { "id": "2", "mutatorName": "StringLiteral", "status": "Survived", "startLine": 2, "endLine": 2 },
              { "id": "3", "mutatorName": "StringLiteral", "status": "Survived", "startLine": 3, "endLine": 3 }
            ]
          }
        }
      }
      """
    Then the gate judged mutants are "1"

  Scenario: a Stryker directive is refused when it has no space after the slashes or two spaces before disable
    Given a gate perimeter over "src/m.mjs" with changed lines ""
    When the gate judges the mutation report:
      """
      {
        "mutate": ["src/m.mjs"],
        "files": {
          "src/m.mjs": {
            "source": [
              "//Stryker disable next-line EqualityOperator: équivalent: none",
              "// Stryker  disable next-line EqualityOperator: équivalent: none",
              "// Stryker disable next-line EqualityOperator: équivalent: none"
            ],
            "mutants": []
          }
        }
      }
      """
    Then the gate judgement violations are:
      """
      5: src/m.mjs:1 : directive Stryker refusée : //Stryker disable next-line EqualityOperator: équivalent: none
      5: src/m.mjs:2 : directive Stryker refusée : // Stryker  disable next-line EqualityOperator: équivalent: none
      """

  Scenario: the workspace globs sorted paths and prunes the excluded ones
    Given a gate workspace holding the files "zeta/a.x, alpha/b.x, alpha/a.x, mid/a.x, node_modules/n/q.x"
    When the gate workspace globs "**/*.x" excluding "**/node_modules/**"
    Then the gate workspace paths are "alpha/a.x, alpha/b.x, mid/a.x, zeta/a.x"
