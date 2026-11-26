Feature: The StepStore port: what a Step retains, behind a port
  Every adapter of StepStore (packages/sandbox/src/step-store.ts) holds the same contract: the files of the admitted
  run, as `npm run step` composes it, and the in-memory one. A Step of a run is reserved once; an artifact is of a
  named kind, written once, refused before any write when its name, its size, a credential shape in its bytes or the
  schema of its kind refuses it; the events are appended in order.

  Background:
    Given a bound run for the runtime entry check
    And private directories for an admitted step

  Scenario Outline: The <adapter> store reserves a Step once and refuses a second reservation of it in the run
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then reserving the Step "store" again is refused with "EEXIST"
    And reserving the Step "other" is accepted
    And reserving the Step "Not-a-name" is refused with "STEP_NAME_INVALID"
    And reserving the Step "../escape" is refused with "STEP_NAME_INVALID"

    Examples:
      | adapter   |
      | file      |
      | in-memory |

  Scenario Outline: The <adapter> store records an artifact of each kind and reads back its bytes
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then every kind of artifact is recorded and read back byte for byte
    And an artifact not recorded reads back as nothing

    Examples:
      | adapter   |
      | file      |
      | in-memory |

  Scenario Outline: The <adapter> store refuses an artifact <defect> with "<code>" and writes nothing
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then recording the artifact "<kind>" named "<name>" with <content> is refused with "<code>"

    Examples:
      | adapter   | defect                                  | kind           | name    | content                         | code                  |
      | file      | that is not JSON                        | build.measure  |         | the text "{"                    | STEP_ARTIFACT_INVALID |
      | in-memory | that is not JSON                        | build.measure  |         | the text "{"                    | STEP_ARTIFACT_INVALID |
      | file      | of a measure without its completion     | scout.measure  | files   | a measure without "completed"   | STEP_ARTIFACT_INVALID |
      | in-memory | of a measure without its completion     | scout.measure  | files   | a measure without "completed"   | STEP_ARTIFACT_INVALID |
      | file      | of a measure of a review not a measure  | review.measure | general | the JSON {}                     | STEP_ARTIFACT_INVALID |
      | in-memory | of a measure of a review not a measure  | review.measure | general | the JSON {}                     | STEP_ARTIFACT_INVALID |
      | file      | of a build measure not a measure        | build.measure  |         | the JSON []                     | STEP_ARTIFACT_INVALID |
      | in-memory | of a build measure not a measure        | build.measure  |         | the JSON []                     | STEP_ARTIFACT_INVALID |
      | file      | of facts with an unknown reason         | scout.facts    | files   | facts rejected for "autre"      | STEP_ARTIFACT_INVALID |
      | in-memory | of facts with an unknown reason         | scout.facts    | files   | facts rejected for "autre"      | STEP_ARTIFACT_INVALID |
      | file      | of facts invalid without a reason       | scout.facts    | files   | the JSON {"invalid":1}          | STEP_ARTIFACT_INVALID |
      | in-memory | of facts invalid without a reason       | scout.facts    | files   | the JSON {"invalid":1}          | STEP_ARTIFACT_INVALID |
      | file      | of claims that are not claims           | build.claims   |         | the JSON {"claims":[{}]}        | STEP_ARTIFACT_INVALID |
      | in-memory | of claims that are not claims           | build.claims   |         | the JSON {"claims":[{}]}        | STEP_ARTIFACT_INVALID |
      | file      | of claims without their identifier      | build.claims   |         | the JSON {"claims":[{"brief_item":"b","instead":"i","evidence":[{"command":"c"}]}]} | STEP_ARTIFACT_INVALID |
      | in-memory | of claims without their identifier      | build.claims   |         | the JSON {"claims":[{"brief_item":"b","instead":"i","evidence":[{"command":"c"}]}]} | STEP_ARTIFACT_INVALID |
      | file      | of a check with a textual exit code     | check          | types   | a check exiting with "x"        | STEP_ARTIFACT_INVALID |
      | in-memory | of a check with a textual exit code     | check          | types   | a check exiting with "x"        | STEP_ARTIFACT_INVALID |
      | file      | of a verdict of an unknown verdict      | review.verdict | general | the JSON {"verdict":"maybe"}       | STEP_ARTIFACT_INVALID |
      | in-memory | of a verdict of an unknown verdict      | review.verdict | general | the JSON {"verdict":"maybe"}       | STEP_ARTIFACT_INVALID |
      | file      | of a kind of a session without its name | scout.facts    |         | the JSON {"invalid":"x"}        | STEP_ARTIFACT_INVALID |
      | in-memory | of a kind of a session without its name | scout.facts    |         | the JSON {"invalid":"x"}        | STEP_ARTIFACT_INVALID |
      | file      | of a kind one per Step with a name      | build.report   | x       | the text "report"               | STEP_ARTIFACT_INVALID |
      | in-memory | of a kind one per Step with a name      | build.report   | x       | the text "report"               | STEP_ARTIFACT_INVALID |
      | file      | whose name would leave its folder       | check          | ../x    | a check that passes             | STEP_ARTIFACT_INVALID |
      | in-memory | whose name would leave its folder       | check          | ../x    | a check that passes             | STEP_ARTIFACT_INVALID |
      | file      | of an unknown kind                      | record         | x       | the text "{}"                   | STEP_ARTIFACT_INVALID |
      | in-memory | of an unknown kind                      | record         | x       | the text "{}"                   | STEP_ARTIFACT_INVALID |
      | file      | of one byte more than 1 MiB             | build.report   |         | 1048577 bytes of "a"            | STEP_ARTIFACT_TOO_LARGE |
      | in-memory | of one byte more than 1 MiB             | build.report   |         | 1048577 bytes of "a"            | STEP_ARTIFACT_TOO_LARGE |
      | file      | of more than 1 MiB in UTF-8 bytes       | build.brief    |         | 524289 characters "é"           | STEP_ARTIFACT_TOO_LARGE |
      | in-memory | of more than 1 MiB in UTF-8 bytes       | build.brief    |         | 524289 characters "é"           | STEP_ARTIFACT_TOO_LARGE |
      | file      | holding an Anthropic API key            | build.report   |         | an Anthropic API key            | STEP_ARTIFACT_CREDENTIAL |
      | in-memory | holding an Anthropic API key            | build.report   |         | an Anthropic API key            | STEP_ARTIFACT_CREDENTIAL |
      | file      | holding an Anthropic OAuth token        | build.brief    |         | an Anthropic OAuth token        | STEP_ARTIFACT_CREDENTIAL |
      | in-memory | holding an Anthropic OAuth token        | build.brief    |         | an Anthropic OAuth token        | STEP_ARTIFACT_CREDENTIAL |
      | file      | holding a GitHub token                  | review.brief   |         | a GitHub token                  | STEP_ARTIFACT_CREDENTIAL |
      | in-memory | holding a GitHub token                  | review.brief   |         | a GitHub token                  | STEP_ARTIFACT_CREDENTIAL |
      | file      | holding a fine-grained GitHub token     | build.report   |         | a fine-grained GitHub token     | STEP_ARTIFACT_CREDENTIAL |
      | in-memory | holding a fine-grained GitHub token     | build.report   |         | a fine-grained GitHub token     | STEP_ARTIFACT_CREDENTIAL |
      | file      | holding a key escaped in its JSON       | check          | types   | a check whose output escapes a key | STEP_ARTIFACT_CREDENTIAL |
      | in-memory | holding a key escaped in its JSON       | check          | types   | a check whose output escapes a key | STEP_ARTIFACT_CREDENTIAL |

  Scenario Outline: The <adapter> store names the credential shape it refuses, and never quotes it
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then recording <content> names the shape "<shape>" without quoting it

    Examples:
      | adapter   | content                     | shape                 |
      | file      | an Anthropic API key        | anthropic-key         |
      | in-memory | an Anthropic API key        | anthropic-key         |
      | file      | an Anthropic OAuth token    | anthropic-oauth-token |
      | in-memory | an Anthropic OAuth token    | anthropic-oauth-token |
      | file      | a GitHub token              | github-token          |
      | in-memory | a GitHub token              | github-token          |

  Scenario Outline: The <adapter> store accepts an artifact at its bounds and an ordinary text near a credential prefix
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then the artifacts at the bounds of the port are recorded and read back
    And an OAuth token at its least length is named as one

    Examples:
      | adapter   |
      | file      |
      | in-memory |

  Scenario Outline: The <adapter> store refuses to write the same artifact twice and keeps the first
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then recording the build report twice is refused with "EEXIST" and the first report is kept

    Examples:
      | adapter   |
      | file      |
      | in-memory |

  Scenario Outline: The <adapter> store appends the events of a Step in order and refuses one outside its lists
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then a Step without events reads back none
    And the events appended read back in their order, numbered from 0
    And an event of an unknown phase is refused with "STEP_EVENT_INVALID" and the events are unchanged

    Examples:
      | adapter   |
      | file      |
      | in-memory |

  Scenario: The file store writes each artifact as a private file of its name, created once, and its events by appending
    Given the file step store
    When the Step "store" is reserved in the step store
    Then every artifact of the Step is a file of mode 0600 named as npm run step names it
    And the events are lines appended to a private file that a link cannot redirect

  Scenario: The file store passes on a refusal of the system other than a missing file when it reads back
    Given the file step store
    When the Step "store" is reserved in the step store
    Then a read that is not of a missing file is refused as the system refuses it

  Scenario Outline: The <adapter> store names what it refuses, after its code
    Given the <adapter> step store
    When the Step "store" is reserved in the step store
    Then each refusal of the port names what it refuses

    Examples:
      | adapter   |
      | file      |
      | in-memory |

  Scenario: The file store gives the stream directory of a Step it reserved, and refuses one it did not
    Given the file step store
    When the Step "store" is reserved in the step store
    Then the stream directory of the Step "store" is the one of the run
    And the stream directory of the Step "other" is refused with "STEP_NOT_RESERVED"
