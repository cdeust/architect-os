Feature: The registry of DOIs

  Scenario Outline: the Registry contract holds for <adapter>
    Given the evidence registry adapter "<adapter>"
    When the evidence registry looks up "<doi>"
    Then the evidence lookup is "<kind>" titled "<title>" of year "<year>", retracted "<retracted>"

    Examples:
      | adapter   | doi                            | kind        | title                                                                                                                  | year | retracted |
      | doi-org   | 10.1145/3597503.3639187        | found       | Using an LLM to Help With Code Understanding                                                                           | 2024 | false     |
      | doi-org   | 10.1016/S0140-6736(97)11096-0  | found       | RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children | 1998 | true      |
      | doi-org   | 10.48550/arXiv.1706.03762      | found       | Attention Is All You Need                                                                                              | 2017 | false     |
      | doi-org   | 10.1234/does-not-exist-xyz     | unknown     |                                                                                                                        | none | false     |
      | doi-org   | 10.1234/down                   | unavailable |                                                                                                                        | none | false     |
      | in-memory | 10.1145/3597503.3639187        | found       | Using an LLM to Help With Code Understanding                                                                           | 2024 | false     |
      | in-memory | 10.1016/S0140-6736(97)11096-0  | found       | RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children | 1998 | true      |
      | in-memory | 10.48550/arXiv.1706.03762      | found       | Attention Is All You Need                                                                                              | 2017 | false     |
      | in-memory | 10.1234/does-not-exist-xyz     | unknown     |                                                                                                                        | none | false     |
      | in-memory | 10.1234/down                   | unavailable |                                                                                                                        | none | false     |

  Scenario: doi.org receives one plain GET with the two headers and the signal of a limit of 20 s
    Given the evidence doi.org adapter over the recorded fetch
    When the evidence registry looks up "10.1145/3597503.3639187"
    Then the evidence fetch received one request to "https://doi.org/10.1145/3597503.3639187"
    And the evidence fetch request is a GET with exactly the two headers of the design note
    And the evidence fetch request carries the signal made for a limit of 20000 ms

  Scenario: the parentheses of a DOI are percent-encoded
    Given the evidence doi.org adapter over the recorded fetch
    When the evidence registry looks up "10.1016/S0140-6736(97)11096-0"
    Then the evidence fetch received one request to "https://doi.org/10.1016/S0140-6736%2897%2911096-0"

  Scenario: every character outside the unreserved set is encoded as upper case UTF-8 bytes
    Given the evidence doi.org adapter over the recorded fetch
    When the evidence registry looks up "10.1234/a!'*b+é?#%\u0001_~.-"
    Then the evidence fetch received one request to "https://doi.org/10.1234/a%21%27%2Ab%2B%C3%A9%3F%23%25%01_~.-"

  Scenario Outline: doi.org is unavailable when <cause>
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch answers "10.1234/odd" with status <status> and body '<body>'
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup is unavailable with the detail "<detail>"

    Examples:
      | cause                        | status | body                                      | detail                                         |
      | the status is 500            | 500    | {}                                        | status 500                                     |
      | the status is 429            | 429    | {}                                        | status 429                                     |
      | the status is 201            | 201    | {"title":"A title"}                       | status 201                                     |
      | the body is not JSON         | 200    | <html>                                    | body is not JSON                               |
      | the body is null             | 200    | null                                      | title is missing or holds no letter or digit   |
      | the body is a list           | 200    | []                                        | title is missing or holds no letter or digit   |
      | the title is missing         | 200    | {"issued":{"date-parts":[[2024]]}}        | title is missing or holds no letter or digit   |
      | the title is not a string    | 200    | {"title":42}                              | title is missing or holds no letter or digit   |
      | the title holds no letter    | 200    | {"title":"-- ! --"}                       | title is missing or holds no letter or digit   |

  Scenario: a 200 without any body is unavailable
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch answers "10.1234/odd" with status 200 and no body
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup is unavailable with the detail "body is not JSON"

  Scenario Outline: a body of <size> bytes sent in chunks of <chunk> bytes is read
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch answers "10.1234/odd" with a JSON body of <size> bytes sent in chunks of <chunk> bytes
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup is found with the title "A title"

    Examples:
      | size    | chunk   |
      | 1048576 | 1048576 |
      | 1048576 | 4096    |

  Scenario Outline: a body of <size> bytes sent in chunks of <chunk> bytes is unavailable
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch answers "10.1234/odd" with a JSON body of <size> bytes sent in chunks of <chunk> bytes
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup is unavailable with the detail "body is larger than 1 MiB"

    Examples:
      | size    | chunk   |
      | 1048577 | 1048577 |
      | 1228800 | 614400  |

  Scenario: a thrown fetch is unavailable and names its cause
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch fails for "10.1234/odd" with "socket hang up"
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup is unavailable with the detail "fetch failed: Error: socket hang up"

  Scenario Outline: the year is read only from an integer first date part (<case>)
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch answers "10.1234/odd" with status 200 and body '<body>'
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup year is "<year>"

    Examples:
      | case             | body                                                    | year |
      | no issued        | {"title":"A title"}                                     | none |
      | empty date parts | {"title":"A title","issued":{"date-parts":[]}}          | none |
      | empty first part | {"title":"A title","issued":{"date-parts":[[]]}}        | none |
      | not an integer   | {"title":"A title","issued":{"date-parts":[[2024.5]]}}  | none |
      | a string         | {"title":"A title","issued":{"date-parts":[["2024"]]}}  | none |
      | year only        | {"title":"A title","issued":{"date-parts":[[2017]]}}    | 2017 |
      | year and month   | {"title":"A title","issued":{"date-parts":[[1998,2]]}}  | 1998 |

  Scenario Outline: a retraction is read from the entries of updated-by (<case>)
    Given the evidence doi.org adapter over the recorded fetch
    And the evidence fetch answers "10.1234/odd" with status 200 and body '<body>'
    When the evidence registry looks up "10.1234/odd"
    Then the evidence lookup retracted flag is "<retracted>"

    Examples:
      | case                  | body                                                                  | retracted |
      | no updated-by         | {"title":"A title"}                                                   | false     |
      | a correction only     | {"title":"A title","updated-by":[{"type":"correction"}]}              | false     |
      | not a list            | {"title":"A title","updated-by":{"type":"retraction"}}                | false     |
      | a retraction          | {"title":"A title","updated-by":[{"type":"retraction"}]}              | true      |
      | after malformed items | {"title":"A title","updated-by":[3,null,{"type":"retraction"}]}       | true      |
