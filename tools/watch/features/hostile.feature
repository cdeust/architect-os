Feature: What a source says is never printed nor written (threat T of docs/design/anthropic-watch.md §5)
  A hostile source holds workflow commands, terminal escapes, headings and addresses made to be printed or written.
  Only a version that matched the version expression, an address that matched the address expression, a hash and a
  count come out.

  Rule: check prints nothing a source says

    Scenario: hostile changelog, page, index and pin
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch source "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md" answers "::error::x\n::add-mask::y\n\u001b[31mred\u001b[0m\n## 2.1.326 ::set-output name=a::b\n## 2.1.325\n"
      And the watch source "https://code.claude.com/docs/en/headless.md" answers "::error::x\n::add-mask::y\n\u001b]0;title\u0007\n"
      And the watch source "https://code.claude.com/docs/llms.txt" answers "::error::x\nhttps://code.claude.com/docs/en/a b.md\nhttps://code.claude.com/docs/en/q%0A::error::x.md\nhttps://code.claude.com/docs/en/q.md%0A::add-mask::y\nhttps://evil.example/docs/en/z.md\n\u001b[31m https://code.claude.com/docs/en/c.md\u001b[0m\n"
      And the watch source "https://registry.npmjs.org/@x/sdk/latest" answers with the version "::error::x\n::add-mask::y"
      When I run watch with the arguments "check --keep keep"
      Then the watch exit code is 3
      And the watch stdout is:
        """
        veille : 9 sources
        - sdk : illisible, contenu refusé
        - rt : à jour
        - cc-log : en retard, lu jusqu'à 2.1.325 le 2026-11-16, publié 2.1.326, 1 version au-dessus ; texte gardé
        - sdk-log : en retard, jamais lu ; texte gardé
        - headless : en retard, la page a changé depuis le 2026-11-16 ; à relire : a.ts, b.ts ; texte gardé
        - settings : à jour
        - docs : en retard, 1 page ajoutée, 2 retirées
            + https://code.claude.com/docs/en/c.md
            - https://code.claude.com/docs/en/a.md
            - https://code.claude.com/docs/en/b.md
        - plat : à jour
        - gone : illisible, statut 404
        """
      And the watch output and the files written in the repository hold none of:
        | ::error::           |
        | ::add-mask::        |
        | ::set-output        |
        | \u001b              |
        | \u0007              |
        | %0A                 |
        | a b.md              |
        | evil.example        |
        | name=a              |
        | title               |

    Scenario: a page whose address is hostile in its reason
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch source "https://code.claude.com/docs/en/headless.md" fails with the error "::error::boom \u001b[31m"
      And the watch source "https://code.claude.com/docs/en/settings.md" redirects to "https://example.org/::error::x"
      When I run watch with the arguments "check"
      Then the watch output holds "- headless : illisible, réseau\n"
      And the watch output holds "- settings : illisible, redirection refusée\n"
      And the watch output and the files written in the repository hold none of:
        | ::error::    |
        | boom         |
        | example.org  |
        | \u001b       |

  Rule: read writes nothing a source says

    Scenario: hostile changelog, page and index read
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch source "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md" answers "::error::x\n\u001b[31mred\u001b[0m\n## 9.9.9 ::set-output name=a::b\n## 2.1.325\n"
      And the watch source "https://code.claude.com/docs/en/headless.md" answers "::add-mask::y\n\u001b[31m"
      And the watch source "https://code.claude.com/docs/llms.txt" answers "::error::x\nhttps://code.claude.com/docs/en/a b.md\nhttps://code.claude.com/docs/en/q%0A::error::x.md\nhttps://evil.example/docs/en/z.md\nhttps://code.claude.com/docs/en/c.md\n"
      When I run watch with the arguments "read cc-log headless docs"
      Then the watch exit code is 0
      And the watch stdout is:
        """
        lu : cc-log
        lu : headless
        lu : docs
        """
      And the watch file "tools/watch/indexes/docs.txt" of the repository on disk reads "https://code.claude.com/docs/en/c.md\n"
      And the watch source "cc-log" of the register on disk is read on "2026-11-18" as:
        """
        {"version":"9.9.9"}
        """
      And the watch output and the files written in the repository hold none of:
        | ::error::    |
        | ::add-mask:: |
        | ::set-output |
        | \u001b       |
        | %0A          |
        | a b.md       |
        | evil.example |
        | name=a       |

    Scenario: a hostile index that holds no valid address writes nothing
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch source "https://code.claude.com/docs/llms.txt" answers "::error::x\nhttps://evil.example/docs/en/z.md\nhttps://code.claude.com/docs/en/a b.md\n"
      When I run watch with the arguments "read docs"
      Then the watch exit code is 3
      And the watch stdout is:
        """
        - docs : illisible, contenu refusé
        """
      And the watch repository on disk is unchanged
