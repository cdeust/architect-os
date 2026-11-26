Feature: routing.json, the routing table of the launcher
  The table gives, for each role of a Step session, bands of story points and the ordered candidates of each band
  (docs/design/orchestration-fable-5-2.md, §13). Plan and Step derive the sessions of a Step from it with one function.

  Scenario: the committed table loads, provisional, with the bands of the owner's policy
    Given the committed routing table
    Then the routing table loads, provisional
    And the build bands of the routing table start at "1 3 8"

  Scenario Outline: a broken copy of the committed table is refused: <defect>
    Given the committed routing table
    When the routing table is broken by <defect>
    Then loading the routing table is refused with "<reason>"

    Examples:
      | defect                              | reason                            |
      | a Google build candidate            | roles.build.bands.2.candidates.0  |
      | an unqualified Terra model          | roles.build.bands.2.candidates.1  |
      | a first band above one point        | ROUTING_FIRST_BAND                |
      | two bands out of order              | ROUTING_BANDS_ORDER               |
      | a last band that requires checks    | ROUTING_LAST_BAND_REQUIRES_CHECKS |
      | a status that claims a measure      | status                            |
      | an unknown key                      | roles.build                       |
      | a band without candidates           | roles.review.bands.0.candidates   |
      | a scout band that requires checks   | roles.scout.bands.0               |
      | an OpenAI review candidate          | roles.review.bands.0.candidates.0 |
      | a model that is not a Claude model  | roles.scout.bands.0.candidates.0  |
      | an empty basis                      | basis                             |
      | a blank description                 | description                       |
      | a review band that requires checks  | roles.review.bands.0              |
      | a Claude model with a prefix        | roles.scout.bands.0.candidates.0  |
      | a Claude model with a suffix        | roles.scout.bands.0.candidates.0  |

  Scenario Outline: the committed table routes a ticket of <points> points with <checks> checks to <ladder>
    Given the committed routing table
    And the tickets "TICKET-001=<points>"
    When I derive the route for the ticket "" with the providers "anthropic", <checks> checks and 0 scouts
    Then the route serves "TICKET-001" at <points> points, starting on "<start>"
    And the ladder of the route is "<ladder>"
    And the reviews of the route are "<reviews>"

    Examples:
      | points | checks | start                | ladder                                                                                           | reviews                                       |
      | 1      | 1      | BAND_OF_POINTS       | 1 anthropic claude-haiku-5-5 medium; 3 anthropic claude-sonnet-5-5 medium; 8 anthropic claude-opus-5-5 high | google waiting; google waiting; google waiting |
      | 2      | 0      | BAND_REQUIRES_CHECKS | 3 anthropic claude-sonnet-5-5 medium; 8 anthropic claude-opus-5-5 high                            | google waiting; google waiting                 |
      | 3      | 0      | BAND_OF_POINTS       | 3 anthropic claude-sonnet-5-5 medium; 8 anthropic claude-opus-5-5 high                            | google waiting; google waiting                 |
      | 5      | 2      | BAND_OF_POINTS       | 3 anthropic claude-sonnet-5-5 medium; 8 anthropic claude-opus-5-5 high                            | google waiting; google waiting                 |
      | 8      | 0      | BAND_OF_POINTS       | 8 anthropic claude-opus-5-5 high                                                                 | google waiting                                 |
      | 89     | 0      | BAND_OF_POINTS       | 8 anthropic claude-opus-5-5 high                                                                 | google waiting                                 |

  Scenario: an operator who admits only OpenAI gets Sol on a complex ticket
    Given the committed routing table
    And the tickets "TICKET-001=13"
    When I derive the route for the ticket "" with the providers "openai", 0 checks and 0 scouts
    Then the ladder of the route is "8 openai gpt-6.2-sol high"

  Scenario: an operator who admits only OpenAI has no builder for an all-round ticket
    Given the committed routing table
    And the tickets "TICKET-001=5"
    When I derive the route for the ticket "" with the providers "openai", 0 checks and 0 scouts
    Then deriving the route fails with "ROUTING_NO_ADMITTED_BUILDER"

  Scenario: a band without an admitted candidate ends the ladder below it
    Given the routing table where the band of 8 points has only Sol
    And the tickets "TICKET-001=3"
    When I derive the route for the ticket "" with the providers "anthropic", 0 checks and 0 scouts
    Then the ladder of the route is "3 anthropic claude-sonnet-5-5 medium"

  Scenario: the scouts of a routed Step take the scout route
    Given the committed routing table
    And the tickets "TICKET-001=5"
    When I derive the route for the ticket "" with the providers "anthropic", 0 checks and 2 scouts
    Then the scout route is "anthropic claude-haiku-5-5 low"

  Scenario: a Step without scouts carries no scout route
    Given the committed routing table
    And the tickets "TICKET-001=5"
    When I derive the route for the ticket "" with the providers "anthropic", 0 checks and 0 scouts
    Then the route has no scout route

  Scenario: an OpenAI-only operator with scouts has no scout candidate before any builder question
    Given the routing table where the band of 3 points has only Sol
    And the tickets "TICKET-001=5"
    When I derive the route for the ticket "" with the providers "openai", 0 checks and 1 scouts
    Then deriving the route fails with "ROUTING_NO_ADMITTED_SCOUT"

  Scenario Outline: the ticket a Step serves: <case>
    Given the committed routing table
    And the tickets "<tickets>"
    When I derive the route for the ticket "<designated>" with the providers "anthropic", 0 checks and 0 scouts
    Then <outcome>

    Examples:
      | case                         | tickets                                        | designated | outcome                                                       |
      | the single root              | TICKET-001=3 TICKET-002=13<TICKET-001           |            | the route serves "TICKET-001" at 3 points, starting on "BAND_OF_POINTS" |
      | a designated successor       | TICKET-001=3 TICKET-002=13<TICKET-001           | TICKET-002 | the route serves "TICKET-002" at 13 points, starting on "BAND_OF_POINTS" |
      | two roots and no designation | TICKET-001=3 TICKET-002=13                      |            | deriving the route fails with "ROUTING_TICKET_AMBIGUOUS"      |
      | an unknown designation       | TICKET-001=3                                   | TICKET-009 | deriving the route fails with "ROUTING_TICKET_UNKNOWN"        |
      | no tickets                   |                                                |            | deriving the route fails with "ROUTING_TICKETS_REQUIRED"      |

  Scenario: the reviewer of each pass is never of the provider of its builder
    Given the routing table where reviews go to Gemini, then Opus, and the band of 8 points has only Sol
    And the tickets "TICKET-001=3"
    When I derive the route for the ticket "" with the providers "anthropic openai", 0 checks and 0 scouts
    Then the ladder of the route is "3 anthropic claude-sonnet-5-5 medium; 8 openai gpt-6.2-sol high"
    And the reviews of the route are "google waiting; anthropic claude-opus-5-5 high"

  Scenario: a reviewer whose provider the operator does not admit is a wait, never a session
    Given the routing table where reviews go to Gemini, then Opus, and the band of 8 points has only Sol
    And the tickets "TICKET-001=8"
    When I derive the route for the ticket "" with the providers "openai", 0 checks and 0 scouts
    Then the reviews of the route are "google waiting"

  Scenario: a table whose only reviewer is of the builder's provider is refused
    Given the routing table where reviews go only to Opus
    And the tickets "TICKET-001=3"
    When I derive the route for the ticket "" with the providers "anthropic", 0 checks and 0 scouts
    Then deriving the route fails with "ROUTING_NO_INDEPENDENT_REVIEWER"

  Scenario: the table accepts every effort of its schema and Claude versions of two digits
    Given the routing table whose candidates carry the efforts and versions of every kind
    Then the routing table loads, provisional

  Scenario: a band above the first that requires checks is skipped without changing the reason of the start
    Given the routing table where the band of 3 points requires checks
    And the tickets "TICKET-001=1"
    When I derive the route for the ticket "" with the providers "anthropic", 0 checks and 0 scouts
    Then the route serves "TICKET-001" at 1 points, starting on "BAND_REQUIRES_CHECKS"
    And the ladder of the route is "8 anthropic claude-opus-5-5 high"

  Scenario: a band skipped after the first pass leaves the reason of the start as it was
    Given the routing table where only the band of 3 points requires checks
    And the tickets "TICKET-001=1"
    When I derive the route for the ticket "" with the providers "anthropic", 0 checks and 0 scouts
    Then the route serves "TICKET-001" at 1 points, starting on "BAND_OF_POINTS"
    And the ladder of the route is "1 anthropic claude-haiku-5-5 medium; 8 anthropic claude-opus-5-5 high"

  Scenario Outline: the routed policy of the operator: <change>
    Then a routed policy with <change> is <outcome>

    Examples:
      | change                      | outcome                                    |
      | nothing more                | accepted                                   |
      | the parallel 1              | accepted                                   |
      | the parallel 8              | accepted                                   |
      | the parallel 0              | refused with "parallel"                    |
      | the parallel 9              | refused with "parallel"                    |
      | two scouts of the same name | refused with "scouts duplicate scout name" |
