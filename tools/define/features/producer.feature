Feature: Pin and stage the producer the operator installed
  Scenario: A change to the plugin root after the check reaches nothing that runs
    Given a provisioned fixture producer with a command link among its dependencies
    When the host stages the pinned producer
    And the plugin root is changed after the check
    Then the staged copy holds exactly the pinned bytes, read-only, in a private directory
    And disposing of the staged copy removes it

  Scenario: The digest of the host is the operator's shasum listing, sorted by the bytes of the paths
    Given a provisioned fixture producer with a command link among its dependencies
    Then the host digest equals the listing computed from the pinned files

  Scenario: A plugin root that does not exist keeps its own error
    Then staging a plugin root that does not exist fails with "ENOENT", not a producer refusal

  Scenario Outline: The copy is never inside a directory the server may write, nor holds one: <case>
    Given a provisioned fixture producer with a command link among its dependencies
    When the host stages the pinned producer
    Then launching it with "<case>" writable is "<outcome>"

    Examples:
      | case                    | outcome                     |
      | a sibling directory     | allowed                     |
      | the copy itself         | SPEC_PRODUCER_COPY_WRITABLE |
      | the parent of the copy  | SPEC_PRODUCER_COPY_WRITABLE |
      | a directory in the copy | SPEC_PRODUCER_COPY_WRITABLE |

  Scenario: A stage with another digest copies nothing
    Given a provisioned fixture producer with a command link among its dependencies
    Then staging it with another digest is refused with "SPEC_PRODUCER_MISMATCH" and copies nothing

  Scenario Outline: The bounds of one launch: <case>
    Given a provisioned fixture producer with a command link among its dependencies
    Then reading it within "<case>" yields "<outcome>"

    Examples:
      | case                | outcome                 |
      | exactly the files   | accepted                |
      | one file too few    | SPEC_PRODUCER_TOO_LARGE |
      | exactly the bytes   | accepted                |
      | one byte too few    | SPEC_PRODUCER_TOO_LARGE |

  Scenario: The default bounds hold a provisioned producer of today with room to spare
    Then the default bounds are 20000 files and 256 MiB

  Scenario: The operator's command prints the digest to pin
    Given a provisioned fixture producer with a command link among its dependencies
    When the operator runs the producer digest command on it
    Then the command prints the listing digest and exits 0

  Scenario Outline: The operator's command refuses what the host would refuse: <case>
    Given a provisioned fixture producer with a command link among its dependencies
    When the operator runs the producer digest command with "<case>"
    Then the command prints nothing and refuses with "<message>"

    Examples:
      | case             | message                                       |
      | no root          | usage: producer:digest <prd-gen-plugin-root>  |
      | an extra operand | usage: producer:digest <prd-gen-plugin-root>  |
      | a linked bundle  | architect-os producer: SPEC_PRODUCER_LINK     |
