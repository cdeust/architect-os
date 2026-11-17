Feature: What check says of each kind of source (pure functions of the register and of what the text of the source says)

  Rule: a pin

    Scenario Outline: a pin is compared with the published version
      Given a watch pin of "@x/sdk" whose manifests pin "<pinned>"
      When the watch source is compared with the published version "<published>"
      Then the watch verdict is the line "<line>"
      And the watch verdict exits with <code>

      Examples:
        | pinned                | published | line                                                                                                | code |
        | 0.3.325               | 0.3.325   | - p : à jour                                                                                        | 0    |
        | 0.3.325, 0.3.325      | 0.3.325   | - p : à jour                                                                                        | 0    |
        | 10.20.30              | 10.20.30  | - p : à jour                                                                                        | 0    |
        | 0.3.325               | 0.3.326   | - p : en retard, épinglé 0.3.325, publié 0.3.326                                                    | 1    |
        | 0.3.326               | 0.3.325   | - p : en retard, épinglé 0.3.326, publié 0.3.325                                                    | 1    |
        | 0.3.325, 0.3.324      | 0.3.325   | - p : en retard, les manifestes n'épinglent pas la même version : m0/package.json 0.3.325, m1/package.json 0.3.324, publié 0.3.325 | 1    |

    Scenario Outline: a published version that is not a version is refused
      Given a watch pin of "@x/sdk" whose manifests pin "0.3.325"
      When the watch source is compared with the raw text '<text>'
      Then the watch verdict is the line "- p : illisible, contenu refusé"
      And the watch verdict exits with 3

      Examples:
        | text                                  |
        | not json                              |
        | {"version":"::error::x"}              |
        | {"version":"1.2"}                     |
        | {"version":"1.2.3\n::error::x"}       |
        | {"version":7}                         |
        | []                                    |
        | null                                  |
        | {}                                    |
        | 42                                    |
        | "x"                                   |
        | {"version":["1.2.3"]}                 |
        | {"version":"1.2.3-beta"}              |
        | {"version":"v1.2.3"}                  |
        | {"version":null}                      |

  Rule: a changelog

    Scenario: a changelog whose latest version is the one read
      Given a watch changelog read "2.1.325 on 2026-11-16"
      When the watch source is compared with the text "# Changelog\n\n## 2.1.325\n\n- a\n\n## 2.1.324\n"
      Then the watch verdict is the line "- c : à jour"
      And the watch verdict does not let the text be kept

    Scenario Outline: a changelog with versions above the one read
      Given a watch changelog read "2.1.325 on 2026-11-16"
      When the watch source is compared with the text "<text>"
      Then the watch verdict is the line "- c : en retard, <summary>"
      And the watch verdict lets the text be kept

      Examples:
        | text                                                  | summary                                                                |
        | ## 2.1.327\n## 2.1.326\n## 2.1.325\n## 2.1.324\n       | lu jusqu'à 2.1.325 le 2026-11-16, publié 2.1.327, 2 versions au-dessus |
        | ## 2.1.326\n## 2.1.325\n## 2.1.324\n                   | lu jusqu'à 2.1.325 le 2026-11-16, publié 2.1.326, 1 version au-dessus  |

    Scenario: the versions of a changelog have several digits in each place
      Given a watch changelog read "12.34.55 on 2026-11-16"
      When the watch source is compared with the text "## 12.34.56\n## 12.34.55\n"
      Then the watch verdict is the line "- c : en retard, lu jusqu'à 12.34.55 le 2026-11-16, publié 12.34.56, 1 version au-dessus"

    Scenario: a changelog whose version read is no longer in the file
      Given a watch changelog read "2.1.300 on 2026-11-16"
      When the watch source is compared with the text "## 2.1.326\n## 2.1.325\n"
      Then the watch verdict is the line "- c : en retard, lu jusqu'à 2.1.300 le 2026-11-16, publié 2.1.326, la version lue n'est plus dans le fichier"

    Scenario: a changelog never read
      Given a watch changelog read "never"
      When the watch source is compared with the text "## 2.1.326\n"
      Then the watch verdict is the line "- c : en retard, jamais lu"
      And the watch verdict lets the text be kept

    Scenario: the versions are the headings of the text, in file order
      Given a watch changelog read "2.1.325 on 2026-11-16"
      When the watch source is compared with the text "### 9.9.9\n- ## 9.9.9\n 3.0.0\n## v7.7.7\n## 2.1.326.1\n## 2.1.325 ::set-output name=a::b\n"
      Then the watch verdict is the line "- c : en retard, lu jusqu'à 2.1.325 le 2026-11-16, publié 2.1.326, 1 version au-dessus"

    Scenario: a changelog without a version heading is unreadable
      Given a watch changelog read "2.1.325 on 2026-11-16"
      When the watch source is compared with the text "# Changelog\n## Unreleased\n"
      Then the watch verdict is the line "- c : illisible, contenu refusé"
      And the watch verdict exits with 3

  Rule: a page

    Scenario: a page whose hash is the one read
      Given a watch page of the mechanisms "a.ts, b.ts" read "hello on 2026-11-16"
      When the watch source is compared with the text "hello"
      Then the watch verdict is the line "- g : à jour"

    Scenario: a page that changed names the mechanisms to read again
      Given a watch page of the mechanisms "a.ts, b.ts" read "hello on 2026-11-16"
      When the watch source is compared with the text "hello!"
      Then the watch verdict is the line "- g : en retard, la page a changé depuis le 2026-11-16 ; à relire : a.ts, b.ts"
      And the watch verdict lets the text be kept

    Scenario: a page never read
      Given a watch page of the mechanisms "a.ts" read "never"
      When the watch source is compared with the text "hello"
      Then the watch verdict is the line "- g : en retard, jamais lu"
      And the watch verdict lets the text be kept
      And the watch verdict exits with 1

    Scenario: the hash is of the bytes of the text, not of a normalised copy
      Given a watch page of the mechanisms "a.ts" read "hello on 2026-11-16"
      When the watch source is compared with the text "hello\n"
      Then the watch verdict is the line "- g : en retard, la page a changé depuis le 2026-11-16 ; à relire : a.ts"

  Rule: an index

    Scenario: an index whose addresses are the committed ones
      Given a watch index committing "https://code.claude.com/docs/en/a.md, https://code.claude.com/docs/en/b.md"
      When the watch source is compared with the text "- [B](https://code.claude.com/docs/en/b.md)\n- [A](https://code.claude.com/docs/en/a.md)\n- [A again](https://code.claude.com/docs/en/a.md)\n"
      Then the watch verdict is the line "- i : à jour"
      And the watch verdict does not let the text be kept

    Scenario: an index with pages added and removed
      Given a watch index committing "https://code.claude.com/docs/en/a.md, https://code.claude.com/docs/en/b.md"
      When the watch source is compared with the text "https://code.claude.com/docs/en/z.md https://code.claude.com/docs/en/b.md https://code.claude.com/docs/en/c.md"
      Then the watch verdict is:
        """
        - i : en retard, 2 pages ajoutées, 1 retirée
            + https://code.claude.com/docs/en/c.md
            + https://code.claude.com/docs/en/z.md
            - https://code.claude.com/docs/en/a.md
        """

    Scenario: an index with one page added and none removed
      Given a watch index committing "https://code.claude.com/docs/en/a.md"
      When the watch source is compared with the text "https://code.claude.com/docs/en/a.md https://code.claude.com/docs/en/b.md"
      Then the watch verdict is:
        """
        - i : en retard, 1 page ajoutée, 0 retirée
            + https://code.claude.com/docs/en/b.md
        """

    Scenario: an index from which pages were only removed is behind
      Given a watch index committing "https://code.claude.com/docs/en/a.md, https://code.claude.com/docs/en/b.md"
      When the watch source is compared with the text "https://code.claude.com/docs/en/b.md"
      Then the watch verdict is:
        """
        - i : en retard, 0 page ajoutée, 1 retirée
            - https://code.claude.com/docs/en/a.md
        """

    Scenario: an index never read, which has no list of addresses, does not let the text be kept
      Given a watch index never read
      When the watch source is compared with the text "https://code.claude.com/docs/en/a.md"
      Then the watch verdict is the line "- i : en retard, jamais lu"
      And the watch verdict does not let the text be kept
      And the watch verdict exits with 1

    Scenario: an index whose list is empty has been read: every address is a page added
      Given a watch index committing ""
      When the watch source is compared with the text "https://code.claude.com/docs/en/a.md"
      Then the watch verdict is:
        """
        - i : en retard, 1 page ajoutée, 0 retirée
            + https://code.claude.com/docs/en/a.md
        """

    Scenario Outline: only the addresses of the host of the index, that end in .md, and are strict, count
      Given a watch index committing "https://code.claude.com/docs/en/a.md"
      When the watch source is compared with the text "https://code.claude.com/docs/en/a.md <noise>"
      Then the watch verdict is the line "- i : à jour"

      Examples:
        | noise                                           |
        | https://platform.claude.com/docs/en/z.md        |
        | https://evil.example/code.claude.com/z.md       |
        | https://code.claude.com.evil.example/z.md       |
        | http://code.claude.com/docs/en/z.md             |
        | https://code.claude.com/docs/en/z.html          |
        | https://code.claude.com/docs/en/z.mdx           |
        | https://code.claude.com/docs/en/z%0A.md         |
        | https://code.claude.com/docs/en/z.md%0A         |
        | https://code.claude.com/docs/en/a%20b.md        |
        | xhttps://code.claude.com/docs/en/z.md           |
        | https://code.claudexcom/docs/en/z.md            |
        | https://code.claude.com/                        |

    Scenario: an address with a space stops at the space
      Given a watch index committing "https://code.claude.com/docs/en/a.md"
      When the watch source is compared with the text "https://code.claude.com/docs/en/a b.md https://code.claude.com/docs/en/a.md"
      Then the watch verdict is the line "- i : à jour"

    Scenario: an index without any address is unreadable
      Given a watch index committing "https://code.claude.com/docs/en/a.md"
      When the watch source is compared with the text "# Docs\nnothing here\nhttps://evil.example/x.md\n"
      Then the watch verdict is the line "- i : illisible, contenu refusé"
      And the watch verdict exits with 3
