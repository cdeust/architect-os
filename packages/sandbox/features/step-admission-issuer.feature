Feature: The production issuer writes a Step admission receipt only for what it verified
  The issuer (journal, §123) attests the approved Plan, the bytes of the Step folder, the clean tree of the linked
  worktree, the launcher bytes, both independent reviews and a specimen proof for every role. It writes one new private
  file in the host authority directory, never another, and Step revalidates it.

  Scenario: The issued receipt is private, new, and admitted by the Step authority reader and checker
    Given an approved Step folder for a clean linked worktree with measured specimens
    When the host issues the Step admission receipt
    Then the receipt is a private file named for its Step and approved digest in a private authority directory
    And the Step authority reads the issued receipt and admits the exact subject

  Scenario Outline: Folder bytes that Step reads the same way are admitted: <variant>
    Given an approved Step folder for a clean linked worktree with measured specimens
    And the approved folder is varied by "<variant>"
    When the host issues the Step admission receipt
    Then the Step authority reads the issued receipt and admits the exact subject

    Examples:
      | variant                                    |
      | a brief that begins with a byte order mark |
      | file digests listed in reverse order       |

  Scenario: The production host reads the launcher Step reads and writes where Step looks
    Then the production admission host reads the launcher of this package and the Step authority directory

  Scenario Outline: A receipt issued for one subject is refused for another: <change>
    Given an approved Step folder for a clean linked worktree with measured specimens
    When the host issues the Step admission receipt
    Then Step refuses the issued receipt for a subject with "<change>"

    Examples:
      | change            |
      | another brief     |
      | another tree      |
      | another launcher  |
      | another worktree  |
      | another question  |

  Scenario: The issuer never overwrites a receipt
    Given an approved Step folder for a clean linked worktree with measured specimens
    When the host issues the Step admission receipt
    And the host issues the Step admission receipt again
    Then the second issuance is refused with "ADMIT_RECEIPT_EXISTS" and the first receipt is unchanged

  Scenario: Short writes still produce the whole receipt
    Given an approved Step folder for a clean linked worktree with measured specimens
    And the authority file system accepts at most 7 bytes per write
    When the host issues the Step admission receipt
    Then the Step authority reads the issued receipt and admits the exact subject

  Scenario Outline: Every refusal is named and writes nothing: <change>
    Given an approved Step folder for a clean linked worktree with measured specimens
    And the issuance is changed by "<change>"
    When the host issues the Step admission receipt
    Then the issuer refuses with "<code>" and writes no receipt

    Examples:
      | change                                | code                       |
      | no specimens                          | ADMIT_SPECIMENS_REQUIRED   |
      | an empty specimen list                | ADMIT_SPECIMENS_REQUIRED   |
      | a missing build specimen              | ADMIT_SPECIMENS_REQUIRED   |
      | an extra specimen                     | ADMIT_SPECIMENS_REQUIRED   |
      | a specimen for another prompt         | ADMIT_SPECIMENS_REQUIRED   |
      | a specimen for another model          | ADMIT_SPECIMENS_REQUIRED   |
      | a specimen for another provider       | ADMIT_SPECIMENS_REQUIRED   |
      | a failed replay                       | ADMIT_SPECIMENS_REQUIRED   |
      | a review specimen without criteria    | ADMIT_SPECIMENS_REQUIRED   |
      | a folder of another name              | ADMIT_FOLDER_INVALID       |
      | a Step name Step refuses              | ADMIT_FOLDER_INVALID       |
      | a relative folder                     | ADMIT_FOLDER_INVALID       |
      | a changed brief                       | ADMIT_INPUTS_MISMATCH      |
      | a missing brief                       | ADMIT_STEP_REFUSED         |
      | a brief that is a directory           | ADMIT_STEP_REFUSED         |
      | a brief that is a named pipe          | ADMIT_STEP_REFUSED         |
      | a brief that is not UTF-8             | ADMIT_STEP_REFUSED         |
      | a missing step file                   | ADMIT_STEP_REFUSED         |
      | a step file refused by its schema     | ADMIT_STEP_REFUSED         |
      | a missing scout question              | ADMIT_STEP_REFUSED         |
      | an approved file the folder lacks     | ADMIT_INPUTS_MISMATCH      |
      | a folder file the manifest omits      | ADMIT_INPUTS_MISMATCH      |
      | a blank brief                         | ADMIT_STEP_REFUSED         |
      | a blank scout question                | ADMIT_STEP_REFUSED         |
      | a correctness review on the Anthropic builder | ADMIT_STEP_REFUSED |
      | a launcher inside the worktree        | ADMIT_LAUNCHER_INSIDE_WORKTREE |
      | the main checkout                     | ADMIT_WORKTREE_INVALID     |
      | a directory inside the worktree       | ADMIT_WORKTREE_INVALID     |
      | a relative worktree                   | ADMIT_WORKTREE_INVALID     |
      | a failing fingerprint                 | ADMIT_WORKTREE_INVALID     |
      | a dirty worktree                      | ADMIT_TREE_DIRTY           |
      | a missing launcher file               | ADMIT_LAUNCHER_UNREADABLE  |
      | a Plan digest other than the manifest | ADMIT_EVIDENCE_MISMATCH    |
      | an approval of another manifest       | ADMIT_EVIDENCE_MISMATCH    |
      | a Define review by one provider       | ADMIT_EVIDENCE_MISMATCH    |
      | a Plan review by one model            | ADMIT_EVIDENCE_MISMATCH    |
      | a Plan bound to another Define        | ADMIT_EVIDENCE_MISMATCH    |
      | a shared authority directory          | ADMIT_AUTHORITY_UNSAFE     |
      | an authority inside the worktree      | ADMIT_AUTHORITY_UNSAFE     |
      | a relative authority                  | ADMIT_AUTHORITY_UNSAFE     |
      | an authority that is a file           | ADMIT_AUTHORITY_UNSAFE     |
      | an authority that is a link           | ADMIT_AUTHORITY_UNSAFE     |
      | an authority under a linked parent    | ADMIT_AUTHORITY_UNSAFE     |
      | an authority of another owner         | ADMIT_AUTHORITY_UNSAFE     |
      | no user identity                      | ADMIT_AUTHORITY_UNSAFE     |
      | an authority closed to writing        | ADMIT_AUTHORITY_UNSAFE     |
      | a failed write                        | ADMIT_RECEIPT_WRITE_FAILED |
      | a failed write and a failed cleanup   | ADMIT_RECEIPT_WRITE_FAILED |
      | a failed link                         | ADMIT_RECEIPT_WRITE_FAILED |
      | a temporary name that outlives its link | ADMIT_RECEIPT_WRITE_FAILED |
