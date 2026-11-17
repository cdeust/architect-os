Feature: A folder of text files (the Files port: the repository, and the folder of --keep)

  Scenario Outline: a file written is read back, and one never written is absent
    Given a watch files folder of the <adapter> adapter
    When I write the watch file "tools/watch/indexes/docs.txt" with "a\nb\n"
    Then the watch file "tools/watch/indexes/docs.txt" reads "a\nb\n"
    And the watch file "tools/watch/indexes/docs.txt" exists
    And the watch file "tools/watch/indexes/other.txt" does not exist
    And the watch file "tools/watch/indexes/other.txt" reads nothing

    Examples:
      | adapter   |
      | in-memory |
      | disk      |

  Scenario Outline: a file written twice holds the second text
    Given a watch files folder of the <adapter> adapter
    When I write the watch file "x.txt" with "first"
    And I write the watch file "x.txt" with "second"
    Then the watch file "x.txt" reads "second"

    Examples:
      | adapter   |
      | in-memory |
      | disk      |

  Scenario: a folder is not a file: it reads as absent
    Given a watch files folder of the disk adapter
    When I write the watch file "dir/x.txt" with "a"
    Then the watch file "dir" reads nothing
    And the watch file "dir/x.txt/below" reads nothing
