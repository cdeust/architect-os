Feature: A private journal resumes a Spec planning run across admissions

  Scenario: A second writer resumes only the latest saved state and exact artifact bytes
    Then a released planning journal can be resumed from disk

  Scenario Outline: Corrupt state cannot be reinterpreted as a valid journal
    Then a planning journal refuses state containing "<content>"

    Examples:
      | content             |
      | malformed UTF-8     |
      | a byte order mark   |
      | an invalid contract |

  Scenario Outline: The host refuses an unsafe journal directory before leasing it
    Then the planning journal rejects a "<location>" directory with "<error>"

    Examples:
      | location              | error                         |
      | symlinked parent      | SPEC_JOURNAL_DIRECTORY_UNSAFE |
      | checkout ancestor     | SPEC_JOURNAL_INSIDE_CHECKOUT  |
      | group writable parent | SPEC_JOURNAL_DIRECTORY_UNSAFE |
      | shared target         | SPEC_JOURNAL_DIRECTORY_UNSAFE |
      | symbolic link target  | SPEC_JOURNAL_DIRECTORY_UNSAFE |

  Scenario: A sticky shared ancestor admits a private journal
    Then the planning journal accepts a sticky parent and keeps the target private

  Scenario Outline: Artifacts belong to the private journal
    Then the planning journal refuses to read a "<kind>" artifact

    Examples:
      | kind              |
      | directory         |
      | group readable    |
      | world writable    |
      | different owner   |
      | name with a slash |

  Scenario Outline: Recovery distinguishes stale owners from inconclusive process probes
    Then the planning journal handles a lease owner probe returning "<code>"

    Examples:
      | code  |
      | ESRCH |
      | EPERM |
      | EIO   |

  Scenario Outline: A malformed lease cannot open a second generation
    Then the planning journal refuses a saved owner PID of "<pid>"

    Examples:
      | pid |
      | 0   |
      | 1.5 |

  Scenario: Generation overflow is refused before acquiring a lease
    Then the planning journal refuses to advance the last safe generation

  Scenario Outline: Failed publication of an exclusive lease cleans the staging file
    Then the planning journal handles a lease link failure of "<code>"

    Examples:
      | code   |
      | EEXIST |
      | EIO    |

  Scenario: A platform without a numeric owning account refuses before creating state
    Then the planning journal refuses a platform without getuid
