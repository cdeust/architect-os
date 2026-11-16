Feature: the journal of the design keeps every section
  docs/design/journal.md is the dated record of what was proven, decided and missed. Other documents cite its sections
  by number, and so do people outside the repository: a section is never removed nor renumbered. The file starts with
  its title, and its sections are numbered from 1 without a gap. A commit once rewrote the file with its new section
  alone, and the gate was green because nothing read the file (journal, §58).

  Scenario: the committed journal starts with its title and numbers its sections from 1 without a gap
    Given the committed journal of the design
    Then the journal starts with its title, and its sections are numbered from 1 without a gap

  Scenario Outline: a broken copy of the journal is refused: <defect>
    When a copy of the committed journal is read with <defect>
    Then that copy of the journal is refused, because "<reason>"

    Examples:
      | defect                                          | reason                                    |
      | only its last two sections                      | it does not start with its title          |
      | its title, then its sections from the second on | its section in position 1 is numbered 2   |
      | its third section missing                       | its section in position 3 is numbered 4   |
      | its second section twice                        | its section in position 3 is numbered 2   |
      | no section at all                               | it has no numbered section                |
      | another title                                   | it does not start with its title          |
