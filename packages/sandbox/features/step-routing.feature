Feature: a routed Step plays its ladder, one band at a time, on objective signals only
  A step.json written by a routed Plan carries the route derived from the launcher table: one pass per band from the
  ticket's band upward, each with its builder and its independent review (docs/design/orchestration-fable-5-2.md, §13).
  Step derives the route again from its frozen table and refuses any difference. The host promotes a pass to the next
  band on a failed check, a valid verdict that blocks, or a build stopped by its limit; never on a provider failure, an
  invalid verdict, a review that waits, nor on anything a session says.

  Rule: Step plays the route Plan derived, and nothing else

    Scenario Outline: a routed step.json that is not the route of its table is refused before any session: <change>
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the routed step.json is tampered with: <change>
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ROUTING_MISMATCH"
      And no session was started

      Examples:
        | change                                   |
        | a stronger first builder                 |
        | a longer first build                     |
        | a ladder without its last band           |
        | a review outside the ladder              |
        | the digest of another table              |
        | a ticket estimated higher than its route |

    Scenario: a Google review cannot be turned into a session by the step file
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the routed step.json is tampered with: a Google review marked as a session
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr begins with "architect-os step: step.json refusé"
      And no session was started

    Scenario: a launcher table changed since Plan read it refuses the step
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      When the launcher routing table changed after Plan read it
      And I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ROUTING_MISMATCH"
      And no session was started

    Scenario: the evidence of a routed Step must cover the builder of every pass
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the admission evidence lacks the specimen of "build:pass-2"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ADMISSION_REQUIRED"
      And no session was started

    Scenario: the evidence of a routed Step must cover the review of every pass that does not wait
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 8 points
      And the step folder holds a routed step.json for a ticket of 13 points, with the checks "" and the providers "anthropic openai"
      And the admission evidence lacks the specimen of "review:independent"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ADMISSION_REQUIRED"

    Scenario: the evidence of a routed Step proves the review of a promoted pass on a case with prior findings
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the review session writes the fixture "review-accept-proposal.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0

    Scenario Outline: the evidence of the review of a promoted pass without a faithful prior-findings case is refused: <change>
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the admission evidence of "<role>" has its prior-findings case <change>
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ADMISSION_REQUIRED"
      And no session was started

      Examples:
        | role                      | change             |
        | review:independent:pass-2 | removed            |
        | review:independent:pass-2 | observed otherwise |

    Scenario: the launcher files of a routed Step hold the table, and the review tool only when a review can run
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json profiles/builder.json profiles/checker.json prompts/build.md routing.json"

    Scenario Outline: a step.json whose route no longer derives is refused before any session, with the cause: <change>
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the routed step.json is tampered with: <change>
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ROUTING_MISMATCH: <code>"
      And no session was started

      Examples:
        | change                                        | code                        |
        | another admitted provider                     | ROUTING_NO_ADMITTED_BUILDER |
        | a designated ticket the tickets no longer hold | ROUTING_TICKET_UNKNOWN     |

    Scenario: a launcher table that does not load refuses a routed step, and says so
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the launcher routing table is not a valid table
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: STEP_ROUTING_MISMATCH: ROUTING_TABLE_INVALID"
      And no session was started

    Scenario Outline: a routing block its schema refuses is refused as a step file: <change>
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the routed step.json is tampered with: <change>
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: step.json refusé : <issue>"
      And no session was started

      Examples:
        | change                                    | issue                                                                 |
        | a provider admitted twice                 | routing.providers: ROUTING_PROVIDER_DUPLICATE                         |
        | a table digest with a character before it | routing.table_sha256: Invalid string: must match pattern /^[0-9a-f]{64}$/ |
        | a table digest with a character after it  | routing.table_sha256: Invalid string: must match pattern /^[0-9a-f]{64}$/ |

    Scenario: the launcher files of a ladder that crosses to OpenAI hold the SBX assets, and the review tool for the pass that can be reviewed
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic openai"
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json profiles/builder.json profiles/checker.json profiles/reviewer.json prompts/build.md prompts/review.md review.json routing.json sbx/codex-guest.py sbx/isolation.json"

    Scenario: a routed Step with a scout gives it the scout model of the table
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types", the scouts "files" and the providers "anthropic"
      And the scout session writes the fixture "scout-facts-a.jsonl"
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the scout sessions started with the models "claude-haiku-5-5"
      And the published record field "outcome" is "waiting"

  Rule: a review that waits is a named wait, never a skip nor a fallback to the author's provider

    Scenario: the checks pass and the Google review waits: no review session, the step ends waiting
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the sessions started were "code.json"
      And the build sessions started with the models "claude-sonnet-5-5"
      And the published record field "outcome" is "waiting"
      And the published record routing serves "TICKET-001" at 5 points from the committed table, starting on "BAND_OF_POINTS"
      And the published record field "routing.passes" is [{"pass":1,"band":3,"provider":"anthropic","model":"claude-sonnet-5-5","effort":"medium","signal":"review_waiting"}]
      And the published record lists the reviews ""
      And the published record is accepted by the schema

  Rule: the host promotes one band at a time, on what it observed

    Scenario: a failed check promotes to the next band, whose build gets the check as data
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 ends with the exit code 1
      And the check 1 prints "TS2322 in the new file"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the build sessions started with the models "claude-sonnet-5-5 claude-opus-5-5"
      And the brief of build pass 1 is the brief of the step
      And the brief of build pass 2 contains "## Previous pass, as the host observed it"
      And the brief of build pass 2 contains "after pass 1 on claude-sonnet-5-5, on the signal check_failed"
      And the brief of build pass 2 contains "\"TS2322 in the new file\""
      And the brief of build pass 2 contains "Build the thing.\n\n## Previous pass, as the host observed it\n\nThe host promoted"
      And the retained file "build.brief.md" is the brief of build pass 1
      And the retained file "pass-2.build.brief.md" is the brief of build pass 2
      And the step stdout carries the record field "routing" as "routing"
      And the published record field "routing.passes" is [{"pass":1,"band":3,"provider":"anthropic","model":"claude-sonnet-5-5","effort":"medium","signal":"check_failed"},{"pass":2,"band":8,"provider":"anthropic","model":"claude-opus-5-5","effort":"high","signal":"review_waiting"}]
      And the published record lists the checks "types=failed types=passed"
      And the published record field "checks" is [{"name":"types","pass":1,"passed":false,"stopped":false,"durationSeconds":0},{"name":"types","pass":2,"passed":true,"stopped":false,"durationSeconds":0}]
      And the published record lists the sessions "build build"
      And the published record field "sessions.1.pass" is 2
      And the published record field "outcome" is "waiting"
      And the published record is accepted by the schema
      And a copy of the published record whose passes are "out of order" is refused by the schema with "ROUTING_PASS_ORDER"
      And a copy of the published record whose passes are "numbered from 2" is refused by the schema with "ROUTING_PASS_ORDER"
      And a copy of the published record whose passes are "with a gap" is refused by the schema with "ROUTING_PASS_ORDER"

    Scenario: a build stopped by its limit promotes to the next band
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the build session of pass 1 is stopped by its limit
      When I run the step with the arguments "<folder>"
      Then the build sessions started with the models "claude-sonnet-5-5 claude-opus-5-5"
      And the published record field "routing.passes.0.signal" is "stopped"
      And the published record lists the checks "types=passed"
      And the published record field "checks.0.pass" is 2

    Scenario: a build that fails without its limit is a provider failure: no promotion, the step is refused
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the build session of pass 1 exits with 3
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the build sessions started with the models "claude-sonnet-5-5"
      And no check was started
      And the published record field "routing.passes" is [{"pass":1,"band":3,"provider":"anthropic","model":"claude-sonnet-5-5","effort":"medium","signal":"build_failed"}]
      And the published record field "outcome" is "refused"

    Scenario: the last band ends the ladder: a failed check there is a refusal
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 13 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 ends with the exit code 1
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the build sessions started with the models "claude-opus-5-5"
      And the published record field "routing.passes" is [{"pass":1,"band":8,"provider":"anthropic","model":"claude-opus-5-5","effort":"high","signal":"check_failed"}]
      And the published record field "outcome" is "refused"

    Scenario: a small ticket with a check starts on Haiku and climbs every band, one at a time
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 1 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 ends with the exit code 1
      And the check 2 ends with the exit code 1
      And the check 3 ends with the exit code 1
      When I run the step with the arguments "<folder>"
      Then the build sessions started with the models "claude-haiku-5-5 claude-sonnet-5-5 claude-opus-5-5"
      And the published record field "routing.passes.2.signal" is "check_failed"
      And the published record field "outcome" is "refused"

    Scenario: a valid verdict that requests changes promotes, and the next build gets its findings as data
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the build session writes the fixture "build-exact.jsonl"
      And the review session writes the fixture "review-request-changes.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the build sessions started with the models "gpt-6.2-sol claude-opus-5-5"
      And the review sessions started with the models "claude-opus-5-5"
      And the brief of build pass 2 contains "on the signal changes_requested"
      And the brief of build pass 2 contains "Blocking findings of the review:"
      And the published record field "routing.passes.0.signal" is "changes_requested"
      And the published record field "routing.passes.1.signal" is "review_waiting"
      And the published record field "reviews.0.pass" is 1
      And the published record is accepted by the schema

    Scenario: an invalid verdict is not a reason to promote: the step is refused on the pass it reached
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the review session writes the fixture "review-invalid-verdict.jsonl"
      When I run the step with the arguments "<folder>"
      Then the build sessions started with the models "gpt-6.2-sol"
      And the published record field "routing.passes.0.signal" is "review_invalid"
      And the published record field "outcome" is "refused"

    Scenario: an independent review that accepts passes the step on its first pass
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 8 points
      And the step folder holds a routed step.json for a ticket of 13 points, with the checks "" and the providers "anthropic openai"
      And the review session writes the fixture "review-accept-proposal.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the build sessions started with the models "gpt-6.2-sol"
      And the review sessions started with the models "claude-opus-5-5"
      And the published record field "routing.passes.0.signal" is "accepted"
      And the published record field "sessions.1.pass" is 1
      And the published record field "outcome" is "passed"

  Rule: the review of a promoted pass rules on every blocking finding of the pass before it

    Scenario: the review of pass 2 receives the findings of pass 1 with their ids and resolves them all: the step passes
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the review session 1 writes the fixture "review-request-changes.jsonl"
      And the review session 2 writes the fixture "review-prior-resolved.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the brief of review session 1 does not contain "## Findings of the previous review"
      And the brief of review session 2 contains "## Findings of the previous review"
      And the brief of review session 2 contains "Build the thing.\n\n## Findings of the previous review\n\nThe review of the previous pass"
      And the brief of review session 2 contains "- PF-1 correctness \"src/a.ts\":3 \"wrong\""
      And the brief of review session 2 contains "- PF-2 proposal \"src/a.ts\":3 \"wrong\""
      And the published record field "routing.passes.1.signal" is "accepted"
      And the published record field "outcome" is "passed"

    Scenario Outline: the review of pass 2 that does not rule exactly on the findings it received is invalid: <case>
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the review session 1 writes the fixture "review-request-changes.jsonl"
      And the review session 2 writes the fixture "<fixture>"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the retained verdict "pass-2.review.independent.verdict.json" is invalid because "<why>"
      And the published record field "routing.passes.1.signal" is "review_invalid"
      And the published record field "outcome" is "refused"

      Examples:
        | case                    | fixture                       | why                                                         |
        | one id omitted          | review-prior-omitted.jsonl    | la revue ne statue pas sur PF-2                             |
        | no status at all        | review-accept-proposal.jsonl  | la revue ne statue pas sur PF-1, PF-2                       |
        | an id it did not get    | review-prior-invented.jsonl   | la revue statue sur un constat inconnu ou répété : PF-3     |
        | an id given twice       | review-prior-repeated.jsonl   | la revue statue sur un constat inconnu ou répété : PF-1     |

    Scenario: a finding the review of pass 2 says is unresolved blocks, and on the last band the step is refused
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "" and the providers "anthropic openai"
      And the review session 1 writes the fixture "review-request-changes.jsonl"
      And the review session 2 writes the fixture "review-prior-unresolved.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the published record field "routing.passes.1.signal" is "changes_requested"
      And the published record field "outcome" is "refused"

    Scenario: a first review that rules on findings no pass gave it is invalid
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 8 points
      And the step folder holds a routed step.json for a ticket of 13 points, with the checks "" and the providers "anthropic openai"
      And the review session writes the fixture "review-prior-resolved.jsonl"
      When I run the step with the arguments "<folder>"
      Then the retained verdict "review.independent.verdict.json" is invalid because "la revue statue sur un constat inconnu ou répété : PF-1, PF-2"
      And the published record field "outcome" is "refused"

    Scenario: a pass promoted on a failed check gives its review no prior findings
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic openai"
      And the check 1 ends with the exit code 1
      And the review session writes the fixture "review-accept-proposal.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the brief of review session 1 does not contain "## Findings of the previous review"

  Rule: what a promoted pass receives, and what the Step reports, are exactly what the host observed

    Scenario: a passed check is not given to the next pass, only the one that failed
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types lint" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 2 ends with the exit code 1
      When I run the step with the arguments "<folder>"
      Then the build sessions started with the models "claude-sonnet-5-5 claude-opus-5-5"
      And the brief of build pass 2 contains "- lint: [\"npm\",\"run\",\"lint\"] exit 1"
      And the brief of build pass 2 does not contain "- types:"

    Scenario: a ladder that crosses to OpenAI reports no dollar cost, since the subscription has none
      Given a step folder
      And the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from 8 points
      And the step folder holds a routed step.json for a ticket of 5 points, with the checks "types" and the providers "anthropic openai"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 ends with the exit code 1
      And the review session writes the fixture "review-accept-proposal.jsonl"
      When I run the step with the arguments "<folder>"
      Then the build sessions started with the models "claude-sonnet-5-5 gpt-6.2-sol"
      And the step stdout field "costUsd" is null
      And the published record field "outcome" is "passed"

    Scenario: the record keeps every effort of the ladder, and the start of a ticket whose band needs a check
      Given a step folder
      And the launcher routing table builds with the efforts "low xhigh max" from 1, 3 and 8 points
      And the step folder holds a routed step.json for a ticket of 1 points, with the checks "types" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 ends with the exit code 1
      And the check 2 ends with the exit code 1
      And the check 3 ends with the exit code 1
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the published record field "routing.passes" is [{"pass":1,"band":1,"provider":"anthropic","model":"claude-haiku-5-5","effort":"low","signal":"check_failed"},{"pass":2,"band":3,"provider":"anthropic","model":"claude-sonnet-5-5","effort":"xhigh","signal":"check_failed"},{"pass":3,"band":8,"provider":"anthropic","model":"claude-opus-5-5","effort":"max","signal":"check_failed"}]

    Scenario: the record keeps the start of a small ticket without a check
      Given a step folder
      And the step folder holds a routed step.json for a ticket of 2 points, with the checks "" and the providers "anthropic"
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the published record field "routing.start" is "BAND_REQUIRES_CHECKS"
