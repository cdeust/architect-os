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
