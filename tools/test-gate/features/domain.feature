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

  Scenario: a hunk that adds twelve lines lists all twelve
    When the gate reads the hunks of the patch:
      """
      diff --git a/x.mjs b/x.mjs
      index 1111111..2222222 100644
      --- a/x.mjs
      +++ b/x.mjs
      @@ -0,0 +1,12 @@
      """
    Then the gate changed lines of the patch are "1,2,3,4,5,6,7,8,9,10,11,12"

  Scenario: a hunk that replaces twelve lines by twelve lists the twelve new lines
    When the gate reads the hunks of the patch:
      """
      @@ -10,12 +10,12 @@
      """
    Then the gate changed lines of the patch are "10,11,12,13,14,15,16,17,18,19,20,21"

  Scenario: a hunk without count is one line, a pure deletion is none, and the hunks of a patch add up
    When the gate reads the hunks of the patch:
      """
      @@ -3 +3 @@
      @@ -7,2 +6,0 @@
      @@ -20,0 +19,2 @@ a function name after the hunk
      """
    Then the gate changed lines of the patch are "3,19,20"

  Scenario: a content line that holds what looks like a hunk is not a hunk
    When the gate reads the hunks of the patch:
      """
      @@ -1 +1,3 @@
      -@@ -50 +50 @@
      +@@ -60 +60 @@
      + @@ -70 +70 @@
      """
    Then the gate changed lines of the patch are "1,2,3"

  Scenario: a patch with no hunk has no changed line
    When the gate reads the hunks of the patch:
      """
      diff --git a/x.mjs b/x.mjs
      old mode 100644
      new mode 100755
      """
    Then the gate changed lines of the patch are ""

  Scenario: a changed path with a patch has the lines of its hunks
    When the gate reads the lines of the changed path "src/a.mjs" from the patch:
      """
      @@ -3 +3,2 @@
      """
    Then the gate changed lines of the patch are "3,4"

  Scenario: a changed path whose patch is empty is refused: the path named nothing when it was given back to git
    Then the gate refuses the empty patch of the changed path "src/a.mjs" with "chemin changé sans diff : src/a.mjs"

  Scenario Outline: what git printed is read exactly when it is UTF-8: <case>
    When the gate decodes the bytes "<hex>" that git printed
    Then the gate decoded text is "<text>"

    Examples:
      | case                 | hex                    | text       |
      | plain letters        | 7372632f612e6d6a73     | src/a.mjs  |
      | an accented letter   | 7372632fc3a92e6d6a73   | src/é.mjs  |
      | a byte order mark    | efbbbf61               | \uFEFFa   |
      | nothing              |                        |            |

  Scenario Outline: a name that is not UTF-8 is refused, never read under another spelling: <case>
    When the gate decodes the bytes "<hex>" that git printed
    Then the gate refuses the bytes with "un chemin de git n'est pas de l'UTF-8"

    Examples:
      | case                      | hex                  |
      | a byte no sequence starts | 7372632fff2e6d6a73   |
      | a sequence cut short      | 7372632fc32e6d6a73   |
      | an overlong encoding      | c0af                 |

  Scenario: the list of the changed paths gives each path as it is, and says which are deleted
    When the gate reads the list of changed paths, one field per line:
      """
      :100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 M
      src/a.mjs
      :000000 100644 0000000000000000000000000000000000000000 0000000000000000000000000000000000000000 A
      src/we"ird name.mjs
      :100644 000000 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 D
      src/gone.mjs
      :100644 120000 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 T
      src/link.mjs
      """
    Then the gate changed paths are:
      """
      src/a.mjs
      src/we"ird name.mjs
      src/gone.mjs (supprimé)
      src/link.mjs
      """

  Scenario: an empty list of changed paths is no path
    When the gate reads the list of changed paths ""
    Then the gate changed paths are none

  Scenario Outline: a list of changed paths the gate does not understand is refused: <case>
    When the gate reads the list of changed paths "<list>"
    Then the gate refuses the list of changed paths with "<message>"

    Examples:
      | case                         | list                                                                                                    | message                               |
      | no NUL at its end            | :100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 M<NUL>a | liste des chemins changés illisible   |
      | a record without its path    | :100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 M<NUL>  | liste des chemins changés illisible   |
      | an empty path                | :100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 M<NUL><NUL> | liste des chemins changés illisible |
      | a status it does not know    | :100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 U<NUL>a<NUL> | liste des chemins changés illisible |
      | an abbreviated object name   | :100644 100644 1111111 0000000 M<NUL>a<NUL>                                                             | liste des chemins changés illisible   |
      | text before the record       | x:100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 M<NUL>a<NUL> | liste des chemins changés illisible |
      | text after the status        | :100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 MM<NUL>a<NUL> | liste des chemins changés illisible |
      | a nested repository added    | :000000 160000 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 A<NUL>sub<NUL> | dépôt imbriqué dans l'arbre : sub |
      | a nested repository removed  | :160000 000000 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 D<NUL>sub<NUL> | dépôt imbriqué dans l'arbre : sub |

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

  Scenario Outline: replay files with equal counts retain inventory path order, <case>
    When the gate distributes replay files "<files>"
    Then the first replay lot is "<first>" and the second is "<second>"

    Examples:
      | case                   | files                  | first    | second |
      | heavier files first    | a:2, b:2, c:1, z:3     | z, c     | a, b   |
      | paths break a tie      | a:1, b:1, c:1          | a, c     | b      |
      | zero native mutants    | a:2, b:0, c:0, z:2     | a, b, c  | z      |
      | no files               |                        |          |        |

  Scenario Outline: native evidence supports multiline mutation debt only in the proven scope
    When the gate judges the "<disposition>" multiline debt with native scope "<attestation>" and Git lines "<lines>"
    Then the gate confirms <detected> detected and <removed> retired debt entries without violations

    Examples:
      | disposition | attestation | lines | detected | removed |
      | retained    | [1,2]       | [1,3] | 1        | 0       |
      | retained    | [4]         | [2]   | 0        | 0       |
      | retained    | absent      | [2]   | 0        | 0       |
      | retained    | whole       | []    | 0        | 0       |
      | retained    | whole       | [2]   | 1        | 0       |
      | retired     | whole       | []    | 0        | 1       |
