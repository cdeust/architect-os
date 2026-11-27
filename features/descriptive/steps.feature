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

  Scenario: a Step record can carry the same tickets as its approved input
    Given a copy of steps/ holding a ticketed step folder "demo"
    Then every entry of it follows the rule of the folders of steps

  Scenario Outline: Editing a ticket in the record cannot change an approved estimate
    Given a copy of steps/ holding a ticketed step folder "demo"
    When the copy is broken with <defect>
    Then that copy of steps/ is refused, because "<reason>"

    Examples:
      | defect                         | reason                                        |
      | a different recorded estimate  | demo: record.tickets differs from step.json   |
      | tickets removed from the record| demo: record.tickets differs from step.json   |
      | a cycle in the recorded tickets| demo: record.json is refused                  |

  Scenario: a file that the repository ignores, beside the folders and inside one, is not judged: it can never be committed
    Given a copy of steps/ in a repository that ignores ".DS_Store" and "node_modules/", holding the valid step folder "demo"
    When the copy holds the file ".DS_Store"
    And the copy holds the file "demo/.DS_Store"
    Then every entry of it follows the rule of the folders of steps

  Scenario: a directory that the repository ignores, with a file in it, beside the folders and inside one, is not judged
    Given a copy of steps/ in a repository that ignores ".DS_Store" and "node_modules/", holding the valid step folder "demo"
    When the copy holds the file "node_modules/pkg/index.js"
    And the copy holds the file "demo/node_modules/pkg/index.js"
    Then every entry of it follows the rule of the folders of steps

  Scenario: an empty directory beside the folders is not judged: git cannot commit it
    Given a copy of steps/ in a repository that ignores ".DS_Store" and "node_modules/", holding the valid step folder "demo"
    When the copy holds the empty directory "scratch"
    Then every entry of it follows the rule of the folders of steps

  Scenario: in the same repository, a file that is not ignored is still refused
    Given a copy of steps/ in a repository that ignores ".DS_Store" and "node_modules/", holding the valid step folder "demo"
    When the copy holds the file "demo/notes.md"
    Then that copy of steps/ is refused, because "demo: notes.md is in excess"

  Scenario: in the same repository, a file in a subdirectory of a step folder is refused
    Given a copy of steps/ in a repository that ignores ".DS_Store" and "node_modules/", holding the valid step folder "demo"
    When the copy holds the file "demo/more/notes.md"
    Then that copy of steps/ is refused, because "demo: more is in excess"

  Scenario: an exclusion file of the host that names a file does not hide it from the rule
    Given a copy of steps/ in a repository that ignores ".DS_Store" and "node_modules/", holding the valid step folder "demo"
    And the global git configuration of the host excludes "notes.md"
    When the copy holds the file "demo/notes.md"
    Then that copy of steps/ is refused, because "demo: notes.md is in excess"

  Scenario: a step folder that is added and committed is judged: it follows the rule
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the copy is added and committed
    Then every entry of it follows the rule of the folders of steps

  Scenario: a committed step folder whose brief is edited on disk is refused
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the copy is added and committed
    And the copy is broken with a brief edited after the run
    Then that copy of steps/ is refused, because "demo: brief.md is not the file the record hashed"

  Scenario: a tracked step folder removed from the disk and not from the index is refused, not thrown
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the copy is added and committed
    And the path "demo" of the copy is removed from the disk only
    Then that copy of steps/ is refused, because "demo: is not a directory"

  Scenario: the whole folder steps/ removed from the disk while git still lists it is refused
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the copy is added and committed
    And the folder steps/ of the copy is removed from the disk only
    Then that copy of steps/ is refused, because "steps: is not a directory"

  Scenario: the folder steps/ absent from the disk, and git listing nothing under it, is not a defect
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the folder steps/ of the copy is removed from the disk only
    Then every entry of it follows the rule of the folders of steps

  Scenario: a tracked file of a step folder removed from the disk and not from the index is refused: it is missing
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the copy is added and committed
    And the path "demo/brief.md" of the copy is removed from the disk only
    Then that copy of steps/ is refused, because "demo: brief.md is missing"

  Scenario: a tracked file that is none of the expected files, removed from the disk only, is refused: it is not a regular file
    Given a copy of steps/ in a repository, holding the valid step folder "demo"
    When the copy holds the file "demo/notes.md"
    And the copy is added and committed
    And the path "demo/notes.md" of the copy is removed from the disk only
    Then that copy of steps/ is refused, because "demo: notes.md is not a regular file"

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

  Scenario: a reviewed step folder whose build declared a claim follows the rule
    Given a copy of steps/ holding the reviewed step folder "demo", whose build declared a claim
    Then every entry of it follows the rule of the folders of steps

  Scenario Outline: a reviewed record edited by hand is refused: <defect>
    Given a copy of steps/ holding the reviewed step folder "demo", whose build declared a claim
    When the copy is broken with <defect>
    Then that copy of steps/ is refused, because "<reason>"

    Examples:
      | defect                                                    | reason                                                                       |
      | a claim status removed from the review                    | demo: record.json is refused                                                 |
      | a claim refuted in a record that passed                   | demo: record.json is refused                                                 |
      | a criterion unmet in a record that passed                 | demo: record.json is refused                                                 |
      | the review removed from a record that passed with a claim | demo: record.json is refused                                                 |
      | the criteria removed from the review                      | demo: the review quality does not give a status for each criterion of step.json |
      | another criterion in the review                           | demo: the review quality does not give a status for each criterion of step.json |
