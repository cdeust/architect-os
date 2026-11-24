Feature: fresh inputs for the record of a step, the folder steps/ and the fingerprint of the tree
  Inputs that the scenarios of step-record.feature, tree-fingerprint.feature and features/descriptive/steps.feature do
  not use: names with unusual characters, inputs with unusual bytes, keys of costByModel from a stream, launcher files,
  record fields at their limits, what steps/ already holds, and trees with unusual files. Each expected result follows
  the contract named in the comment above it (docs/design/orchestration-fable-5-2.md, §14, « Étape 1, les consignes
  d'étape dans le dépôt : conception », and the comments of the sources and their ports).

  # --- the name of the step folder, and what it becomes in a path -----------------------------------------------

  # expected because: « Le nom du dossier entre dans un chemin du dépôt : même expression que les noms de sessions » (§14), and a session name is ^[a-z][a-z0-9-]*$: no non-ASCII letter, space, quote or line break
  Scenario Outline: a folder name with an unusual character is refused before any session: <name>
    Given a step folder named "<name>"
    And the step folder holds a step.json with a build and "no review"
    When I run the step with the arguments "<folder>"
    Then the step exits with 2
    And the step stderr is "architect-os step: le nom de l'étape doit suivre ^[a-z][a-z0-9-]{0,31}$ : <name>"
    And no session was started
    And the step published nothing
    And the fingerprint was taken 0 times
    And the folder steps/ was not prepared

    Examples:
      | name    |
      | démo    |
      | de mo   |
      | de\"mo  |
      | de\nmo  |

  # expected because: « même expression que les noms de sessions » (§14), ^[a-z][a-z0-9-]*$: a trailing space is outside it (a table cell would trim it, hence a scenario of its own)
  Scenario: a folder name ending with a space is refused before any session
    Given a step folder named "demo "
    And the step folder holds a step.json with a build and "no review"
    When I run the step with the arguments "<folder>"
    Then the step exits with 2
    And the step stderr is "architect-os step: le nom de l'étape doit suivre ^[a-z][a-z0-9-]{0,31}$ : demo "
    And no session was started
    And the step published nothing
    And the fingerprint was taken 0 times

  # expected because: « où `<nom>` est le nom du dossier de l'étape » and « même expression que les noms de sessions » (§14): a dash at the end, two dashes, or the word steps match ^[a-z][a-z0-9-]*$
  Scenario Outline: a folder name that matches the expression in an unusual way is published under that name: <name>
    Given a step folder named "<name>"
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "build-exact.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the step published the folder "<name>" and nothing else
    And the published record field "step" is "<name>"
    And the published record is accepted by the schema

    Examples:
      | name  |
      | demo- |
      | a--b  |
      | steps |

  # expected because: « où `<nom>` est le nom du dossier de l'étape » (§14), and node's path.basename ignores trailing directory separators: the folder /x/demo/ is named demo
  Scenario: a folder argument with a trailing slash names the same folder
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "build-exact.jsonl"
    When I run the step with the arguments "<folder>/"
    Then the step exits with 0
    And the step published the folder "demo" and nothing else
    And the published record field "step" is "demo"

  # expected because: « où `<nom>` est le nom du dossier de l'étape » (§14): the folder /x/demo/. is the folder demo, whose name is demo, not "."
  Scenario: a folder argument ending in /. names the same folder
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "build-exact.jsonl"
    When I run the step with the arguments "<folder>/."
    Then the step exits with 0
    And the step published the folder "demo" and nothing else

  # expected because: « Une étape dont le nom a déjà un dossier `steps/<nom>/` dans le worktree est refusée avant toute session » (§14): only that name is refused, and demo-old is not demo
  Scenario: a name that begins with the step name already in steps/ does not block the step
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "build-exact.jsonl"
    And the steps folder already holds the step "demo-old"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the folder steps/ was prepared once, before any session
    And the step published the folder "demo" and nothing else

  # --- a brief, a step file or a scout question with unusual bytes, and the hash recorded for it ----------------

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14), and the record holds « l'empreinte de chaque fichier d'entrée »: no line break is added
  Scenario: a brief whose last line has no line break is published and hashed without one
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "brief.md" with the content "Build the thing."
    When I run the step with the arguments "<folder>"
    Then the published file "brief.md" is exactly "Build the thing."
    And the published record input "brief.md" is the sha256 of "Build the thing."
    And the published input files are those of the step folder, byte for byte

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14): a CRLF stays a CRLF, and « l'empreinte de chaque fichier d'entrée est celle que l'enregistrement donne »
  Scenario: a brief with CRLF line ends is published with them, and its hash is the one of those bytes
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "brief.md" with the escaped content "Build the thing.\r\nThen stop.\r\n"
    When I run the step with the arguments "<folder>"
    Then the published input files are those of the step folder, byte for byte
    And every input hash of the published record is the sha256 of the published file beside it

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14): a byte order mark is three bytes of the file, and the gate hashes the bytes on disk
  Scenario: a brief that starts with a byte order mark keeps it in the published file and in its hash
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "brief.md" with the escaped content "\ufeffBuild the thing.\n"
    When I run the step with the arguments "<folder>"
    Then the published input files are those of the step folder, byte for byte
    And every input hash of the published record is the sha256 of the published file beside it

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14): non-ASCII text is published as its UTF-8 bytes and hashed as them
  Scenario: a brief in non-ASCII text is published and hashed as its UTF-8 bytes
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "brief.md" with the escaped content "Construis l’été — 日本語, ünïcödé.\n"
    When I run the step with the arguments "<folder>"
    Then the published record input "brief.md" is the sha256 of "Construis l’été — 日本語, ünïcödé.\n"
    And the published input files are those of the step folder, byte for byte

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14): a NUL is a byte of the brief like another
  Scenario: a brief holding a NUL byte is published with it
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "brief.md" with the escaped content "Build\u0000the thing.\n"
    When I run the step with the arguments "<folder>"
    Then the published input files are those of the step folder, byte for byte
    And every input hash of the published record is the sha256 of the published file beside it

  # contract silent: readStep refuses « brief.md absent ou vide » before any session; a brief that is a byte order mark alone holds no text, so I hold it empty, and a step refused before any session has nothing to publish
  Scenario: a brief that is a byte order mark alone is empty: refused, nothing published
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "brief.md" with the escaped content "\ufeff"
    When I run the step with the arguments "<folder>"
    Then the step exits with 2
    And the step stderr is "architect-os step: brief.md absent ou vide"
    And no session was started
    And the step published nothing

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14): the step file is published as read, its CRLF, its order of keys and its missing final line break included (ECMA-404: a carriage return is insignificant whitespace)
  Scenario: a step.json with CRLF line ends and its keys in an unusual order is published as read
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "step.json" with the escaped content "{\u0022parallel\u0022: 1,\r\n \u0022reviews\u0022: [],\r\n \u0022build\u0022: {\u0022limitSeconds\u0022: 60, \u0022effort\u0022: \u0022low\u0022, \u0022model\u0022: \u0022claude-sonnet-5-5\u0022}}"
    And the build session writes the fixture "build-exact.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published input files are those of the step folder, byte for byte
    And every input hash of the published record is the sha256 of the published file beside it
    And the published record field "sessions.0.effort" is "low"

  # contract silent: ECMA-404 has no byte order mark among its whitespace, and the gate reads step.json with JSON.parse; a step.json the gate would refuse is not to be published, so I hold it refused before any session
  Scenario: a step.json that starts with a byte order mark is refused before any session
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the step folder holds the file "step.json" with the escaped content "\ufeff{\u0022build\u0022:{\u0022model\u0022:\u0022claude-sonnet-5-5\u0022,\u0022effort\u0022:\u0022medium\u0022,\u0022limitSeconds\u0022:2400}}"
    When I run the step with the arguments "<folder>"
    Then the step exits with 2
    And the step stderr is "architect-os step: step.json n'est pas du JSON"
    And no session was started
    And the step published nothing

  # expected because: the inputs are « `brief.md`, `step.json`, `scout.<nom>.md` » (§14), the name being the parsed one, while step.json is « Les octets que l'outil a lus au départ »: its JSON escape stays in the published file
  Scenario: a scout name written with a JSON escape in step.json gives the question of the parsed name, and the file keeps the escape
    Given a step folder
    And the step folder holds the file "step.json":
      """
      {"build":{"model":"claude-sonnet-5-5","effort":"medium","limitSeconds":2400},"scouts":[{"name":"\u0066iles","model":"claude-haiku-5-5","effort":"low","limitSeconds":300}]}
      """
    And the step folder holds the file "brief.md" with the escaped content "Build the thing.\n"
    And the step folder holds the questions of the scouts "files"
    When I run the step with the arguments "<folder>"
    Then the published files are exactly "brief.md record.json scout.files.md step.json"
    And the published file "step.json" contains "\u0066iles"
    And the published record lists the sessions "scout.files build"
    And every input hash of the published record is the sha256 of the published file beside it

  # contract silent: ECMAScript JSON.parse keeps the last value of a repeated key, and the gate reads step.json with the same parser; the record holds « des noms pris du fichier descriptif » as parsed, and the file as read
  Scenario: a step.json with the key build twice records the last build, and is published with both
    Given a step folder
    And the step folder holds the file "step.json":
      """
      {"build":{"model":"claude-opus-5-5","effort":"high","limitSeconds":60},"build":{"model":"claude-sonnet-5-5","effort":"medium","limitSeconds":2400}}
      """
    And the step folder holds the file "brief.md" with the escaped content "Build the thing.\n"
    When I run the step with the arguments "<folder>"
    Then the published record field "sessions.0.model" is "claude-sonnet-5-5"
    And the published file "step.json" contains "claude-opus-5-5"
    And the published input files are those of the step folder, byte for byte

  # expected because: « Les octets que l'outil a lus au départ de l'étape » (§14) holds for « `scout.<nom>.md` » as for the brief
  Scenario: a scout question with CRLF and no final line break is published and hashed as read
    Given a step folder
    And the step folder holds a step.json with a build and the scouts "files=claude-haiku-5-5"
    And the step folder holds the questions of the scouts "files"
    And the step folder holds the file "scout.files.md" with the escaped content "Where is the thing?\r\nAnd why?"
    When I run the step with the arguments "<folder>"
    Then the published input files are those of the step folder, byte for byte
    And every input hash of the published record is the sha256 of the published file beside it

  # expected because: « et non ceux qui sont sur le disque à la fin » (§14), and « L'hôte écrit les octets lus au départ, jamais relus » (threat T)
  Scenario: a scout question rewritten on disk during the build is published as it was read
    Given a step folder
    And the step folder holds a step.json with a build and the scouts "files=claude-haiku-5-5"
    And the step folder holds the questions of the scouts "files"
    And the build session rewrites the file "scout.files.md" of the step folder with "Changed by the session.\n"
    When I run the step with the arguments "<folder>"
    Then the published file "scout.files.md" is exactly "Question of files.\n"
    And the published record input "scout.files.md" is the sha256 of "Question of files.\n"

  # expected because: the published files are « `brief.md`, `step.json`, `scout.<nom>.md` » and « `record.json` [...] écrit par l'hôte seul » (§14): a question the step file does not name, or a record a session wrote, is not taken
  Scenario: a question file and a record.json that the build session adds to the step folder are not published
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "build-exact.jsonl"
    And the build session rewrites the file "scout.extra.md" of the step folder with "Extra question.\n"
    And the build session rewrites the file "record.json" of the step folder with "{}"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published files are exactly "brief.md record.json step.json"
    And the published record is accepted by the schema
    And the published record field "step" is "demo"

  # --- the keys and values of costByModel coming from a stream --------------------------------------------------

  # expected because: « par session [...] son coût par modèle » (§14): a stream whose result names no model gives an empty cost by model, and the step still publishes
  Scenario: a build whose stream names no model records an empty cost by model
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "no-assistant.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published record field "sessions.0.costByModel" is {}
    And the published record is accepted by the schema

  # expected because: publicCosts: « Les clés sont triées », whatever their order in the stream, and the dollars of the stream are kept as they are
  Scenario: two models in the stream, in reverse order, with a cost of many decimals, are recorded sorted and exact
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "session.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published record field "sessions.0.costByModel" is {"claude-haiku-4-5":0.0070908,"claude-sonnet-5-5":0.07}
    And the published record field "sessions.0.costByModel" has its keys in the order "claude-haiku-4-5 claude-sonnet-5-5"

  # expected because: « puis par session son rôle, son modèle, son effort, sa durée et son coût par modèle » (§14): each session keeps its own cost; nothing is summed across sessions in the record
  Scenario: two sessions on the same model keep each its own cost by model
    Given a step folder
    And the step folder holds a step.json with a build and the reviews "quality=claude-sonnet-5-5"
    And the build session writes the fixture "build-exact.jsonl"
    And the review session writes the fixture "review-sonnet.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published record field "sessions.0.costByModel" is {"claude-haiku-4-5":0.0625,"claude-sonnet-5-5":0.5}
    And the published record field "sessions.1.costByModel" is {"claude-sonnet-5-5":0.125}

  # expected because: « À la fin d'une étape, quelle que soit son issue, l'hôte écrit [...] `steps/<nom>/` » (§14): a stream whose result the measure cannot read is a build that did not complete, recorded as such
  Scenario: a build whose result names a model without a cost does not complete, and the step publishes its refusal
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "result-model-without-cost.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 1
    And the step published the folder "demo" and nothing else
    And the published record is accepted by the schema
    And the published record field "sessions.0.completed" is false
    And the published record field "outcome" is "refused"

  # --- the launcher files --------------------------------------------------------------------------------------

  # expected because: launcherFiles reads « le fichier de chaque outil qu'elle emploie, avec le prompt et le profil qu'il nomme. Lus ici, avant toute session », and readLauncher « lève s'il manque »
  Scenario Outline: a launcher file that a step with a scout, a check and a review needs is missing: <file>
    Given a step folder
    And the step folder holds a step.json with a build, the scouts "files=claude-haiku-5-5", the checks "types" and the reviews "quality=claude-opus-5-5"
    And the step folder holds the questions of the scouts "files"
    And the launcher file "<file>" is missing
    When I run the step with the arguments "<folder>"
    Then the step exits with 2
    And the step stderr is "architect-os step: Error: missing launcher file <file>"
    And no session was started
    And the step published nothing

    Examples:
      | file                   |
      | code.json              |
      | profiles/builder.json  |
      | review.json            |
      | prompts/review.md      |
      | profiles/reviewer.json |
      | scout.json             |
      | prompts/scout.md       |
      | profiles/checker.json  |

  # expected because: launcherFiles reads only « Les fichiers du lanceur dont l'étape dépend », and « Les contrôles tournent sous le profil `checker` »: a step with a build alone does not read the others
  Scenario Outline: a launcher file that a step with a build alone does not use may be missing: <file>
    Given a step folder
    And the step folder holds a step.json with a build and "no review"
    And the build session writes the fixture "build-exact.jsonl"
    And the launcher file "<file>" is missing
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published record launcher lists exactly "code.json profiles/builder.json prompts/build.md"

    Examples:
      | file                   |
      | review.json            |
      | prompts/review.md      |
      | profiles/reviewer.json |
      | scout.json             |
      | prompts/scout.md       |
      | profiles/checker.json  |

  # expected because: the record holds « celle de chaque prompt et de chaque profil du lanceur » (§14): with a scout, a check and a review, all three tools, their prompts and the three profiles
  Scenario: a step with a scout, a check and a review relies on the whole launcher, each file hashed as read
    Given a step folder
    And the step folder holds a step.json with a build, the scouts "files=claude-haiku-5-5", the checks "types" and the reviews "quality=claude-opus-5-5"
    And the step folder holds the questions of the scouts "files"
    When I run the step with the arguments "<folder>"
    Then the published record launcher lists exactly "code.json profiles/builder.json profiles/checker.json profiles/reviewer.json prompts/build.md prompts/review.md prompts/scout.md review.json scout.json"
    And the published record launcher holds the hash of each launcher file as the step read it

  # --- the record fields at their limits, from a step ------------------------------------------------------------

  # expected because: the record holds « des noms pris du fichier descriptif » (§14), and the step file accepts names of 32 characters: a record of names the step file accepts is published
  Scenario: a scout, a check and a review named with 32 characters each are recorded
    Given a step folder
    And the step folder holds a step.json with a build, the scouts "abcdefghijklmnopqrstuvwxyz-12345=claude-haiku-5-5", the checks "abcdefghijklmnopqrstuvwxyz-12345" and the reviews "abcdefghijklmnopqrstuvwxyz-12345=claude-opus-5-5"
    And the step folder holds the questions of the scouts "abcdefghijklmnopqrstuvwxyz-12345"
    And the build session writes the fixture "build-exact.jsonl"
    And the review session writes the fixture "review-accept-proposal.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published files are exactly "brief.md record.json scout.abcdefghijklmnopqrstuvwxyz-12345.md step.json"
    And the published record is accepted by the schema
    And the published record lists the sessions "scout.abcdefghijklmnopqrstuvwxyz-12345 build review.abcdefghijklmnopqrstuvwxyz-12345"
    And the published record lists the checks "abcdefghijklmnopqrstuvwxyz-12345=passed"

  # expected because: the step file holds « au plus 8 » scouts (step-file.ts), each with its question among the inputs (§14), and the sessions start « dans l'ordre du fichier »
  Scenario: eight scouts, the most a step file holds, give eight questions and eight sessions in the order of the file
    Given a step folder
    And the step folder holds a step.json with a build and the scouts "s8=claude-haiku-5-5 s1=claude-haiku-5-5 s2=claude-haiku-5-5 s3=claude-haiku-5-5 s4=claude-haiku-5-5 s5=claude-haiku-5-5 s6=claude-haiku-5-5 s7=claude-haiku-5-5"
    And the step folder holds the questions of the scouts "s8 s1 s2 s3 s4 s5 s6 s7"
    When I run the step with the arguments "<folder>"
    Then the published files are exactly "brief.md record.json scout.s1.md scout.s2.md scout.s3.md scout.s4.md scout.s5.md scout.s6.md scout.s7.md scout.s8.md step.json"
    And the published record lists the sessions "scout.s8 scout.s1 scout.s2 scout.s3 scout.s4 scout.s5 scout.s6 scout.s7 build"
    And every input hash of the published record is the sha256 of the published file beside it
    And the published record is accepted by the schema

  # expected because: « Un nom d'éclaireur peut être celui d'une revue » (step-file.ts): one question file, and two sessions of different roles under that name
  Scenario: a scout and a review with the same name give one question and two sessions
    Given a step folder
    And the step folder holds a step.json with a build, the scouts "files=claude-haiku-5-5" and the reviews "files=claude-opus-5-5"
    And the step folder holds the questions of the scouts "files"
    And the build session writes the fixture "build-exact.jsonl"
    And the review session writes the fixture "review-accept-proposal.jsonl"
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published files are exactly "brief.md record.json scout.files.md step.json"
    And the published record lists the sessions "scout.files build review.files"
    And the published record lists the reviews "files=accept:1"

  # expected because: playCheck gives « sa durée mesurée en secondes entières »: one millisecond is 0 seconds, and the largest limit of a check, 7200 seconds, is 7200
  Scenario: a check of one millisecond and a check of 7200 seconds are recorded in whole seconds
    Given a step folder
    And the step folder holds a step.json with a build and the checks "types lint"
    And the build session writes the fixture "build-exact.jsonl"
    And the check 1 lasts 1 milliseconds
    And the check 2 lasts 7200000 milliseconds
    When I run the step with the arguments "<folder>"
    Then the step exits with 0
    And the published record field "checks" is [{"name":"types","passed":true,"stopped":false,"durationSeconds":0},{"name":"lint","passed":true,"stopped":false,"durationSeconds":7200}]

  # --- the record fields at their limits, in the schema --------------------------------------------------------

  # expected because: the record holds « des noms pris du fichier descriptif, des valeurs de listes fermées (verdict, issue), des empreintes » (§14), the step name under « même expression que les noms de sessions », a model name only « s'il passe l'expression des noms de modèles », and « l'heure de départ »: an empty or 33-character name, a line break, a NUL, a non-ASCII letter, a date that does not exist or has no time, an empty hash or name, a key that starts with a dot or holds a non-ASCII letter, a cost that is not a number, a value outside its closed list, are refused
  Scenario Outline: refused at its limit: <field> becomes <value>
    Given a record of a step that the schema accepts
    When its field "<field>" becomes <value>
    Then the schema of the record refuses it

    Examples:
      | field                                          | value                                                              |
      | step                                           | ""                                                                 |
      | step                                           | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"                                |
      | step                                           | "demo\\n"                                                          |
      | step                                           | "demo\u0000"                                                       |
      | step                                           | "démo"                                                             |
      | startedAt                                      | "2026-02-30T09:00:00.000Z"                                         |
      | startedAt                                      | "2026-11-18"                                                       |
      | tree.commit                                    | ""                                                                 |
      | inputs.[step.json]                             | ""                                                                 |
      | inputs.[scout.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md] | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |
      | launcher.[.hidden]                             | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |
      | launcher.[prompts/é.md]                        | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |
      | sessions.0.costByModel                         | {"":1}                                                             |
      | sessions.0.costByModel                         | {"claude-sonnet-5-5\\n":1}                                         |
      | sessions.0.costByModel                         | {"__proto__":1}                                                    |
      | sessions.0.costByModel                         | {"clàude":1}                                                       |
      | sessions.0.costByModel                         | {"claude-sonnet-5-5":null}                                         |
      | sessions.0.effort                              | "Medium"                                                           |
      | sessions.1.name                                | ""                                                                 |
      | checks.0.name                                  | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"                                |
      | reviews.0.verdict                              | ""                                                                 |
      | outcome                                        | "passed "                                                          |

  # expected because: a name of the step file of 32 characters, or of one, or ending in a dash, follows « même expression que les noms de sessions » (§14); toISOString aside, an ISO time without milliseconds is still « l'heure de départ »; a step with no check and no review has empty lists; a cost and a duration are « des nombres », zero or more
  Scenario Outline: accepted at its limit: <field> becomes <value>
    Given a record of a step that the schema accepts
    When its field "<field>" becomes <value>
    Then the schema of the record accepts it

    Examples:
      | field                                         | value                                                              |
      | step                                          | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"                                 |
      | step                                          | "a"                                                                |
      | step                                          | "a-"                                                               |
      | startedAt                                     | "2026-11-18T09:00:00Z"                                             |
      | inputs.[scout.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md] | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |
      | inputs.[scout.a.md]                           | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" |
      | checks.0.name                                 | "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"                                 |
      | checks                                        | []                                                                 |
      | reviews                                       | []                                                                 |
      | sessions.0.costUsd                            | 1e308                                                              |
      | sessions.0.durationSeconds                    | 9007199254740991                                                   |

  # --- what the folder steps/ may already hold ------------------------------------------------------------------

  # expected because: exists is « Vrai pour tout ce qui occupe `steps/<nom>` », that name only, and publish « Crée `steps/<nom>/` [...] sans jamais en remplacer un »: an entry of another name stays as it is
  Scenario Outline: steps/ already holds <entry> as <kind>: demo is published beside it, which stays as it was
    Given a temporary worktree
    And a directory outside the worktree
    And the worktree has "<entry>" as <kind>
    Then the real steps folder says that "demo" does not exist
    When the real steps folder is prepared
    And the real steps folder publishes "demo" with the files "brief.md=Brief\n"
    Then the directory "steps" of the worktree holds exactly "<listing>"
    And the entry "<entry>" of the worktree is still <kind>
    And the worktree holds the file "steps/demo/brief.md" with the text "Brief\n"

    Examples:
      | entry           | kind            | listing         |
      | steps/other     | a directory     | demo other      |
      | steps/demo2     | a dangling link | demo demo2      |
      | steps/.DS_Store | a file          | .DS_Store demo  |
      | steps/demo.md   | a file          | demo demo.md    |

  # expected because: exists is « Vrai pour tout ce qui occupe `steps/<nom>` », and « un enregistrement ne se réécrit pas » (§14): a folder that already holds a file is refused, its file left as it was
  Scenario: steps/demo that already holds a brief: it exists, and publishing is refused without touching it
    Given a temporary worktree
    And the worktree has "steps/demo/brief.md" as a file
    Then the real steps folder says that "demo" exists
    When I try to publish "demo" with the real steps folder
    Then the publication is refused with "steps/demo existe déjà"
    And the directory "steps/demo" of the worktree holds exactly "brief.md"
    And the worktree holds the file "steps/demo/brief.md" with the text "occupied\n"

  # expected because: « l'hôte refuse d'écrire si `steps` ou `steps/<nom>` existe et n'est pas un dossier ordinaire du worktree » (threat T): a dangling link named steps is not one, and preparing does not create its target
  Scenario: steps is a dangling link: refused when asked, when preparing and when publishing, and nothing is created
    Given a temporary worktree
    And the worktree has "steps" as a dangling link
    Then the real steps folder refuses "demo" with "steps n'est pas un dossier ordinaire du worktree" when asked if it exists
    When I try to prepare the real steps folder
    Then the publication is refused with "steps n'est pas un dossier ordinaire du worktree"
    When I try to publish "demo" with the real steps folder
    Then the publication is refused with "steps n'est pas un dossier ordinaire du worktree"
    And the entry "steps" of the worktree is still a dangling link
    And the directory "." of the worktree holds exactly "steps"

  # expected because: « un enregistrement ne se réécrit pas, une nouvelle passe prend un nouveau nom » (§14), and publish never replaces a file: the same call twice is refused the second time
  Scenario: the same name published twice: the second publication is refused and the first stays as it was
    Given a temporary worktree
    And the real steps folder is prepared
    And the real steps folder publishes "demo" with the files "brief.md=First\n"
    When I try to publish "demo" with the real steps folder
    Then the publication is refused with "steps/demo existe déjà"
    And the directory "steps/demo" of the worktree holds exactly "brief.md"
    And the worktree holds the file "steps/demo/brief.md" with the text "First\n"

  # expected because: publish « y écrit chaque fichier (nom de fichier -> texte) », in mode 0644: an empty text is an empty file, and a non-ASCII text, or one holding an equals sign, is written as it is
  Scenario: an empty file and a non-ASCII text are published as they are, in mode 0644
    Given a temporary worktree
    When the real steps folder is prepared
    And the real steps folder publishes "demo" with the files "brief.md=" and "step.json=k=v, été — 日本\n"
    Then the worktree holds the file "steps/demo/brief.md" with the text ""
    And the worktree holds the file "steps/demo/step.json" with the text "k=v, été — 日本\n"
    And the file "steps/demo/brief.md" of the worktree has the mode 0644
    And the file "steps/demo/step.json" of the worktree has the mode 0644

  # --- the fingerprint of a tree with unusual files ----------------------------------------------------------------

  # expected because: « l'empreinte git de l'arbre de travail entier (fichiers suivis et non suivis, ceux que `.gitignore` écarte exceptés) » and « `clean`, vrai quand cette empreinte est celle de l'arbre du commit » (§14): an untracked file of any name, in any directory, makes the tree differ
  Scenario Outline: an untracked file named <file> makes the tree not clean, and is in the tree
    Given a throwaway repository with one commit
    And the file "<file>" of the repository holds "x"
    When I take the fingerprint of the repository
    Then the fingerprint commit is the HEAD of the repository
    And the fingerprint is not clean
    And the fingerprint tree is the tree that committing everything would give

    Examples:
      | file              |
      | a b.txt           |
      | q\"uote.txt       |
      | été.txt           |
      | -n.txt            |
      | new\nline.txt     |
      | back\\slash.txt   |
      | deep/er/est.txt   |
      | .DS_Store         |

  # expected because: « fichiers suivis et non suivis » (§14): an empty untracked file is a file of the tree; the same tree gives the same fingerprint twice, and one more empty file gives another tree on the same commit
  Scenario: an empty untracked file in a directory with a space, fingerprinted twice, then a second empty file
    Given a throwaway repository with one commit
    And the file "new dir/empty.txt" of the repository holds ""
    When I take the fingerprint of the repository
    And I take the fingerprint of the repository again
    Then the two fingerprints are the same
    When the file "new dir/also empty.txt" of the repository holds ""
    And I take the fingerprint of the repository again
    Then the two fingerprints have two different trees

  # expected because: « `clean`, vrai quand cette empreinte est celle de l'arbre du commit » (§14): git hashes the content, so a file written again with its committed content leaves the tree of the commit
  Scenario: a tracked file written again with the same content leaves the tree clean
    Given a throwaway repository with one commit
    And the file "a.txt" of the repository holds "first\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean
    And the fingerprint tree is the tree of HEAD

  # expected because: « ceux que `.gitignore` écarte exceptés » (§14), and gitignore(5): a pattern without a slash matches at any level below the .gitignore file
  Scenario: an ignored file in a subdirectory leaves the tree clean
    Given a throwaway repository with one commit
    And the file "logs/deep/run.log" of the repository holds "noise\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean
    And the fingerprint tree is the tree of HEAD

  # expected because: « ceux que `.gitignore` écarte exceptés » (§14), and gitignore(5): a .gitignore in a subdirectory applies to it, and * matches the .gitignore itself
  Scenario: a subdirectory whose own .gitignore ignores everything leaves the tree clean
    Given a throwaway repository with one commit
    And the file "sub/.gitignore" of the repository holds "*\n"
    And the file "sub/x.txt" of the repository holds "x\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean
    And the fingerprint tree is the tree of HEAD

  # expected because: « ceux que `.gitignore` écarte exceptés » (§14), and gitignore(5) reads the patterns of $GIT_DIR/info/exclude with those of .gitignore: an untracked file it names is not in the tree
  Scenario: an untracked file named in .git/info/exclude leaves the tree clean
    Given a throwaway repository with one commit
    And the file ".git/info/exclude" of the repository holds "local.txt\n"
    And the file "local.txt" of the repository holds "local\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean
    And the fingerprint tree is the tree of HEAD

  # expected because: « `clean`, vrai quand cette empreinte est celle de l'arbre du commit » (§14), and gitignore(5): « Files already tracked by Git are not affected »: a tracked file, unchanged, that an exclude pattern names leaves the tree of the commit
  Scenario: a tracked file named in .git/info/exclude, unchanged, leaves the tree clean
    Given a throwaway repository with one commit
    And the file ".git/info/exclude" of the repository holds "a.txt\n"
    When I take the fingerprint of the repository
    Then the fingerprint is clean
    And the fingerprint tree is the tree of HEAD

  # expected because: « fichiers suivis et non suivis » (§14), and gitignore(5): « Files already tracked by Git are not affected »: a tracked file that an exclude pattern names still counts when it changes
  Scenario: a tracked file named in .git/info/exclude still makes the tree not clean when it changes
    Given a throwaway repository with one commit
    And the file ".git/info/exclude" of the repository holds "a.txt\n"
    And the file "a.txt" of the repository holds "changed\n"
    When I take the fingerprint of the repository
    Then the fingerprint is not clean
    And the fingerprint tree is the tree that committing everything would give
