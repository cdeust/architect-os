Feature: The hosted mutation plan follows the estimated cost, and the judge derives it again
  The number of hosted lanes is no constant (docs/design/platform-v3-srt.md §7, « Lots hébergés »): the planner opens
  as many lanes as the estimated cost of the perimeter is worth, one when the perimeter is empty. The plan decides who
  mutates what, never what is judged: every mutant of the inventory is in exactly one lane.

  Scenario Outline: the slices of a perimeter of <mutants> mutants, <loaded> of them outside a function, are that perimeter
    Given a synthetic hosted inventory of <mutants> mutants in <files> files, <loaded> of them outside every function body
    When the hosted planner slices it for a lane worth 10 plain mutants, at most 16 lanes
    Then every mutant of the synthetic inventory is in exactly one hosted slice
    And every hosted slice mutates the canary, whole
    And no hosted slice is without a production mutant unless it is the only one
    And the hosted planner opens <lanes> lanes
    And slicing the same synthetic inventory again gives the same slices, byte for byte

    Examples:
      | mutants | files | loaded | lanes |
      | 0       | 0     | 0      | 1     |
      | 1       | 1     | 0      | 1     |
      | 1       | 1     | 1      | 1     |
      | 5       | 2     | 0      | 1     |
      | 5       | 2     | 2      | 4     |
      | 300     | 7     | 0      | 16    |
      | 300     | 7     | 40     | 16    |
      | 45      | 3     | 0      | 4     |

  Scenario Outline: an estimated cost of <cost> is worth <lanes> lanes when a lane is worth 100 and at most 5 are allowed
    Then an estimated cost of <cost> is worth <lanes> lanes for a lane worth 100, at most 5 lanes

    Examples:
      | cost | lanes |
      | 0    | 1     |
      | 99   | 1     |
      | 100  | 1     |
      | 199  | 1     |
      | 200  | 2     |
      | 499  | 4     |
      | 500  | 5     |
      | 9000 | 5     |

  Scenario: lanes open one by one as the estimated cost of separate mutants crosses the worth of a lane
    Then 1 to 12 separate mutants worth 100 each, for a lane worth 200 and at most 4 lanes, open "1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4" lanes

  Scenario: a lane that would be left without a production mutant is not opened
    Then one mutant measured at 500, for a lane worth 100 and at most 5 lanes, opens a single lane that holds it

  Scenario: a mutant outside every function body costs what a load-time mutant was measured to cost, unless it has its own sample
    Then a mutant no function body encloses is estimated at the cost of a load-time mutant
    And a mutant inside a block body or an arrow body keeps the fallback of its file
    And a measured sample is taken before either estimate
    And an ignored mutant costs nothing wherever it is

  Scenario: the hosted lane policy committed with the gate loads
    Given the committed hosted lane policy
    Then the hosted lane policy is accepted
    And it names the runs its measurements come from

  Scenario Outline: a hosted lane policy with <fault> is refused
    Given the committed hosted lane policy
    When its field "<field>" is set to '<value>'
    Then the hosted lane policy is refused with a reason holding "<field>"

    Examples:
      | fault                         | field             | value                 |
      | a unit that is not the gate's | unit              | "seconds"             |
      | no description                | description       | ""                    |
      | a load-time cost of zero      | loadTimeMutantMs  | 0                     |
      | a fractional load-time cost   | loadTimeMutantMs  | 1.5                   |
      | a lane worth nothing          | laneTargetMs      | 0                     |
      | a fractional lane worth       | laneTargetMs      | 0.5                   |
      | no lane at all                | maxLanes          | 0                     |
      | more lanes than a matrix has  | maxLanes          | 257                   |
      | half a lane                   | maxLanes          | 2.5                   |
      | no measured run               | provenance.runs   | []                    |
      | a run that is no run address  | provenance.runs   | ["45739094567"]       |
      | no measurement                | provenance.dryRun | ""                    |
      | no load-time measurement      | provenance.loadTime | ""                  |
      | no rule                       | provenance.rule   | ""                    |
      | no reason for the bound       | provenance.bound  | ""                    |
      | an unknown key                | extra             | 1                     |
      | an unknown provenance         | provenance.extra  | "x"                   |

  Scenario Outline: a hosted lane policy at the edge of its schema, <edge>, is accepted
    Given the committed hosted lane policy
    When its field "<field>" is set to '<value>'
    Then the hosted lane policy is accepted

    Examples:
      | edge                   | field        | value |
      | one lane               | maxLanes     | 1     |
      | a whole matrix         | maxLanes     | 256   |
      | the least load-time cost | loadTimeMutantMs | 1     |
      | the least lane worth   | laneTargetMs | 1     |

  Scenario: the hosted mutation costs committed with the gate load
    Given the committed hosted mutation costs
    Then the hosted mutation costs are accepted

  Scenario Outline: hosted mutation costs with <fault> are refused
    Given the smallest hosted mutation costs
    When their field "<field>" is set to '<value>'
    Then the hosted mutation costs are refused with a reason holding "<field>"

    Examples:
      | fault                        | field                 | value   |
      | a negative fallback          | fallback              | -1      |
      | a fallback that is no number | fallback              | "661"   |
      | files that are no table      | files                 | []      |
      | a negative file fallback     | files.a.fallback      | -1      |
      | a negative sample            | files.a.samples.k     | -1      |
      | a sample that is no number   | files.a.samples.k     | "1"     |
      | an unknown key in a file     | files.a.extra         | 1       |
      | an unknown key               | extra                 | 1       |
      | a reference that is no text  | reference             | 1       |

  Scenario: the plan job and the judge derive the same plan from two checkouts of one commit
    Given a gate repository
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And the hosted lane policy of the gate repository opens a lane per mutant, at most 3
    And the gate first parent is committed
    And the gate repository file "src/nested.mjs" reads:
      """
      export function pick(value) {
        return value && true;
      }
      """
    And the gate head is committed
    When the hosted plan is derived in the gate repository and in a second checkout of the same commit
    Then both checkouts announce the same lanes, more than one
    And both checkouts write the same manifest for every lane, byte for byte
    And a lane outside the plan is refused by name in either checkout

  Scenario: an empty perimeter plans one lane, which mutates the canary alone
    Given a gate repository
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And the hosted lane policy of the gate repository opens a lane per mutant, at most 3
    And the gate first parent is committed
    And the gate head is committed
    When the hosted plan is derived in the gate repository
    Then the hosted plan announces the lanes "[1]"
    And the manifest of hosted lane 1 mutates the canary alone
    And hosted lane 2 is refused as outside the plan

  Scenario: a broken lane policy or broken costs stop the hosted plan before it announces anything
    Given a gate repository
    And the gate repository file "zz/probe.mjs" reads:
      """
      export function probe(value) {
        return !value;
      }
      """
    And the gate configuration declares the canary "zz/probe.mjs" with:
      """
      {"probe":"Survived"}
      """
    And the gate configuration declares the replay
    And the hosted lane policy of the gate repository opens a lane per mutant, at most 3
    And the gate head is committed
    When the hosted plan is derived in the gate repository
    Then a later plan with a lane policy outside its schema is refused and leaves no announced plan
    And a later plan with costs outside their schema is refused and leaves no announced plan
    And a later plan without a lane policy is refused and leaves no announced plan
