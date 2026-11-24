Feature: the step leaves its brief and its record in the worktree
  At the end of a step that passes or is refused, the host writes steps/<name>/ in the worktree: the files it read at the
  start (brief.md, step.json, one question per scout) and record.json, written by the host alone: the fingerprint of
  the tree the step saw, the hash of each input and of each file of the launcher, the sessions, the checks, the reviews and
  the outcome. Nothing a session wrote or printed enters it. A step that is refused before any session, or whose tool
  fails, writes nothing.

  Rule: a step that passes publishes its inputs byte for byte and its record

    Scenario: the files read at the start, and a record the schema accepts, whose hashes are those of the inputs
      Given a step folder
      And the step folder holds a step.json with a build, the scouts "files=claude-haiku-5-5", the checks "types" and the reviews "quality=claude-opus-5-5"
      And the step folder holds the questions of the scouts "files"
      And the scout session writes the fixture "scout-facts-a.jsonl"
      And the build session writes the fixture "build-exact.jsonl"
      And the review session writes the fixture "review-accept-proposal.jsonl"
      And the check 1 lasts 3400 milliseconds
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the folder steps/ was prepared once, before any session
      And the step published the folder "demo" and nothing else
      And the published files are exactly "brief.md record.json scout.files.md step.json"
      And the published input files are those of the step folder, byte for byte
      And the published record is accepted by the schema
      And every input hash of the published record is the sha256 of the published file beside it
      And the published record is JSON on two-space indentation with a final line break
      And the published record, without its launcher, is:
        """
        {
          "step": "demo",
          "startedAt": "2026-11-18T09:30:00.000Z",
          "tree": { "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "tree": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "clean": true },
          "inputs": "the hashes",
          "sessions": [
            { "role": "scout", "name": "files", "model": "claude-haiku-5-5", "effort": "low", "completed": true, "exitCode": 0, "stopped": false, "durationSeconds": 4, "costUsd": 0.0625, "costByModel": { "claude-haiku-5-5": 0.0625 } },
            { "role": "build", "provider": "anthropic", "model": "claude-sonnet-5-5", "effort": "medium", "completed": true, "exitCode": 0, "stopped": false, "durationSeconds": 12, "costUsd": 0.5625, "costByModel": { "claude-haiku-4-5": 0.0625, "claude-sonnet-5-5": 0.5 } },
            { "role": "review", "name": "quality", "model": "claude-opus-5-5", "effort": "high", "completed": true, "exitCode": 0, "stopped": false, "durationSeconds": 12, "costUsd": 0.25, "costByModel": { "claude-opus-5-5": 0.25 } }
          ],
          "checks": [ { "name": "types", "passed": true, "stopped": false, "durationSeconds": 3 } ],
          "reviews": [ { "name": "quality", "verdict": "accept", "findings": 1 } ],
          "outcome": "passed"
        }
        """
      And the step stdout is the line:
        """
        {"outcome":"passed","scouts":{"files":{"model":"claude-haiku-5-5","completed":true,"exitCode":0,"verified":0,"rejected":2,"open":1,"costUsd":0.0625,"costByModel":{"claude-haiku-5-5":0.0625}}},"build":{"completed":true,"exitCode":0,"stopped":false,"answers":1,"turns":3,"durationSeconds":12,"costUsd":0.5625,"cacheReadPerAnswer":1000,"costByModel":{"claude-haiku-4-5":0.0625,"claude-sonnet-5-5":0.5}},"checks":{"types":{"exitCode":0,"stopped":false,"durationSeconds":3,"passed":true}},"reviews":{"quality":{"model":"claude-opus-5-5","verdict":"accept","exitCode":0,"blocks":false,"findings":1,"costUsd":0.25,"costByModel":{"claude-opus-5-5":0.25}}},"costUsd":0.875,"costByModel":{"claude-haiku-4-5":0.0625,"claude-haiku-5-5":0.0625,"claude-opus-5-5":0.25,"claude-sonnet-5-5":0.5},"record":"steps/demo/record.json"}
        """

    Scenario: the launcher files of a step with a build, a scout and a review: each tool file, its prompt and its profile, as read
      Given a step folder
      And the step folder holds a step.json with a build, the scouts "files=claude-haiku-5-5" and the reviews "quality=claude-opus-5-5"
      And the step folder holds the questions of the scouts "files"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json prompts/build.md prompts/review.md prompts/scout.md profiles/builder.json profiles/reviewer.json review.json scout.json"
      And the published record field "launcher" has its keys in the order "code.json profiles/builder.json profiles/reviewer.json prompts/build.md prompts/review.md prompts/scout.md review.json scout.json"
      And the published record launcher holds the hash of each launcher file as the step read it

    Scenario: a step with a build alone relies on the tool of code alone
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json profiles/builder.json prompts/build.md"
      And the published record launcher holds the hash of each launcher file as the step read it

    Scenario: a step with a review and no scout relies on the tool of review and not on the tool of scouts
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json profiles/builder.json profiles/reviewer.json prompts/build.md prompts/review.md review.json"

    Scenario: a step with a scout and no review relies on the tool of scouts and not on the tool of review
      Given a step folder
      And the step folder holds a step.json with a build and the scouts "files=claude-haiku-5-5"
      And the step folder holds the questions of the scouts "files"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json profiles/builder.json profiles/reviewer.json prompts/build.md prompts/scout.md scout.json"

    Scenario: a step with a check relies on the profile of the checks, which no tool file names
      Given a step folder
      And the step folder holds a step.json with a build, the checks "types" and the reviews "quality=claude-opus-5-5"
      When I run the step with the arguments "<folder>"
      Then the published record launcher lists exactly "code.json profiles/builder.json profiles/checker.json profiles/reviewer.json prompts/build.md prompts/review.md review.json"
      And the published record launcher holds the hash of each launcher file as the step read it

    Scenario: a tree that was not clean is recorded as it is
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the fingerprint of the worktree is a tree that is not clean
      When I run the step with the arguments "<folder>"
      Then the published record field "tree" is {"commit":"1111111111111111111111111111111111111111","tree":"2222222222222222222222222222222222222222","clean":false}

  Rule: a step that is refused publishes too, with the sessions and the checks that ran

    Scenario: a review that blocks
      Given a step folder
      And the step folder holds a step.json with a build, the checks "types" and the reviews "quality=claude-opus-5-5"
      And the build session writes the fixture "build-exact.jsonl"
      And the review session writes the fixture "review-request-changes.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step published the folder "demo" and nothing else
      And the published record is accepted by the schema
      And the published record field "outcome" is "refused"
      And the published record lists the sessions "build review.quality"
      And the published record lists the checks "types=passed"
      And the published record lists the reviews "quality=request_changes:2"

    Scenario: a review whose verdict is invalid
      Given a step folder
      And the step folder holds a step.json with a build and "a review"
      And the build session writes the fixture "build-exact.jsonl"
      And the review session writes the fixture "review-invalid-verdict.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the published record field "outcome" is "refused"
      And the published record lists the reviews "quality=invalid:0"

    Scenario: a check that fails: its review does not run
      Given a step folder
      And the step folder holds a step.json with a build, the checks "types lint" and the reviews "quality=claude-opus-5-5"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 ends with the exit code 1
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step published the folder "demo" and nothing else
      And the published record field "outcome" is "refused"
      And the published record lists the sessions "build"
      And the published record lists the checks "types=failed"
      And the published record lists the reviews ""

    Scenario: a check stopped by its limit is recorded as stopped
      Given a step folder
      And the step folder holds a step.json with a build and the checks "types"
      And the build session writes the fixture "build-exact.jsonl"
      And the check 1 is stopped by its limit
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the published record field "checks" is [{"name":"types","passed":false,"stopped":true,"durationSeconds":0}]

    Scenario: a build that did not complete: no check, no review
      Given a step folder
      And the step folder holds a step.json with a build, the checks "types" and the reviews "quality=claude-opus-5-5"
      And the build session is stopped by its limit
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step published the folder "demo" and nothing else
      And the published record field "outcome" is "refused"
      And the published record lists the sessions "build"
      And the published record field "sessions.0.completed" is false
      And the published record field "sessions.0.stopped" is true
      And the published record lists the checks ""
      And the published record lists the reviews ""

    Scenario: a scout that did not complete is recorded with what it measured
      Given a step folder
      And the step folder holds a step.json with a build and the scouts "files=claude-haiku-5-5"
      And the step folder holds the questions of the scouts "files"
      And the scout session 1 is stopped by its limit
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the published record lists the sessions "scout.files build"
      And the published record field "sessions.0.stopped" is true

  Rule: the host writes the bytes it read at the start

    Scenario: a brief changed on disk during the build session is published as it was read
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the build session writes the fixture "build-exact.jsonl"
      And the build session rewrites the file "brief.md" of the step folder with "Changed by the session.\n"
      And the build session rewrites the file "step.json" of the step folder with "{}"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the published file "brief.md" is exactly "Build the thing.\n"
      And the published record input "brief.md" is the sha256 of "Build the thing.\n"
      And the published file "step.json" contains "claude-sonnet-5-5"
      And every input hash of the published record is the sha256 of the published file beside it

  Rule: a step that cannot start publishes nothing, and no session is started

    Scenario: a name that already has a folder in steps/
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the steps folder already holds the step "demo"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: l'étape demo a déjà un dossier dans steps/"
      And the step stdout is empty
      And no session was started
      And the step published nothing
      And the fingerprint was taken 0 times
      And the folder steps/ was not prepared

    Scenario Outline: a folder name that the expression refuses: <name>
      Given a step folder named "<name>"
      And the step folder holds a step.json with a build and "no review"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: le nom de l'étape doit suivre ^[a-z][a-z0-9-]{0,31}$ : <name>"
      And the step stdout is empty
      And no session was started
      And the step published nothing
      And the fingerprint was taken 0 times

      Examples:
        | name                              |
        | Demo                              |
        | 1demo                             |
        | -demo                             |
        | de_mo                             |
        | de.mo                             |
        | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |

    Scenario Outline: a folder name at the edge of the expression is accepted: <name>
      Given a step folder named "<name>"
      And the step folder holds a step.json with a build and "no review"
      And the build session writes the fixture "build-exact.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the step published the folder "<name>" and nothing else

      Examples:
        | name                             |
        | a                                |
        | a-9                              |
        | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |

    Scenario: a launch directory that is not the root of its worktree is refused before the name of the step, any session or any write
      Given a step folder named "Demo"
      And the step folder holds a step.json with a build and "no review"
      And the step is not launched from the root of its worktree: "pas la racine"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: Error: pas la racine"
      And the step stdout is empty
      And no session was started
      And the step published nothing
      And the folder steps/ was not prepared
      And the fingerprint was taken 0 times

    Scenario: a fingerprint that throws is a failure of the tool, before any session
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the fingerprint of the worktree fails with "empreinte impossible"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: Error: empreinte impossible"
      And the step stdout is empty
      And no session was started
      And the step published nothing

    Scenario: a launcher file that is missing is a failure of the tool, before any session
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the launcher file "prompts/build.md" is missing
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: Error: missing launcher file prompts/build.md"
      And no session was started
      And the step published nothing

    Scenario: a refusal about the folder comes before the name: step.json missing
      Given a step folder named "Demo"
      And the step folder holds the file "brief.md" with the content "Build."
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: step.json introuvable dans <folder>"
      And the fingerprint was taken 0 times

    Scenario: a session that fails is a failure of the tool: nothing is published
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the build session fails with the plain error "boom"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stdout is empty
      And the step published nothing

    Scenario: a publication that fails is a failure of the tool: no summary line
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the build session writes the fixture "build-exact.jsonl"
      And the publication fails with "steps existe déjà"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step stderr is "architect-os step: Error: steps existe déjà"
      And the step stdout is empty

    Scenario: a record its own schema refuses is not published: a session whose stream gives a negative cost
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the build session writes the fixture "build-negative-cost.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 2
      And the step published nothing

  Rule: no text that a session wrote or printed enters the record

    Scenario: a model name that the expression refuses is counted under other
      Given a step folder
      And the step folder holds a step.json with a build and "no review"
      And the build session writes the fixture "build-odd-model.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 0
      And the published record is accepted by the schema
      And the published record field "sessions.0.costByModel" is {"claude-opus-5-5":0,"claude-sonnet-5-5":0.5,"other":0.46875}
      And the published record field "sessions.0.costByModel" has its keys in the order "claude-opus-5-5 claude-sonnet-5-5 other"
      And no published file contains "Evil"
      And no published file contains "evil"
      And no published file contains "../x"

    Scenario: a finding, a report and the output of a check leave no trace in the published files
      Given a step folder
      And the step folder holds a step.json with a build, the checks "types" and the reviews "quality=claude-opus-5-5"
      And the build session writes the fixture "build-odd-model.jsonl"
      And the check 1 prints "MARKER-7f3a on the output"
      And the review session writes the fixture "review-marker.jsonl"
      When I run the step with the arguments "<folder>"
      Then the step exits with 1
      And the step published the folder "demo" and nothing else
      And the published record lists the reviews "quality=request_changes:1"
      And no published file contains "MARKER-7f3a"
      And the step stdout does not contain "MARKER-7f3a"

  Rule: the real dependencies publish into the worktree

    Scenario: the real dependencies read the launcher, the clock, the fingerprint and the folder steps/ of the worktree
      Given a throwaway git worktree
      When I build the step dependencies of a process whose INIT_CWD is that worktree
      Then the step dependencies read the launcher file "code.json" as the committed file
      And the step dependencies read the launcher file "profiles/builder.json" as the committed file
      And the step dependencies give a date that is now
      And the step dependencies fingerprint the worktree
      And the step dependencies publish "demo" with the files "a.md" and "b.md" under steps/ of the worktree

    Scenario: launched from a directory below the root, the step is refused and nothing is created
      Given a throwaway git worktree
      When I build the step dependencies of a process whose INIT_CWD is the directory "packages/deep" of that worktree
      Then the step dependencies refuse the directory "packages/deep" of that worktree, naming both paths, and create nothing

    Scenario: outside a linked worktree the step has no root, no tree to fingerprint and no folder to write: the refusal of the worktree, each time
      Given a throwaway git repository that is not a linked worktree
      When I build the step dependencies of a process whose INIT_CWD is that repository
      Then the step dependencies refuse the root, the fingerprint and the folder steps/ with "SandboxError: NOT_A_WORKTREE: dépôt principal : lancer depuis un worktree lié"

    Scenario: an input is read as UTF-8 text, its byte order mark kept
      Given a throwaway git worktree
      And the file "brief.md" beside the worktree holds the bytes "ef bb bf c3 a9 74 c3 a9 0a"
      When I build the step dependencies of a process whose INIT_CWD is that worktree
      Then the step dependencies read that file as the text "\ufeffété\n"
      And the step dependencies read no file at a path that does not exist

    Scenario Outline: an input that is not valid UTF-8 is refused before any session, since what is published and hashed is its text: <bytes>
      Given a throwaway git worktree
      And the file "brief.md" beside the worktree holds the bytes "<bytes>"
      When I build the step dependencies of a process whose INIT_CWD is that worktree
      Then the step dependencies refuse to read that file with "Refusal: brief.md n'est pas de l'UTF-8 valide"

      Examples:
        | bytes       |
        | 42 ff 0a    |
        | c3 28       |
        | ed a0 80    |

    Scenario: preparing creates steps/ when it is absent; the files are then written in mode 0644
      Given a temporary worktree
      Then the real steps folder says that "demo" does not exist
      When the real steps folder is prepared
      Then the directory "steps" of the worktree holds exactly ""
      When the real steps folder publishes "demo" with the files "brief.md=Brief\n" and "record.json={}\n"
      Then the worktree holds the file "steps/demo/brief.md" with the text "Brief\n"
      And the worktree holds the file "steps/demo/record.json" with the text "{}\n"
      And the file "steps/demo/brief.md" of the worktree has the mode 0644
      And the directory "steps" of the worktree holds exactly "demo"
      And the real steps folder says that "demo" exists
      And the real steps folder says that "other" does not exist

    Scenario: a second step is published next to the first: preparing leaves a steps/ that exists as it is
      Given a temporary worktree
      And the real steps folder is prepared
      And the real steps folder publishes "demo" with the files "a.md=A"
      When the real steps folder is prepared
      And the real steps folder publishes "next" with the files "a.md=B"
      Then the directory "steps" of the worktree holds exactly "demo next"
      And the worktree holds the file "steps/next/a.md" with the text "B"

    Scenario: steps is a link to another directory: refused, nothing written there
      Given a temporary worktree
      And the worktree has "steps" as a link to a directory outside
      Then the real steps folder refuses "demo" with "steps n'est pas un dossier ordinaire du worktree" when asked if it exists
      When I try to prepare the real steps folder
      Then the publication is refused with "steps n'est pas un dossier ordinaire du worktree"
      When I try to publish "demo" with the real steps folder
      Then the publication is refused with "steps n'est pas un dossier ordinaire du worktree"
      And the directory outside the worktree is empty

    Scenario: steps is a file: refused, and the file is left as it was
      Given a temporary worktree
      And the worktree has "steps" as a file
      Then the real steps folder refuses "demo" with "steps n'est pas un dossier ordinaire du worktree" when asked if it exists
      When I try to publish "demo" with the real steps folder
      Then the publication is refused with "steps n'est pas un dossier ordinaire du worktree"
      And the worktree holds the file "steps" with the text "occupied\n"

    Scenario Outline: steps/demo is already there as <kind>: it exists, and publishing is refused without touching it
      Given a temporary worktree
      And a directory outside the worktree
      And the worktree has "steps/demo" as <kind>
      Then the real steps folder says that "demo" exists
      When I try to publish "demo" with the real steps folder
      Then the publication is refused with "steps/demo existe déjà"
      And the directory "steps" of the worktree holds exactly "demo"
      And the entry "steps/demo" of the worktree is still <kind>
      And the directory outside the worktree is empty

      Examples:
        | kind                                 |
        | a file                               |
        | a directory                          |
        | a dangling link                      |
        | a link to a directory outside        |

    Scenario: steps/demo that appears between the check and the writing is refused again at the writing
      Given a temporary worktree
      And the worktree has "steps" as a directory
      Then the real steps folder says that "demo" does not exist
      When the worktree has "steps/demo" as a directory
      And I try to publish "demo" with the real steps folder
      Then the publication is refused with "steps/demo existe déjà"

    Scenario: steps/ that is gone when the step ends is not made again: the publication is refused
      Given a temporary worktree
      When I try to publish "demo" with the real steps folder
      Then the publication is refused with "steps a disparu pendant l’étape"
      And the directory "." of the worktree holds exactly ""

  Rule: the schema of the record refuses whatever is not a hash, a name of the step file, a number or a value of a closed list

    Scenario: a historical session without a native exit code remains readable
      Given a record of a step that the schema accepts
      Then the decoded historical session still has no exit code

    Scenario Outline: refused: <field> becomes <value>
      Given a record of a step that the schema accepts
      When its field "<field>" becomes <value>
      Then the schema of the record refuses it

      Examples:
        | field                        | value                                                                 |
        | step                         | "Demo"                                                                |
        | step                         | "a/b"                                                                 |
        | startedAt                    | "yesterday"                                                           |
        | extra                        | true                                                                  |
        | tree.commit                  | "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"                             |
        | tree.commit                  | "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"                           |
        | tree.commit                  | "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"                            |
        | tree.tree                    | "main"                                                                |
        | tree.clean                   | "yes"                                                                 |
        | tree.extra                   | true                                                                  |
        | inputs.[notes.md]            | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | inputs.[xbrief.md]           | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | inputs.[brief.mdx]           | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | inputs.[scout.Files.md]      | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | inputs.[scout..md]           | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | inputs.[brief.md]            | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"     |
        | inputs.[brief.md]            | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"   |
        | inputs.[brief.md]            | "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"    |
        | launcher.[../x]              | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | launcher.[a/../b]            | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | launcher.[/etc/passwd]       | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | launcher.[Code.json]         | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | launcher.[a b]               | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"    |
        | launcher.[code.json]         | "short"                                                               |
        | sessions.0.role              | "judge"                                                               |
        | sessions.1.name              | "Correctness"                                                         |
        | sessions.0.model             | ""                                                                    |
        | sessions.0.effort            | "huge"                                                                |
        | sessions.0.completed         | "yes"                                                                 |
        | sessions.0.stopped           | 0                                                                     |
        | sessions.0.durationSeconds   | -1                                                                    |
        | sessions.0.durationSeconds   | 1.5                                                                   |
        | sessions.0.costUsd           | -0.01                                                                 |
        | sessions.0.exitCode          | -1                                                                    |
        | sessions.0.exitCode          | 0.5                                                                   |
        | sessions.0.exitCode          | null                                                                  |
        | sessions.0.exitCode          | "0"                                                                   |
        | sessions.0.costByModel       | {"Evil Model":1}                                                      |
        | sessions.0.costByModel       | {"-dash":1}                                                           |
        | sessions.0.costByModel       | {"claude sonnet":1}                                                   |
        | sessions.0.costByModel       | {"claude-sonnet-5-5":-1}                                              |
        | sessions.0.extra             | true                                                                  |
        | checks.0.name                | "Types"                                                               |
        | checks.0.passed              | "yes"                                                                 |
        | checks.0.stopped             | 1                                                                     |
        | checks.0.durationSeconds     | -1                                                                    |
        | checks.0.durationSeconds     | 0.5                                                                   |
        | checks.0.extra               | true                                                                  |
        | reviews.0.name               | "a b"                                                                 |
        | reviews.0.verdict            | "approve"                                                             |
        | reviews.0.findings           | -1                                                                    |
        | reviews.0.findings           | 0.5                                                                   |
        | reviews.0.extra              | true                                                                  |
        | outcome                      | "stopped"                                                             |

    Scenario Outline: accepted: <field> becomes <value>
      Given a record of a step that the schema accepts
      When its field "<field>" becomes <value>
      Then the schema of the record accepts it

      Examples:
        | field                      | value                                |
        | sessions.0.effort          | "low"                                |
        | sessions.0.effort          | "high"                               |
        | sessions.0.effort          | "xhigh"                              |
        | sessions.0.effort          | "max"                                |
        | sessions.0.role            | "scout"                              |
        | sessions.0.costUsd         | 0                                    |
        | sessions.0.exitCode        | 0                                    |
        | sessions.0.exitCode        | 17                                   |
        | sessions.0.durationSeconds | 0                                    |
        | sessions.0.costByModel     | {"other":0,"claude-fable-5.2":1}     |
        | reviews.0.verdict          | "request_changes"                    |
        | reviews.0.verdict          | "invalid"                            |
        | reviews.0.findings         | 3                                    |
        | outcome                    | "refused"                            |
        | tree.clean                 | false                                |
        | launcher.[profiles/checker.json] | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |
        | inputs.[scout.a-1.md]      | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |

  Scenario Outline: A subscription receipt binds the client and observed usage to its builder
    Then the recorded subscription fixture "<case>" is "<result>"

    Examples:
      | case | result |
      | completed | accepted |
      | interrupted without usage | accepted |
      | review role | refused |
      | mixed provider | refused |
      | missing client | refused |
      | missing usage | refused |
      | missing responses | refused |
      | known price | refused |
      | foreign model | refused |
      | substituted response model | refused |
      | skipped request | refused |
      | input total | refused |
      | output total | refused |
      | empty completion | refused |
      | failed completion | refused |
      | incomplete observed | accepted |
      | failed observed | accepted |
      | legacy unknown cost | refused |
      | legacy client | refused |
      | legacy responses | refused |
      | legacy usage | refused |
      | mixed terminals | refused |
      | mixed models | refused |

  Scenario: The published response list is independent of the builder collector
    Then building the Step record snapshots the response list and preserves missing evidence
