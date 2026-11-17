Feature: Reading a source (the Sources port and its real adapter, over a fetch the scenario gives)
  The adapter reads HTTPS on a closed list of hosts, follows a redirect by hand, and gives up on a time or a size limit.
  No scenario touches the network: the fetch is a function of the scenario.

  Rule: both adapters honour the port

    Scenario Outline: a source that answers is read
      Given the watch source "https://code.claude.com/docs/llms.txt" answers "# Docs\n"
      And the watch sources are the <adapter> adapter
      When I read "https://code.claude.com/docs/llms.txt" through the watch sources
      Then the watch reading is the text "# Docs\n"

      Examples:
        | adapter   |
        | in-memory |
        | fetch     |

    Scenario Outline: a source that cannot be read says why, from a closed list
      Given the watch source "https://code.claude.com/docs/llms.txt" answers "# Docs\n"
      And the watch sources are the <adapter> adapter
      When I read "<address>" through the watch sources
      Then the watch reading is unreadable because "<reason>"

      Examples:
        | adapter   | address                                  | reason              |
        | in-memory | https://code.claude.com/docs/absent.md   | statut 404          |
        | fetch     | https://code.claude.com/docs/absent.md   | statut 404          |
        | in-memory | https://example.org/llms.txt             | hôte hors liste     |
        | fetch     | https://example.org/llms.txt             | hôte hors liste     |
        | in-memory | http://code.claude.com/docs/llms.txt     | protocole refusé    |
        | fetch     | http://code.claude.com/docs/llms.txt     | protocole refusé    |
        | in-memory | https://user@code.claude.com/llms.txt    | hôte hors liste     |
        | fetch     | https://user@code.claude.com/llms.txt    | hôte hors liste     |
        | in-memory | https://:secret@code.claude.com/x        | hôte hors liste     |
        | fetch     | https://:secret@code.claude.com/x        | hôte hors liste     |
        | in-memory | https://u:secret@code.claude.com/x       | hôte hors liste     |
        | in-memory | https://code.claude.com:8443/llms.txt    | hôte hors liste     |
        | fetch     | https://code.claude.com:8443/llms.txt    | hôte hors liste     |
        | in-memory | not an address                           | hôte hors liste     |
        | fetch     | not an address                           | hôte hors liste     |

  Rule: the real adapter asks little and refuses what is outside the list

    Scenario Outline: the closed list holds these four hosts and no other
      Given the watch source "<address>" answers "found"
      When I read "<address>" through the watch sources
      Then the watch reading is <reading>

      Examples:
        | address                                           | reading                                   |
        | https://raw.githubusercontent.com/x/y/main/a.md   | the text "found"                          |
        | https://registry.npmjs.org/zod/latest             | the text "found"                          |
        | https://code.claude.com/docs/en/a.md             | the text "found"                          |
        | https://platform.claude.com/docs/en/a.md         | the text "found"                          |
        | https://github.com/x/y/a.md                      | unreadable because "hôte hors liste"      |
        | https://npmjs.org/zod/latest                     | unreadable because "hôte hors liste"      |
        | https://claude.com/docs/en/a.md                  | unreadable because "hôte hors liste"      |
        | https://api.anthropic.com/v1/a.md                | unreadable because "hôte hors liste"      |
        | https://www.code.claude.com/docs/en/a.md         | unreadable because "hôte hors liste"      |
        | https://example.org/docs/en/a.md                 | unreadable because "hôte hors liste"      |

    Scenario: a request carries the header accept and nothing else
      Given the watch source "https://registry.npmjs.org/@x/sdk/latest" answers "{}"
      When I read "https://registry.npmjs.org/@x/sdk/latest" through the watch sources
      Then every watch request carried only the header accept, with its value, and did not follow redirects

    Scenario: a host outside the list is not asked
      When I read "https://example.org/llms.txt" through the watch sources
      Then the watch reading is unreadable because "hôte hors liste"
      And the watch sources made 0 requests

    Scenario: http is not asked
      When I read "http://code.claude.com/docs/llms.txt" through the watch sources
      Then the watch reading is unreadable because "protocole refusé"
      And the watch sources made 0 requests

  Rule: a redirect is followed only inside the list, three times at most

    Scenario: a redirect to another page of the list is followed
      Given the watch source "https://code.claude.com/old.md" redirects to "/docs/new.md"
      And the watch source "https://code.claude.com/docs/new.md" answers "new"
      When I read "https://code.claude.com/old.md" through the watch sources
      Then the watch reading is the text "new"
      And the watch sources made 2 requests
      And the watch request 2 was for "https://code.claude.com/docs/new.md"
      And every watch request carried only the header accept, with its value, and did not follow redirects

    Scenario: a redirect to a host outside the list is refused and not asked
      Given the watch source "https://code.claude.com/old.md" redirects to "https://example.org/new.md"
      When I read "https://code.claude.com/old.md" through the watch sources
      Then the watch reading is unreadable because "redirection refusée"
      And the watch sources made 1 requests

    Scenario: a redirect to http is refused
      Given the watch source "https://code.claude.com/old.md" redirects to "http://code.claude.com/new.md"
      When I read "https://code.claude.com/old.md" through the watch sources
      Then the watch reading is unreadable because "redirection refusée"
      And the watch sources made 1 requests

    Scenario: three redirects are followed
      Given the watch source "https://code.claude.com/a" redirects to "https://code.claude.com/b"
      And the watch source "https://code.claude.com/b" redirects to "https://code.claude.com/c"
      And the watch source "https://code.claude.com/c" redirects to "https://code.claude.com/d"
      And the watch source "https://code.claude.com/d" answers "end"
      When I read "https://code.claude.com/a" through the watch sources
      Then the watch reading is the text "end"
      And the watch sources made 4 requests

    Scenario: more than three redirects are refused
      Given the watch source "https://code.claude.com/a" redirects to "https://code.claude.com/b"
      And the watch source "https://code.claude.com/b" redirects to "https://code.claude.com/c"
      And the watch source "https://code.claude.com/c" redirects to "https://code.claude.com/d"
      And the watch source "https://code.claude.com/d" redirects to "https://code.claude.com/e"
      And the watch source "https://code.claude.com/e" answers "end"
      When I read "https://code.claude.com/a" through the watch sources
      Then the watch reading is unreadable because "redirection refusée"
      And the watch sources made 4 requests

    Scenario: a redirect whose target cannot be parsed is refused, and not asked again
      Given the watch source "https://code.claude.com/a" redirects to "http://["
      When I read "https://code.claude.com/a" through the watch sources
      Then the watch reading is unreadable because "redirection refusée"
      And the watch sources made 1 requests

    Scenario: a redirect and a 404 that have no body are still followed and read
      Given the watch source "https://code.claude.com/a" redirects to "/b"
      And the watch source "https://code.claude.com/a" has no body
      And the watch source "https://code.claude.com/b" answers with the status 404
      And the watch source "https://code.claude.com/b" has no body
      When I read "https://code.claude.com/a" through the watch sources
      Then the watch reading is unreadable because "statut 404"
      And the watch sources made 2 requests

    Scenario: a redirect without a target is refused
      Given the watch source "https://code.claude.com/a" answers with the status 302
      When I read "https://code.claude.com/a" through the watch sources
      Then the watch reading is unreadable because "redirection refusée"

  Rule: a source that fails, is slow or is large is unreadable, with a fixed reason

    Scenario: an answer 200 without a body reads as an empty text
      Given the watch source "https://code.claude.com/docs/empty.md" answers with the status 200
      And the watch source "https://code.claude.com/docs/empty.md" has no body
      When I read "https://code.claude.com/docs/empty.md" through the watch sources
      Then the watch reading is the text ""

    Scenario: a status other than 200
      Given the watch source "https://code.claude.com/docs/gone.md" answers with the status 404
      When I read "https://code.claude.com/docs/gone.md" through the watch sources
      Then the watch reading is unreadable because "statut 404"

    Scenario: a status other than 200 is not a reading, 206 included
      Given the watch source "https://code.claude.com/docs/partial.md" answers with the status 206
      When I read "https://code.claude.com/docs/partial.md" through the watch sources
      Then the watch reading is unreadable because "statut 206"

    Scenario: a source that never answers ends on the time limit
      Given the watch fetch adapter is limited to 20 milliseconds and 1024 bytes
      And the watch source "https://code.claude.com/slow.md" never answers
      When I read "https://code.claude.com/slow.md" through the watch sources
      Then the watch reading is unreadable because "délai dépassé"

    Scenario: a body over the size limit
      Given the watch fetch adapter is limited to 5000 milliseconds and 100 bytes
      And the watch source "https://code.claude.com/big.md" answers with 101 bytes
      When I read "https://code.claude.com/big.md" through the watch sources
      Then the watch reading is unreadable because "trop volumineux"

    Scenario: a body of exactly the size limit is read
      Given the watch fetch adapter is limited to 5000 milliseconds and 100 bytes
      And the watch source "https://code.claude.com/big.md" answers with 100 bytes
      When I read "https://code.claude.com/big.md" through the watch sources
      Then the watch reading is the text "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

    Scenario: a fetch that throws, whatever its text
      Given the watch source "https://code.claude.com/x.md" fails with the error "::error::boom"
      When I read "https://code.claude.com/x.md" through the watch sources
      Then the watch reading is unreadable because "réseau"

    Scenario: a body that is not UTF-8 is refused
      Given the watch source "https://code.claude.com/x.md" answers with bytes that are not UTF-8
      When I read "https://code.claude.com/x.md" through the watch sources
      Then the watch reading is unreadable because "contenu refusé"

    Scenario: a body that starts with a byte order mark is read as it is
      Given the watch source "https://code.claude.com/x.md" answers "\ufeffa"
      When I read "https://code.claude.com/x.md" through the watch sources
      Then the watch reading is the text "\ufeffa"
