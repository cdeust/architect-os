Feature: a tree the host pins, then runs from a private copy of the bytes it hashed
  Scenario: the pinned files are read once, in the byte order of their paths, without the skipped directory
    Given a pinned tree with a link in its skipped directory
    Then the pinned tree reads its regular files in the byte order of their paths
    And its digest is the shasum listing of those files

  Scenario Outline: what the pinned tree refuses: <entry>
    Given a pinned tree with a link in its skipped directory
    And the pinned tree also holds <entry>
    Then reading the pinned tree is refused with "<error>"

    Examples:
      | entry                    | error                  |
      | a named pipe             | PINNED_TREE_FILE       |
      | a socket                 | PINNED_TREE_FILE       |
      | a link to a file         | PINNED_TREE_LINK       |
      | a linked directory       | PINNED_TREE_LINK       |
      | a newline in a name      | PINNED_TREE_PATH       |
      | a backslash in a name    | PINNED_TREE_PATH       |
      | no required file         | PINNED_TREE_INCOMPLETE |
      | no included directory    | PINNED_TREE_INCOMPLETE |

  Scenario Outline: the bounds of the pinned tree: <bound>
    Given a pinned tree with a link in its skipped directory
    Then reading the pinned tree within "<bound>" yields "<outcome>"

    Examples:
      | bound             | outcome               |
      | exactly the files | accepted              |
      | one file too few  | PINNED_TREE_TOO_LARGE |
      | exactly the bytes | accepted              |
      | one byte too few  | PINNED_TREE_TOO_LARGE |

  Scenario: the staged copy is private, read-only and complete, whatever the umask of the host
    Given a pinned tree with a link in its skipped directory
    When the host stages the pinned tree under a permissive umask
    Then the staged tree holds exactly the pinned bytes, files 0400 and directories 0700
    And the umask of the host is restored
    And disposing of the staged tree removes it
    And disposing of it again is harmless

  Scenario: a copy that cannot be completed leaves nothing behind
    When the host stages files whose paths collide
    Then staging fails and the parent directory is left empty
