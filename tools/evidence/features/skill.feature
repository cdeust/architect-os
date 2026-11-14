Feature: The descriptive files of the skill

  The skill is read by Claude Science, not by the host: these scenarios check what it must carry, and that a broken
  copy is told apart.

  Scenario: the committed answer schema is the one generated from the contract
    When I read the committed evidence answer schema
    Then the evidence answer schema is the one generated from the zod contract

  Scenario Outline: a changed copy of the answer schema differs from the generated one: <change>
    When I read the committed evidence answer schema
    And I change a copy of the evidence answer schema with "<change>"
    Then the evidence answer schema copy differs from the generated one

    Examples:
      | change                    |
      | a changed maximum         |
      | a key that is not required |
      | an open top level         |
      | an empty object           |

  Scenario: the committed skill has its front matter, and the codes of its table are those of the contract, in order
    When I read the committed evidence skill
    Then the evidence skill checks pass

  Scenario Outline: a broken copy of the skill is rejected: <defect>
    When I read the committed evidence skill
    And I break a copy of the evidence skill with "<defect>"
    Then the evidence skill checks fail

    Examples:
      | defect                       |
      | no front matter              |
      | an empty body                |
      | another name                 |
      | no description               |
      | a description of 1025 characters |
      | another license              |
      | no license                   |
      | a code missing               |
      | an unknown code added        |
      | two codes swapped            |
      | no table of reasons          |

  Scenario: a description of 1024 characters is accepted
    When I read the committed evidence skill
    And I break a copy of the evidence skill with "a description of 1024 characters"
    Then the evidence skill checks pass
