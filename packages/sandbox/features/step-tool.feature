Feature: npm run step, one step of the orchestration loop (fake sessions, a throwaway folder)
  `npm run step -- <folder>` plays the build session with the brief, then the review session, and leaves in the
  folder what a third party needs. step.ts only hands it the process; everything it does is here.

  Rule: refusals come before any session, with exit code 2 and one line on stderr

    Scenario: no folder argument
      Given a step folder
      When I run the step with the arguments ""
      Then the step exits with 2
      And the step stderr is "architect-os step: un seul dossier est attendu"
      And the step stdout is empty
      And no session was started

    Scenario: two folder arguments
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      When I run the step with the arguments "<folder> <folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: un seul dossier est attendu"
      And the step stdout is empty
      And no session was started

    Scenario: a relative path
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      When I run the step with the arguments "relative/dir"
      Then the step exits with 2
      And the step stderr is "architect-os step: le dossier doit être un chemin absolu : relative/dir"
      And the step stdout is empty
      And no session was started

    Scenario: step.json missing
      Given a step folder
      And the step folder holds the file "brief.md" with the content "Build."
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: step.json introuvable dans <folder>"
      And the step stdout is empty
      And no session was started

    Scenario: step.json not JSON
      Given a step folder
      And the step folder holds the file "step.json" with the content "{nope"
      And the step folder holds the file "brief.md" with the content "Build."
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: step.json n'est pas du JSON"
      And the step stdout is empty
      And no session was started

    Scenario: step.json refused by the schema
      Given a step folder
      And the step folder holds the file "step.json" with the content "{\"build\":{\"model\":\"m\",\"effort\":\"medium\",\"limitSeconds\":0}}"
      And the step folder holds the file "brief.md" with the content "Build."
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: step.json refusé : build.limitSeconds: Too small: expected number to be >=1"
      And the step stdout is empty
      And no session was started

    Scenario: brief.md missing
      Given a step folder
      And the step folder holds the file "step.json" with the content "{\"build\":{\"model\":\"m\",\"effort\":\"medium\",\"limitSeconds\":60}}"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: brief.md absent ou vide"
      And the step stdout is empty
      And no session was started

    Scenario: brief.md empty
      Given a step folder
      And the step folder holds the file "step.json" with the content "{\"build\":{\"model\":\"m\",\"effort\":\"medium\",\"limitSeconds\":60}}"
      And the step folder holds the file "brief.md" with the content ""
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: brief.md absent ou vide"
      And the step stdout is empty
      And no session was started

    Scenario: brief.md with only blanks
      Given a step folder
      And the step folder holds the file "step.json" with the content "{\"build\":{\"model\":\"m\",\"effort\":\"medium\",\"limitSeconds\":60}}"
      And the step folder holds the file "brief.md" with the content " "
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: brief.md absent ou vide"
      And the step stdout is empty
      And no session was started

  Rule: a build without review

    Scenario: a build that completes leaves its three files and the summary
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the build session writes the fixture "session.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the sessions started were "code.json"
      And the session 1 got the brief "Build the thing.\n" and the limit 2400
      And the session 1 got exactly the arguments "-p --verbose --output-format stream-json --model claude-sonnet-5-5 --effort medium"
      And the step file "build.stream.jsonl" is the fixture "session.jsonl"
      And the step file "build.measure.json" is:
      """
      {
        "completed": true,
        "answers": 2,
        "turns": 9,
        "durationSeconds": 35,
        "costUsd": 0.0770908,
        "inputTokens": 18,
        "outputTokens": 3214,
        "cacheReadTokens": 78473,
        "cacheWriteTokens": 14827,
        "cacheReadPerAnswer": 39237,
        "models": [
          "claude-haiku-4-5",
          "claude-sonnet-5-5"
        ],
        "permissionDenials": 2,
        "stopped": false
      }
      """
      And the step file "build.report.md" is exactly "Done: two files changed."
      And the step folder has no file "review.stream.jsonl"
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237}}
      """
      And the step stderr is empty

  Rule: a build and a review

    Scenario: a review that accepts
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the review session writes the fixture "structured.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the sessions started were "code.json review.json"
      And the session 2 got the brief "Build the thing.\n" and the limit 900
      And the session 2 got the arguments "-p --verbose --output-format stream-json --model claude-opus-5-5 --effort high --json-schema" and then the draft-07 schema of the verdict
      And the step file "review.stream.jsonl" is the fixture "structured.jsonl"
      And the step folder has no file "review.report.md"
      And the step file "review.measure.json" is:
      """
      {
        "completed": true,
        "answers": 3,
        "turns": 3,
        "durationSeconds": 12,
        "costUsd": 0.25,
        "inputTokens": 3,
        "outputTokens": 300,
        "cacheReadTokens": 1000,
        "cacheWriteTokens": 20,
        "cacheReadPerAnswer": 333,
        "models": [
          "claude-opus-5-5"
        ],
        "permissionDenials": 0,
        "stopped": false
      }
      """
      And the step file "review.verdict.json" is:
      """
      {
        "verdict": "accept",
        "findings": [],
        "not_checked": []
      }
      """
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237},"review":{"verdict":"accept","blocks":false,"findings":0,"costUsd":0.25}}
      """

    Scenario: a review that accepts with a proposal does not block
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the review session writes the fixture "review-accept-proposal.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237},"review":{"verdict":"accept","blocks":false,"findings":1,"costUsd":0.25}}
      """

    Scenario: a review that requests changes
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the review session writes the fixture "review-request-changes.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237},"review":{"verdict":"request_changes","blocks":true,"findings":2,"costUsd":0.25}}
      """
      And the step file "review.verdict.json" is:
      """
      {
        "verdict": "request_changes",
        "findings": [
          {
            "level": "correctness",
            "file": "src/a.ts",
            "line": 3,
            "quote": "x",
            "reason": "wrong"
          },
          {
            "level": "proposal",
            "file": "src/a.ts",
            "line": 3,
            "quote": "x",
            "reason": "wrong"
          }
        ],
        "not_checked": [
          "gate"
        ]
      }
      """

    Scenario: a review that accepts with a correctness finding blocks
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the review session writes the fixture "review-accept-correctness.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237},"review":{"verdict":"accept","blocks":true,"findings":1,"costUsd":0.25}}
      """

    Scenario: a review without structured output is invalid
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the review session writes the fixture "session.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step file "review.verdict.json" is:
      """
      {
        "invalid": "la session n’a donné aucune sortie structurée"
      }
      """
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237},"review":{"verdict":"invalid","blocks":true,"findings":0,"costUsd":0.0770908}}
      """

    Scenario: a review with an invalid verdict is invalid
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the review session writes the fixture "review-invalid-verdict.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step file "review.verdict.json" is:
      """
      {
        "invalid": "verdict: Invalid option: expected one of \"accept\"|\"request_changes\""
      }
      """
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":false,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237},"review":{"verdict":"invalid","blocks":true,"findings":0,"costUsd":0.25}}
      """

  Rule: a build that does not pass starts no review

    Scenario: a build that is an error
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "result-error.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the sessions started were "code.json"
      And the step folder has no file "review.stream.jsonl"
      And the step folder has no file "review.measure.json"
      And the step file "build.stream.jsonl" is the fixture "result-error.jsonl"
      And the step file "build.measure.json" is:
      """
      {
        "completed": false,
        "answers": 1,
        "turns": 4,
        "durationSeconds": 12,
        "costUsd": 0.5,
        "inputTokens": 5,
        "outputTokens": 7,
        "cacheReadTokens": 1000,
        "cacheWriteTokens": 9,
        "cacheReadPerAnswer": 1000,
        "models": [
          "claude-sonnet-5-5"
        ],
        "permissionDenials": 0,
        "stopped": false
      }
      """
      And the step stdout is the line:
      """
      {"build":{"completed":false,"stopped":false,"answers":1,"turns":4,"durationSeconds":12,"costUsd":0.5,"cacheReadPerAnswer":1000}}
      """

    Scenario: a build stopped at its limit
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session.jsonl"
      And the build session is stopped by its limit
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the sessions started were "code.json"
      And the step folder has no file "review.stream.jsonl"
      And the step folder has no file "review.measure.json"
      And the step file "build.stream.jsonl" is the fixture "session.jsonl"
      And the step file "build.measure.json" is:
      """
      {
        "completed": true,
        "answers": 2,
        "turns": 9,
        "durationSeconds": 35,
        "costUsd": 0.0770908,
        "inputTokens": 18,
        "outputTokens": 3214,
        "cacheReadTokens": 78473,
        "cacheWriteTokens": 14827,
        "cacheReadPerAnswer": 39237,
        "models": [
          "claude-haiku-4-5",
          "claude-sonnet-5-5"
        ],
        "permissionDenials": 2,
        "stopped": true
      }
      """
      And the step stdout is the line:
      """
      {"build":{"completed":true,"stopped":true,"answers":2,"turns":9,"durationSeconds":35,"costUsd":0.0770908,"cacheReadPerAnswer":39237}}
      """

    Scenario: a build whose stream has no result
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "session-killed.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the sessions started were "code.json"
      And the step folder has no file "review.stream.jsonl"
      And the step folder has no file "review.measure.json"
      And the step file "build.stream.jsonl" is the fixture "session-killed.jsonl"
      And the step file "build.measure.json" is:
      """
      {
        "completed": false,
        "answers": 2,
        "turns": 0,
        "durationSeconds": 0,
        "costUsd": 0,
        "inputTokens": 0,
        "outputTokens": 0,
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cacheReadPerAnswer": 0,
        "models": [],
        "permissionDenials": 0,
        "stopped": false
      }
      """
      And the step stdout is the line:
      """
      {"build":{"completed":false,"stopped":false,"answers":2,"turns":0,"durationSeconds":0,"costUsd":0,"cacheReadPerAnswer":0}}
      """

  Rule: a failure of the tool is reported like npm run code, with exit code 2

    Scenario: ISOLATION_UNAVAILABLE during the build
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session fails with the sandbox error "ISOLATION_UNAVAILABLE" "pas de srt"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: ISOLATION_UNAVAILABLE: pas de srt"
      And the step stdout is empty
      And the sessions started were "code.json"

  Rule: the real session and the real dependencies

    Scenario: the session runs the code tool piped, with the brief, the limit and the output relayed
      Given a step session over a fake code tool, whose limit is scheduled by hand
      When the step session runs "review.json" with the arguments "-p --x" and the brief "the brief" and the limit of 90 seconds
      Then the fake code tool got the tool file "review.json"
      And the fake code tool ran piped in the base directory with the arguments "-p --x"
      And the fake code tool read the brief "the brief" and the limit is 90000 milliseconds
      And the step session output is "one,two"
      And the step session result is the exit code 7 and stopped "false"
      And the hand-scheduled limit was for 90000 milliseconds and was cancelled 1 time

    Scenario: the session reports stopped when the limit fires
      Given a step session over a fake code tool, whose limit is scheduled by hand
      And the fake code tool fires the limit
      When the step session runs "code.json" with the arguments "-p" and the brief "b" and the limit of 5 seconds
      Then the step session output is "one,two,stopped"
      And the step session result is the exit code 7 and stopped "true"

    Scenario: without a schedule of its own, the session uses the timer, which fires
      Given a step session over a fake code tool, whose limit is the real timer, faked
      And the fake code tool fires the limit
      When the step session runs "code.json" with the arguments "-p" and the brief "b" and the limit of 5 seconds
      Then the step session output is "one,two,stopped"
      And the step session result is the exit code 7 and stopped "true"

    Scenario: the timer does not fire once cancelled
      Given a step session over a fake code tool, whose limit is the real timer, faked
      When the step session runs "code.json" with the arguments "-p" and the brief "b" and the limit of 5 seconds
      Then the step session output is "one,two"
      And the step session result is the exit code 7 and stopped "false"

    Scenario: the process dependencies
      When I build the step dependencies of a process with the arguments "node step.ts /a/b"
      Then the step dependencies read the folder arguments "/a/b" and the streams of the process
      And the step dependencies write, append and read files of a folder, and read a missing one as undefined
      And the step dependencies session is a function
      And the tool dependencies of a process for "review.json" describe the tool "reviewer" in "/target"
      And the tool dependencies of a process for "code.json" describe the tool "builder" in "/target"
