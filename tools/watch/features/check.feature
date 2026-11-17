Feature: npm run watch -- check (the real adapters over a throwaway repository, a fetch the scenario gives)

  Rule: one line per source, and an exit code that tells what the lines say

    Scenario: a register that holds a source of each state
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "check"
      Then the watch exit code is 3
      And the watch stdout is:
        """
        veille : 9 sources
        - sdk : en retard, épinglé 0.3.325, publié 0.3.326
        - rt : à jour
        - cc-log : en retard, lu jusqu'à 2.1.325 le 2026-11-16, publié 2.1.326, 1 version au-dessus
        - sdk-log : en retard, jamais lu
        - headless : en retard, la page a changé depuis le 2026-11-16 ; à relire : a.ts, b.ts
        - settings : à jour
        - docs : en retard, 1 page ajoutée, 1 retirée
            + https://code.claude.com/docs/en/c.md
            - https://code.claude.com/docs/en/b.md
        - plat : à jour
        - gone : illisible, statut 404
        """
      And the watch stderr is empty
      And the watch repository on disk is unchanged

    Scenario: a source that is behind and none unreadable exits with 1
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch source "https://platform.claude.com/docs/en/gone.md" answers "gone"
      When I run watch with the arguments "check"
      Then the watch exit code is 1
      And the watch output holds "- gone : à jour\n"
      And the watch repository on disk is unchanged

    Scenario: a register all of whose sources are up to date exits with 0
      Given a watch repository on disk holding the register:
        """
        {
          "sources": [
            { "id": "rt", "kind": "pin", "package": "@x/rt", "manifests": ["m/rt.json"] },
            {
              "id": "log",
              "kind": "changelog",
              "url": "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md",
              "read": { "version": "2.1.326", "on": "2026-11-16" }
            }
          ]
        }
        """
      And the watch repository on disk holds the file "m/rt.json":
        """
        {"dependencies":{"@x/rt":"1.0.0"}}
        """
      And the watch source "https://registry.npmjs.org/@x/rt/latest" answers with the version "1.0.0"
      And the watch source "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md" answers "## 2.1.326\n## 2.1.325\n"
      When I run watch with the arguments "check"
      Then the watch exit code is 0
      And the watch stdout is:
        """
        veille : 2 sources
        - rt : à jour
        - log : à jour
        """

    Scenario: a pin whose manifests disagree
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch repository on disk holds the file "m/b/package.json":
        """
        {"dependencies":{"@x/sdk":"0.3.324"}}
        """
      When I run watch with the arguments "check"
      Then the watch output holds "- sdk : en retard, les manifestes n'épinglent pas la même version : m/a/package.json 0.3.325, m/b/package.json 0.3.324, publié 0.3.326\n"

  Rule: a source that cannot be read says why, from a closed list, and the others are still read

    Scenario Outline: the ways a source is unreadable
      Given the standard watch repository on disk
      And the standard watch answers
      And <given>
      When I run watch with the arguments "check"
      Then the watch exit code is 3
      And the watch output holds "<line>\n"
      And the watch output holds "- rt : à jour\n"

      Examples:
        | given                                                                                                     | line                                   |
        | the watch source "https://registry.npmjs.org/@x/sdk/latest" answers with the status 503                   | - sdk : illisible, statut 503          |
        | the watch source "https://registry.npmjs.org/@x/sdk/latest" answers with the version "latest"         | - sdk : illisible, contenu refusé      |
        | the watch source "https://raw.githubusercontent.com/x/sdk/main/CHANGELOG.md" answers "# no version\n"    | - sdk-log : illisible, contenu refusé  |
        | the watch source "https://code.claude.com/docs/llms.txt" answers "nothing to see\n"                       | - docs : illisible, contenu refusé     |
        | the watch source "https://code.claude.com/docs/en/headless.md" redirects to "https://example.org/x.md"   | - headless : illisible, redirection refusée |
        | the watch source "https://code.claude.com/docs/en/headless.md" fails with the error "::error::boom"      | - headless : illisible, réseau         |
        | the watch source "https://code.claude.com/docs/en/headless.md" answers with bytes that are not UTF-8     | - headless : illisible, contenu refusé |

    Scenario: a source that never answers
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch fetch adapter is limited to 20 milliseconds and 1024 bytes
      And the watch source "https://code.claude.com/docs/en/headless.md" never answers
      When I run watch with the arguments "check"
      Then the watch exit code is 3
      And the watch output holds "- headless : illisible, délai dépassé\n"
      And the watch output holds "- rt : à jour\n"

    Scenario: a source over the size limit
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch fetch adapter is limited to 5000 milliseconds and 100 bytes
      And the watch source "https://code.claude.com/docs/en/headless.md" answers with 101 bytes
      When I run watch with the arguments "check"
      Then the watch exit code is 3
      And the watch output holds "- headless : illisible, trop volumineux\n"

  Rule: a register that cannot be used is refused before anything is read

    Scenario: an id that appears twice
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "a", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md" },
          { "id": "a", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md" }
        ] }
        """
      When I run watch with the arguments "check"
      Then the watch exit code is 2
      And the watch stdout is empty
      And the watch stderr is the line:
        """
        architect-os watch: identifiant en double : a
        """
      And the watch command made no request

    Scenario: a host outside the list
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "a", "kind": "changelog", "url": "https://example.org/CHANGELOG.md" }
        ] }
        """
      When I run watch with the arguments "check"
      Then the watch exit code is 2
      And the watch stderr is one line starting with "architect-os watch: tools/watch/watch.json hors schéma : $.sources.0.url"
      And the watch command made no request

    Scenario: a mechanism that is not in the repository
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch repository on disk holds the file "tools/watch/watch.json":
        """
        {"sources":[{"id":"p","kind":"page","url":"https://code.claude.com/docs/en/p.md","mechanisms":["nowhere.ts"],"relies":"x"}]}
        """
      When I run watch with the arguments "check"
      Then the watch exit code is 2
      And the watch stderr is the line:
        """
        architect-os watch: p : nowhere.ts est absent du dépôt
        """
      And the watch command made no request

    Scenario Outline: a command line that is not a command
      Given the standard watch repository on disk
      When I run watch with the arguments "<arguments>"
      Then the watch exit code is 2
      And the watch stdout is empty
      And the watch stderr is the line:
        """
        architect-os watch: usage: watch check [--keep <dossier>] | watch read <id> [<id>...] [--keep <dossier>]
        """
      And the watch command made no request

      Examples:
        | arguments                    |
        |                              |
        | frobnicate                   |
        | check sdk                    |
        | check --keep                 |
        | check --keep a --keep b      |
        | check --verbose              |
        | read sdk --keep              |
        | read --verbose sdk           |

  Rule: --keep leaves the text read, outside the repository

    Scenario: the new text of a page or a changelog that is behind is kept beside the check
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "check --keep keep"
      Then the watch exit code is 3
      And the watch stdout is:
        """
        veille : 9 sources
        - sdk : en retard, épinglé 0.3.325, publié 0.3.326
        - rt : à jour
        - cc-log : en retard, lu jusqu'à 2.1.325 le 2026-11-16, publié 2.1.326, 1 version au-dessus ; texte gardé
        - sdk-log : en retard, jamais lu ; texte gardé
        - headless : en retard, la page a changé depuis le 2026-11-16 ; à relire : a.ts, b.ts ; texte gardé
        - settings : à jour
        - docs : en retard, 1 page ajoutée, 1 retirée
            + https://code.claude.com/docs/en/c.md
            - https://code.claude.com/docs/en/b.md
        - plat : à jour
        - gone : illisible, statut 404
        """
      And the watch keep folder holds only "cc-log.new.txt, sdk-log.new.txt, headless.new.txt"
      And the watch keep file "headless.new.txt" reads "hello!"
      And the watch keep file "sdk-log.new.txt" reads "## 0.3.4\n## 0.3.3\n"
      And the watch repository on disk is unchanged

    Scenario: only the source that is behind is kept, not the one that is up to date
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "same", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/a/main/CHANGELOG.md", "read": { "version": "2.1.326", "on": "2026-11-16" } },
          { "id": "late", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/b/main/CHANGELOG.md", "read": { "version": "1.0.0", "on": "2026-11-16" } }
        ] }
        """
      And the watch source "https://raw.githubusercontent.com/x/a/main/CHANGELOG.md" answers "## 2.1.326\n"
      And the watch source "https://raw.githubusercontent.com/x/b/main/CHANGELOG.md" answers "## 1.0.1\n## 1.0.0\n"
      When I run watch with the arguments "check --keep keep"
      Then the watch exit code is 1
      And the watch stdout is:
        """
        veille : 2 sources
        - same : à jour
        - late : en retard, lu jusqu'à 1.0.0 le 2026-11-16, publié 1.0.1, 1 version au-dessus ; texte gardé
        """
      And the watch keep folder holds only "late.new.txt"

    Scenario: a page and a changelog never read let the text be kept, an index never read does not
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "log", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/a/main/CHANGELOG.md" },
          { "id": "pg", "kind": "page", "url": "https://code.claude.com/docs/en/p.md", "mechanisms": ["a.ts"], "relies": "x" },
          { "id": "ix", "kind": "index", "url": "https://code.claude.com/docs/llms.txt", "pages": "idx/ix.txt" }
        ] }
        """
      And the watch repository on disk holds the file "a.ts" with "x"
      And the watch source "https://raw.githubusercontent.com/x/a/main/CHANGELOG.md" answers "## 1.0.0\n"
      And the watch source "https://code.claude.com/docs/en/p.md" answers "page"
      And the watch source "https://code.claude.com/docs/llms.txt" answers "https://code.claude.com/docs/en/p.md\n"
      When I run watch with the arguments "check --keep keep"
      Then the watch exit code is 1
      And the watch stdout is:
        """
        veille : 3 sources
        - log : en retard, jamais lu ; texte gardé
        - pg : en retard, jamais lu ; texte gardé
        - ix : en retard, jamais lu
        """
      And the watch keep folder holds only "log.new.txt, pg.new.txt"

    Scenario: an index never read, which has no list of addresses in the repository, is behind
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "ix", "kind": "index", "url": "https://code.claude.com/docs/llms.txt", "pages": "idx/ix.txt" }
        ] }
        """
      And the watch source "https://code.claude.com/docs/llms.txt" answers "https://code.claude.com/docs/en/p.md\n"
      When I run watch with the arguments "check"
      Then the watch exit code is 1
      And the watch stdout is:
        """
        veille : 1 sources
        - ix : en retard, jamais lu
        """
      And the watch repository on disk is unchanged

    Scenario: the parent folder of the repository is outside it, and is accepted
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "log", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/a/main/CHANGELOG.md" }
        ] }
        """
      And the watch source "https://raw.githubusercontent.com/x/a/main/CHANGELOG.md" answers "## 1.0.0\n"
      When I run watch with the arguments "check --keep ."
      Then the watch exit code is 1
      And the watch command folder holds the file "log.new.txt"
      And the watch repository on disk is unchanged

    Scenario: nothing is kept when nothing is behind
      Given a watch repository on disk holding the register:
        """
        { "sources": [
          { "id": "log", "kind": "changelog", "url": "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md", "read": { "version": "2.1.326", "on": "2026-11-16" } }
        ] }
        """
      And the watch source "https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md" answers "## 2.1.326\n"
      When I run watch with the arguments "check --keep keep"
      Then the watch exit code is 0
      And the watch keep folder does not exist

    Scenario Outline: a folder inside the repository is refused, before anything is read
      Given the standard watch repository on disk
      And the standard watch answers
      When I run watch with the arguments "<arguments>"
      Then the watch exit code is 2
      And the watch stdout is empty
      And the watch stderr is one line starting with "architect-os watch: --keep "
      And the watch command made no request
      And the watch repository on disk is unchanged

      Examples:
        | arguments                      |
        | check --keep repo/out          |
        | check --keep repo/             |
        | check --keep repo              |
        | check --keep repo/../repo/out  |
        | check --keep repo/..out        |
        | check --keep repo/...          |
        | check --keep repo/..out/deeper |
        | read headless --keep repo/out  |

    Scenario: a folder that cannot be written is an unexpected error, said in one fixed line
      Given the standard watch repository on disk
      And the standard watch answers
      And the watch command folder holds a file "keep"
      When I run watch with the arguments "check --keep keep"
      Then the watch exit code is 3
      And the watch stdout is empty
      And the watch stderr is the line:
        """
        architect-os watch: erreur inattendue
        """
