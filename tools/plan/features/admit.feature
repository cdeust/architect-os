Feature: npm run admit issues the Step admission receipt only for an approved, independently reviewed Plan
  The issuing entry (journal, §125) re-derives the manifest from the three sources, requires a reviewed Plan, the
  operator's decision on that exact preview and a specimen proof, keeps the Step folder outside every checkout, then
  hands the evidence to the issuer of the sandbox package, which verifies the folder, the tree, the launcher and the
  specimens before writing anything.

  Background:
    Given a recorded delivery Plan input
    And the recorded proposal carries independent Define and Plan reviews
    When I prepare the Plan once
    And the operator records an approval of the preview
    And I materialize the Plan

  Scenario Outline: Every refusal before the issuer is named: <change>
    When the host runs admit with "<change>"
    Then admit refuses with "<code>" before the issuer

    Examples:
      | change                          | code                         |
      | an invalid Define               | ADMIT_INPUT_INVALID          |
      | a missing policy                | ADMIT_INPUT_INVALID          |
      | an unreviewed proposal          | ADMIT_REVIEWED_PLAN_REQUIRED |
      | no decision                     | ADMIT_NOT_APPROVED           |
      | a decision that is not JSON     | ADMIT_NOT_APPROVED           |
      | a decision for another preview  | ADMIT_NOT_APPROVED           |
      | a rejected decision             | ADMIT_NOT_APPROVED           |
      | no specimens                    | ADMIT_SPECIMENS_REQUIRED     |
      | specimens that are not JSON     | ADMIT_SPECIMENS_REQUIRED     |
      | a relative folder               | ADMIT_FOLDER_INVALID         |
      | a folder of another name        | ADMIT_FOLDER_INVALID         |
      | a non-normalized folder         | ADMIT_FOLDER_INVALID         |
      | an absent folder                | ADMIT_FOLDER_INVALID         |
      | a folder inside a checkout      | ADMIT_FOLDER_INVALID         |
      | a folder linked into a checkout | ADMIT_FOLDER_INVALID         |

  Scenario: The issuer receives the approved Plan with both independent reviews, and admit prints its receipt
    When the host runs admit with "measured specimens"
    Then the issuer received the approved manifest, its approval and both independent reviews
    And admit prints the issued receipt

  Scenario: A refusal of the issuer keeps its name
    Given the issuer refuses with "ADMIT_TREE_DIRTY"
    When the host runs admit with "measured specimens"
    Then admit exits with 2 and the diagnostic "ADMIT_TREE_DIRTY"

  Scenario Outline: An unexpected failure attests nothing: <failure>
    Given the issuer fails with "<failure>"
    When the host runs admit with "measured specimens"
    Then admit exits with 3 and the diagnostic "ADMIT_UNEXPECTED_ERROR"

    Examples:
      | failure                             |
      | an unnamed error                    |
      | a code with a tail                  |
      | a code with a head                  |
      | a code without a name               |
      | a thrown string                     |
      | a plain object with a code message  |

  Scenario Outline: Invocations of the wrong shape are refused: <shape>
    When the host runs admit with "<shape>"
    Then admit prints its usage before the issuer

    Examples:
      | shape            |
      | six arguments    |
      | eight arguments  |
      | an empty argument |

  Scenario: The admit entry only hands the process to runAdmit
    When the admit entry runs without arguments
    Then the admit entry printed its usage and set the exit code 2
