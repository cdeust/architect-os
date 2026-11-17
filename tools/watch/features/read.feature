Feature: npm run watch -- read (records in the register that sources were read)

  Rule: a page, a changelog or an index read is recorded, and nothing else in the register moves

    Scenario: a page read gets its hash and today's date, UTC
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "read headless"
      Then the watch exit code is 0
      And the watch stdout is:
        """
        lu : headless
        """
      And the watch repository on disk changed only "tools/watch/watch.json"
      And the watch register on disk differs from before only in the read of the sources "headless"
      And the watch source "headless" of the register on disk is read on "2026-11-18" as:
        """
        {"sha256":"ce06092fb948d9ffac7d1a376e404b26b7575bcc11ee05a4615fef4fec3a308b"}
        """

    Scenario: a changelog read gets its latest version
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "read sdk-log cc-log"
      Then the watch exit code is 0
      And the watch stdout is:
        """
        lu : sdk-log
        lu : cc-log
        """
      And the watch repository on disk changed only "tools/watch/watch.json"
      And the watch register on disk differs from before only in the read of the sources "sdk-log, cc-log"
      And the watch source "sdk-log" of the register on disk is read on "2026-11-18" as:
        """
        {"version":"0.3.4"}
        """
      And the watch source "cc-log" of the register on disk is read on "2026-11-18" as:
        """
        {"version":"2.1.326"}
        """

    Scenario: an index read gets its list of addresses rewritten, sorted, one per line
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch source "https://code.claude.com/docs/llms.txt" answers "https://code.claude.com/docs/en/z.md\nhttps://code.claude.com/docs/en/c.md\nhttps://code.claude.com/docs/en/z.md\n"
      When I run watch with the arguments "read docs"
      Then the watch exit code is 0
      And the watch repository on disk changed only "tools/watch/indexes/docs.txt"
      And the watch file "tools/watch/indexes/docs.txt" of the repository on disk reads "https://code.claude.com/docs/en/c.md\nhttps://code.claude.com/docs/en/z.md\n"
      And the watch register on disk is byte for byte what it was

    Scenario: an index never read gets its list, and the register keeps no date for it
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "docs", "kind": "index", "url": "https://code.claude.com/docs/llms.txt", "pages": "idx/docs.txt" }
        ] }
        """
      And the watch source "https://code.claude.com/docs/llms.txt" answers "https://code.claude.com/docs/en/a.md\n"
      When I run watch with the arguments "check"
      Then the watch exit code is 1
      And the watch stdout is:
        """
        veille : 1 sources
        - docs : en retard, jamais lu
        """
      When I run watch with the arguments "read docs"
      Then the watch file "idx/docs.txt" of the repository on disk reads "https://code.claude.com/docs/en/a.md\n"
      When I run watch with the arguments "check"
      Then the watch exit code is 0
      And the watch stdout is:
        """
        veille : 1 sources
        - docs : à jour
        """

    Scenario: a source read is up to date for the check that follows
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "read headless docs sdk-log"
      And I run watch with the arguments "check"
      Then the watch output holds "- headless : à jour\n"
      And the watch output holds "- docs : à jour\n"
      And the watch output holds "- sdk-log : à jour\n"
      And the watch output holds "- cc-log : en retard"

    Scenario: a source named twice is read once
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "read headless headless"
      Then the watch exit code is 0
      And the watch stdout is:
        """
        lu : headless
        """

  Rule: a read that is refused writes nothing and asks nothing

    Scenario Outline: a command that names no source that can be read
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "<arguments>"
      Then the watch exit code is 2
      And the watch stdout is empty
      And the watch stderr is the line:
        """
        architect-os watch: <line>
        """
      And the watch command made no request
      And the watch repository on disk is unchanged

      Examples:
        | arguments          | line                                                  |
        | read               | aucune source nommée                                  |
        | read nothing       | source inconnue : nothing                             |
        | read headless sdk  | sdk : une épingle se déplace dans son manifeste       |
        | read rt            | rt : une épingle se déplace dans son manifeste        |
        | read --keep keep   | aucune source nommée                                  |

  Rule: a source that cannot be read stops the whole read: nothing is written

    Scenario Outline: one source among several is unreadable
      Given the standard watch repository on disk
      And the standard watch answers
      And <given>
      When I run watch with the arguments "read headless docs sdk-log --keep keep"
      Then the watch exit code is 3
      And the watch stdout is:
        """
        <line>
        """
      And the watch repository on disk is unchanged
      And the watch keep folder does not exist

      Examples:
        | given                                                                                            | line                                |
        | the watch source "https://code.claude.com/docs/en/headless.md" answers with the status 500       | - headless : illisible, statut 500  |
        | the watch source "https://code.claude.com/docs/llms.txt" answers "no address\n"                  | - docs : illisible, contenu refusé  |
        | the watch source "https://raw.githubusercontent.com/x/sdk/main/CHANGELOG.md" answers "no heading" | - sdk-log : illisible, contenu refusé |

  Rule: --keep leaves the text read, outside the repository

    Scenario: the text read is kept under the id of the source
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "read headless sdk-log --keep keep"
      Then the watch exit code is 0
      And the watch keep folder holds only "headless.txt, sdk-log.txt"
      And the watch keep file "headless.txt" reads "hello!"
      And the watch keep file "sdk-log.txt" reads "## 0.3.4\n## 0.3.3\n"
      And the watch repository on disk changed only "tools/watch/watch.json"

    Scenario: a folder inside the repository is refused
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "read headless --keep repo/tools"
      Then the watch exit code is 2
      And the watch repository on disk is unchanged
      And the watch command made no request
