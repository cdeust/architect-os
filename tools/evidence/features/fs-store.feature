Feature: The file store

  Scenario: the ledger and the desk are created with their folders, each of mode 700
    Given a throwaway evidence root
    When the evidence file store is opened
    Then the evidence file store is open
    And the evidence folders created are all of mode 700

  Scenario: a store reopened over the folders it created works and keeps what was written
    Given a throwaway evidence root
    And the evidence file store is opened
    And the evidence file store saves the question "a"
    When the evidence file store is opened again
    Then the evidence file store is open
    And the evidence file store reads the question "a" of the ledger

  Scenario: an existing folder of mode 700 is reused as it is
    Given a throwaway evidence root
    And the evidence ledger folder is "a directory of mode 700 holding a file"
    When the evidence file store is opened
    Then the evidence file store is open
    And the evidence file "kept.txt" of the ledger still reads "kept"

  Scenario Outline: the <which> folder is refused when it is <kind>
    Given a throwaway evidence root
    And the evidence <which> folder is "<kind>"
    When the evidence file store is opened
    Then the evidence file store is refused with "<code>" on "<folder>" saying "<detail>"

    Examples:
      | which  | kind                    | code                        | folder               | detail                                                             |
      | ledger | a regular file          | FOLDER_NOT_A_REAL_DIRECTORY | ledger               | a real directory is required: an absolute path whose last component is not a link                          |
      | ledger | a link to a directory   | FOLDER_NOT_A_REAL_DIRECTORY | ledger               | a real directory is required: an absolute path whose last component is not a link                          |
      | ledger | a directory of mode 755 | FOLDER_MODE_NOT_0700        | ledger               | mode is 755                                                        |
      | ledger | under a missing parent  | FOLDER_NOT_CREATED          | missing/ledger       | ENOENT    |
      | ledger | under a regular file    | FOLDER_NOT_CREATED          | file/ledger          | ENOTDIR                                                            |
      | ledger | under a linked parent   | FOLDER_NOT_A_REAL_DIRECTORY | ledger-parent/ledger | a real directory is required: an absolute path whose last component is not a link                          |
      | desk   | a regular file          | FOLDER_NOT_A_REAL_DIRECTORY | desk                 | a real directory is required: an absolute path whose last component is not a link                          |
      | desk   | a link to a directory   | FOLDER_NOT_A_REAL_DIRECTORY | desk                 | a real directory is required: an absolute path whose last component is not a link                          |
      | desk   | a directory of mode 755 | FOLDER_MODE_NOT_0700        | desk                 | mode is 755                                                        |
      | desk   | under a missing parent  | FOLDER_NOT_CREATED          | missing/desk         | ENOENT      |
      | desk   | under a regular file    | FOLDER_NOT_CREATED          | file/desk            | ENOTDIR                                                            |
      | desk   | under a linked parent   | FOLDER_NOT_A_REAL_DIRECTORY | desk-parent/desk     | a real directory is required: an absolute path whose last component is not a link                          |

  Scenario Outline: the <inside> folder of the <which> is refused when it is <kind>, and the refusal names it
    Given a throwaway evidence root
    And in the evidence <which> folder, "<inside>" is "<kind>"
    When the evidence file store is opened
    Then the evidence file store is refused with "<code>" on "<folder>" saying "<detail>"

    Examples:
      | which  | inside   | kind                    | code                        | folder           | detail                                    |
      | ledger | asked    | a regular file          | FOLDER_NOT_A_REAL_DIRECTORY | ledger/asked     | a real directory is required: an absolute path whose last component is not a link |
      | ledger | verified | a regular file          | FOLDER_NOT_A_REAL_DIRECTORY | ledger/verified  | a real directory is required: an absolute path whose last component is not a link |
      | ledger | sources  | a directory of mode 755 | FOLDER_MODE_NOT_0700        | ledger/sources   | mode is 755                               |
      | desk   | out      | a regular file          | FOLDER_NOT_A_REAL_DIRECTORY | desk/out         | a real directory is required: an absolute path whose last component is not a link |
      | desk   | in       | a directory of mode 755 | FOLDER_MODE_NOT_0700        | desk/in          | mode is 755                               |

  Scenario: a folder that another user owns is refused
    Given a throwaway evidence root
    When the evidence file store is opened as another user
    Then the evidence file store is refused as not owned on the ledger folder

  Scenario: a platform without O_NOFOLLOW is refused before anything is created
    Given a throwaway evidence root
    When the evidence file store is opened on a platform without O_NOFOLLOW
    Then the evidence file store is refused with "NOFOLLOW_UNSUPPORTED" on "desk" saying "this platform has no O_NOFOLLOW: a link cannot be refused"
    And the evidence ledger folder does not exist

  Scenario: a platform without O_NONBLOCK is refused before anything is created
    Given a throwaway evidence root
    When the evidence file store is opened on a platform without O_NONBLOCK
    Then the evidence file store is refused with "NOFOLLOW_UNSUPPORTED" on "desk" saying "this platform has no O_NONBLOCK: a FIFO would block the read"
    And the evidence ledger folder does not exist

  Scenario: a source that is a symbolic link is not read, and the file it points to is untouched
    Given a throwaway evidence root
    And the evidence file store is opened
    And a file outside the desk reads "secret"
    And Science has made "in/link.txt" in the desk a link to the file outside the desk
    And Science has written "in/real.txt" in the desk as "public"
    Then the evidence file store source text "link.txt" is absent
    And the evidence file store source text "real.txt" has 6 characters

  Scenario: a source that is a hard link is not read
    Given a throwaway evidence root
    And the evidence file store is opened
    And a file outside the desk reads "secret"
    And Science has made "in/hard.txt" in the desk a hard link to the file outside the desk
    Then the evidence file store source text "hard.txt" is absent

  Scenario: a source of 5 MiB is read and one byte more is not
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written "in/exact.txt" in the desk as a text of 5 MiB and 0 bytes
    And Science has written "in/over.txt" in the desk as a text of 5 MiB and 1 bytes
    Then the evidence file store source text "exact.txt" has 5 MiB
    And the evidence file store source text "over.txt" is absent

  Scenario: a source that is a folder is not read
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has made "in/folder.txt" in the desk a folder
    Then the evidence file store source text "folder.txt" is absent

  Scenario: a source that is missing is not read
    Given a throwaway evidence root
    And the evidence file store is opened
    Then the evidence file store source text "missing.txt" is absent

  Scenario Outline: the source name "<name>" is outside the pattern
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written "secret.txt" in the desk as "x"
    And Science has written "in/x.json" in the desk as "x"
    And Science has written "in/a.txt.bak" in the desk as "x"
    And Science has written "in/d/a.txt" in the desk as "x"
    Then the evidence file store source text "<name>" is absent

    Examples:
      | name          |
      | ../secret.txt |
      | x.json        |
      | a.txt.bak     |
      | d/a.txt       |
      | in/x.json     |

  Scenario: a source name of 120 characters before .txt is read and one of 121 is not
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written a source whose name has 120 characters before ".txt"
    And Science has written a source whose name has 121 characters before ".txt"
    Then the evidence file store source text of a name of 120 characters is "named"
    And the evidence file store source text of a name of 121 characters is "absent"

  Scenario: a source name may hold underscores, dots and hyphens
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written "in/A_b.c-d.txt" in the desk as "named"
    Then the evidence file store source text "A_b.c-d.txt" has 5 characters

  Scenario: the writes land in the layout of the design note, each file of mode 600, with no temporary file left
    Given a throwaway evidence root
    And the evidence file store is opened
    When the evidence file store saves the question "a"
    And the evidence file store saves the rejection "a"
    And the evidence file store saves the rejection "b"
    And the evidence file store verifies "a" with the text "the text"
    And the evidence file store publishes "SKILL.md" with "the skill"
    Then the evidence root holds exactly these files:
      | desk/out/SKILL.md                                                                   |
      | desk/out/a.question.json                                                            |
      | desk/out/b.rejected.json                                                            |
      | ledger/asked/a.json                                                                 |
      | ledger/sources/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.txt |
      | ledger/verified/a.json                                                              |
    And every file of the evidence root is of mode 600
    And the evidence root file "desk/out/SKILL.md" reads "the skill"
    And the evidence root file "ledger/sources/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.txt" reads "the text"
    And the evidence root file "desk/out/a.question.json" is the JSON of the question "a"
    And the evidence root file "ledger/asked/a.json" is the JSON of the question "a"
    And the evidence root file "desk/out/b.rejected.json" is the JSON of the rejection "b"

  Scenario: a destination of out that is a symbolic link is replaced and its target is untouched
    Given a throwaway evidence root
    And the evidence file store is opened
    And a file outside the desk reads "outside"
    And Science has made "out/a.question.json" in the desk a link to the file outside the desk
    And Science has made "out/a.rejected.json" in the desk a link to the file outside the desk
    And Science has made "out/SKILL.md" in the desk a link to the file outside the desk
    When the evidence file store saves the question "a"
    And the evidence file store saves the rejection "a"
    And the evidence file store publishes "SKILL.md" with "the skill"
    Then the evidence root file "desk/out/a.question.json" is the JSON of the question "a"
    And the evidence root file "desk/out/a.rejected.json" is the JSON of the rejection "a"
    And the evidence root file "desk/out/SKILL.md" reads "the skill"
    And the file outside the desk still reads "outside"

  Scenario: removing the rejection removes a link and not its target
    Given a throwaway evidence root
    And the evidence file store is opened
    And a file outside the desk reads "outside"
    And Science has made "out/a.rejected.json" in the desk a link to the file outside the desk
    When the evidence file store verifies "a" with the text "the text"
    Then the evidence desk has no file "out/a.rejected.json"
    And the file outside the desk still reads "outside"

  Scenario: a rejection that is a folder makes the verification fail, after the record is written
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has made "out/a.rejected.json" in the desk a folder
    Then verifying "a" with the text "the text" in the evidence file store fails
    And the evidence root has the file "ledger/verified/a.json"
    And the evidence root has the file "ledger/sources/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.txt"

  Scenario: a record verified without any rejection is saved
    Given a throwaway evidence root
    And the evidence file store is opened
    When the evidence file store verifies "a" with the text "the text"
    Then the evidence root holds exactly these files:
      | ledger/sources/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.txt |
      | ledger/verified/a.json                                                              |

  Scenario: only the names of the answers are listed, and only those of the pattern
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written "in/ok.answer.json" in the desk as "x"
    And Science has written "in/b-2.answer.json" in the desk as "x"
    And Science has written "in/abcde.answer.json.bak" in the desk as "x"
    And Science has written "in/abcde.answer.txt" in the desk as "x"
    And Science has written "in/abcde.json" in the desk as "x"
    And Science has written "in/Not_An_Id.answer.json" in the desk as "x"
    And Science has written "in/-a.answer.json" in the desk as "x"
    And Science has written "in/.answer.json" in the desk as "x"
    And Science has written "in/note.txt" in the desk as "x"
    And Science has made "in/gone.answer.json" in the desk a link to a missing file
    Then the evidence file store answer identifiers are "b-2,gone,ok"
    And the evidence file store reads no answer "gone"

  Scenario: an answer that is a link, a hard link, a folder or too large reads as absent
    Given a throwaway evidence root
    And the evidence file store is opened
    And a file outside the desk reads "secret"
    And Science has made "in/link.answer.json" in the desk a link to the file outside the desk
    And Science has made "in/hard.answer.json" in the desk a hard link to the file outside the desk
    And Science has made "in/folder.answer.json" in the desk a folder
    And Science has written "in/big.answer.json" in the desk as a text of 1 MiB and 1 bytes
    And Science has written "in/exact.answer.json" in the desk as a text of 1 MiB and 0 bytes
    Then the evidence file store reads no answer "link"
    And the evidence file store reads no answer "hard"
    And the evidence file store reads no answer "folder"
    And the evidence file store reads no answer "big"
    And the evidence file store reads no answer "missing"
    And the evidence file store reads an answer "exact" of 1 MiB

  Scenario: an identifier that is not valid reads nothing, even where a file would be found
    Given a throwaway evidence root
    And the evidence file store is opened
    When the evidence file store saves the question "a"
    And the evidence file store verifies "a" with the text "the text"
    And Science has written "in/a.answer.json" in the desk as "x"
    And Science has written the rejection "a" as "out/a.rejected.json" in the desk
    Then the evidence file store reads no answer "../in/a"
    And the evidence file store reads no rejection "../out/a"
    And the evidence file store reads no question "../verified/a"
    And the evidence file store reads no verified record "../asked/a"

  Scenario: a rejection that does not parse against the contract reads as absent
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written "out/a.rejected.json" in the desk as "not json"
    And Science has written the rejection "b" with an unknown key
    Then the evidence file store reads no rejection "a"
    And the evidence file store reads no rejection "b"
    And the evidence file store reads no rejection "missing"

  Scenario: a rejection that is a link or too large reads as absent, one of 1 MiB is read
    Given a throwaway evidence root
    And the evidence file store is opened
    And a file outside the desk holds the rejection "a"
    And Science has made "out/a.rejected.json" in the desk a link to the file outside the desk
    And Science has written the rejection "b" padded to 1048577 bytes
    And Science has written the rejection "c" padded to 1048576 bytes
    Then the evidence file store reads no rejection "a"
    And the evidence file store reads no rejection "b"
    And the evidence file store reads the rejection "c"

  Scenario: the question comes from the ledger, never from the desk
    Given a throwaway evidence root
    And the evidence file store is opened
    When the evidence file store saves the question "a"
    And Science has replaced the desk question "a" by another text
    Then the evidence file store reads the question "a" of the ledger

  Scenario: reading and writing leave no descriptor open
    Given a throwaway evidence root
    And the evidence file store is opened
    And Science has written "in/paper.txt" in the desk as "The text."
    When the evidence file store reads the source "paper.txt" 40 times and publishes "note.txt" 40 times
    Then the evidence process holds as many open descriptors as before

