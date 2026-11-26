Feature: what a promoted pass receives of the findings before it, cut at a bound in bytes
  The findings of a blocking verdict reach the next build and the next review as lines, their texts JSON-encoded, at most
  a bound in bytes, each line counted with its line break (docs/design/orchestration-fable-5-2.md, §13). A finding the
  bound cuts reaches neither; before the review it carries no id, so the review is not asked to rule on it.

  Scenario Outline: the findings given to the next build, with a bound of <bound> bytes
    Given 3 blocking findings, each with a reason of 28 characters
    When the host renders them for the next build within <bound> bytes
    Then the build lines are "<lines>"

    Examples:
      | bound | lines                                                                                              |
      | 153   | 1; 2; 3                                                                                            |
      | 152   | 1; 2; - 1 more findings, cut at 152 bytes                                                          |
      | 102   | 1; 2; - 1 more findings, cut at 102 bytes                                                          |
      | 101   | 1; - 2 more findings, cut at 101 bytes                                                             |
      | 50    | - 3 more findings, cut at 50 bytes                                                                 |

  Scenario Outline: the findings given to the next review, with a bound of <bound> bytes: only those it received have an id
    Given 3 blocking findings, each with a reason of 28 characters
    When the host renders them for the next review within <bound> bytes
    Then the review is asked to rule on "<ids>"
    And the review lines end with: <last>

    Examples:
      | bound | ids              | last                                                 |
      | 168   | PF-1 PF-2 PF-3   | - PF-3 correctness "f":1 "xxxxxxxxxxxxxxxxxxxxxxxxxxxx" |
      | 167   | PF-1 PF-2        | - 1 more findings, cut at 167 bytes, carry no id     |
      | 112   | PF-1 PF-2        | - 1 more findings, cut at 112 bytes, carry no id     |
      | 111   | PF-1             | - 2 more findings, cut at 111 bytes, carry no id     |
      | 55    |                  | - 3 more findings, cut at 55 bytes, carry no id      |
