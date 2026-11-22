Feature: Gate report paths belong to the physical admitted run

  Scenario: The host resolves a report name through the current admission
    Then the Gate report resolver keeps regular files and new directories under the admitted reports directory

  Scenario Outline: Reject a substituted or invalid Gate report
    Then the Gate report resolver rejects "<case>"

    Examples:
      | case             |
      | missing receipt  |
      | absolute         |
      | wrong prefix     |
      | prefix only      |
      | empty component  |
      | current          |
      | parent           |
      | backslash        |
      | null byte        |
      | linked directory |
      | linked file      |
      | hardlinked file  |
      | fifo             |

  Scenario: Concurrent callers request a private directory and tolerate an existing directory
    Then the Gate requests private permissions when it claims its reports directory

  Scenario: A failure allocating the reports directory stops the caller
    Then the Gate propagates the original report directory allocation error

  Scenario: The path is replaced after its metadata was read
    Then the Gate rejects a report directory replaced by a link during resolution

  Scenario: A regular report is on another device
    Then the Gate rejects a regular report with a different device identity
