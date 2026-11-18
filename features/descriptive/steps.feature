Feature: the folder steps/ keeps what each step saw
  steps/<name>/ is written by the host at the end of a step (packages/sandbox/README.md): the brief, the step file, one
  question per scout and record.json, which hashes each of them. The gate reads every folder: a brief edited after the
  run turns it red (docs/design/orchestration-fable-5-2.md, §14).

  Scenario: the committed folder steps/ of the repository follows the rule; while it is absent or empty, it passes on nothing
    Given the committed folder steps/ of the repository
    Then every entry of it follows the rule of the folders of steps

  Scenario: a valid step folder follows the rule
    Given a copy of steps/ holding the valid step folder "demo"
    Then every entry of it follows the rule of the folders of steps

  Scenario: a copy of steps/ with no entry follows the rule on nothing
    Given a copy of steps/ holding no step folder
    Then every entry of it follows the rule of the folders of steps

  Scenario Outline: a broken copy of steps/ is refused: <defect>
    Given a copy of steps/ holding the valid step folder "demo"
    When the copy is broken with <defect>
    Then that copy of steps/ is refused, because "<reason>"

    Examples:
      | defect                                   | reason                                                       |
      | a brief edited after the run             | demo: brief.md is not the file the record hashed             |
      | a step file edited after the run         | demo: step.json is not the file the record hashed            |
      | a question edited after the run          | demo: scout.files.md is not the file the record hashed       |
      | a file in excess                         | demo: notes.md is in excess                                  |
      | a directory in place of the brief        | demo: brief.md is not a regular file                         |
      | a missing scout question                 | demo: scout.files.md is missing                              |
      | a missing brief                          | demo: brief.md is missing                                    |
      | a missing record                         | demo: record.json is missing                                 |
      | a missing step file                      | demo: step.json is missing                                   |
      | a step file the schema refuses           | demo: step.json is refused                                   |
      | a record whose step is another name      | demo: record.step is other, not demo                         |
      | a record with an unknown field           | demo: record.json is refused                                 |
      | a record that is not JSON                | demo: record.json is refused                                 |
      | a record without the hash of the brief   | demo: record.inputs has no hash of brief.md                  |
      | a record with the hash of another file   | demo: record.inputs holds the hash of scout.other.md, which is not an input |
      | a steps/x that is a file                 | x: is not a directory                                        |
      | a folder named with an upper-case letter | Demo: its name is refused by the expression of the step names |
