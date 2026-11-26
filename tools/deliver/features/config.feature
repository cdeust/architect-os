Feature: The descriptive file tools/deliver/deliver.json (its schema, the committed copy, and every broken copy)

  Rule: the committed file loads

    Scenario: the file committed in this repository is accepted by the schema
      When the committed deliver config is loaded
      Then the deliver config is accepted
      And the accepted deliver config asks for a pull request to "main" from a branch under "deliver/", titled "Deliver the step ${name}", and requires the jobs "gate-linux, gate-macos"
      And the committed deliver config names the section of its design
      And the committed deliver config says what its environment key is
      And the committed deliver config gives the host variables of git and of the forge client

    Scenario: the base form of these scenarios is accepted
      Given a deliver config of the base form
      When the deliver config is parsed
      Then the deliver config is accepted

  Rule: an optional dependency declaration binds a required aggregate to unique leaf jobs

    Scenario Outline: conflicting or incomplete declarations are refused
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "jobDependencies"

      Examples:
        | value                                                               |
        | {"unknown":{"admissionStep":"Check","producers":["a"]}}             |
        | {"gate-linux":{"admissionStep":"Check","producers":["gate-linux"]}} |
        | {"gate-linux":{"admissionStep":"Check","producers":["a","a"]}}      |
        | {"gate-linux":{"admissionStep":"Check","producers":[]}}             |
        | {"gate-linux":{"admissionStep":"","producers":["a"]}}               |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"","suffixes":["x"]}}}          |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":[]}}}           |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":["x","x"]}}}    |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":["a","b","c","d","e"]}}} |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":[""]}}}         |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-"}}}                         |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"suffixes":["x"]}}}                      |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":["x"],"extra":1}}} |
        | {"gate-linux":{"admissionStep":"Check","producers":["p-a"],"plannedProducers":{"prefix":"p-","suffixes":["x"]}}}      |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"gate-","suffixes":["x"]}}}     |

    Scenario Outline: a dependency conflict identifies its specific cause
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "<reason>"

      Examples:
        | value | reason |
        | {"gate-linux":{"admissionStep":"Check","producers":["a","a"]}} | the producers are all different |
        | {"gate-linux":{"admissionStep":"Check","producers":["a","gate-macos"]},"gate-macos":{"admissionStep":"Check","producers":["b"]}} | an aggregate must be required and its producers must be leaf jobs |
        | {"gate-linux":{"admissionStep":"Check","producers":["p-a"],"plannedProducers":{"prefix":"p-","suffixes":["x"]}}} | planned family prefixes must be disjoint from other families and fixed jobs |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"gate-m","suffixes":["x"]}}} | planned family prefixes must be disjoint from other families and fixed jobs |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":["x","x"]}}} | the suffixes are all different |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"lane-","suffixes":["x"]}},"gate-macos":{"admissionStep":"Check","producers":["lane-preflight"]}} | planned family prefixes must be disjoint from other families and fixed jobs |
        | {"gate-macos":{"admissionStep":"Check","producers":["lane-preflight"]},"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"lane-","suffixes":["x"]}}} | planned family prefixes must be disjoint from other families and fixed jobs |

    Scenario Outline: two planned namespaces may share letters but may never own the same job
      Given a deliver config of the base form
      And its Linux and macOS families use "<linux>" and "<macos>" in "<order>" order with a shared preflight
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "planned family prefixes must be disjoint from other families and fixed jobs"

      Examples:
        | linux      | macos      | order       |
        | lane-      | lane-fast- | Linux first |
        | lane-      | lane-fast- | macOS first |
        | lane-fast- | lane-      | Linux first |
        | lane-fast- | lane-      | macOS first |
        | lane-      | lane-      | Linux first |
        | lane-      | lane-      | macOS first |
        | matrix-    | matrix-12  | Linux first |
        | matrix-12  | matrix-    | macOS first |
        | preflight  | mac-       | Linux first |

    Scenario: two families cannot claim the same fully formed lane name in different aggregates
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '{"gate-linux":{"admissionStep":"Check","producers":["preflight"],"plannedProducers":{"prefix":"lane-","suffixes":[":m"]}},"gate-macos":{"admissionStep":"Check","producers":["preflight"],"plannedProducers":{"prefix":"lane-","suffixes":[":m"]}}}'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "planned family prefixes must be disjoint from other families and fixed jobs"

    Scenario: overlapping families separated by an unrelated aggregate still conflict
      Given a deliver config of the base form
      And the deliver config field "requiredJobs" is set to '["gate-linux","docs","gate-macos"]'
      And the deliver config field "jobDependencies" is set to '{"gate-linux":{"admissionStep":"Check","producers":["preflight"],"plannedProducers":{"prefix":"lane-","suffixes":[":m"]}},"docs":{"admissionStep":"Check","producers":["spelling"],"plannedProducers":{"prefix":"spell-","suffixes":[":s"]}},"gate-macos":{"admissionStep":"Check","producers":["preflight"],"plannedProducers":{"prefix":"lane-fast-","suffixes":[":r"]}}}'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "planned family prefixes must be disjoint from other families and fixed jobs"

    Scenario Outline: disjoint families and explicit shared dependencies keep their original outcomes
      Given a deliver config of the base form
      And its Linux and macOS families use "lane-linux-" and "lane-mac-" in "<order>" order with a shared preflight
      When the deliver config is parsed
      Then the deliver config is accepted
      And the accepted deliver config judges the names "gate-linux, gate-macos, preflight, lane-linux-1:m, lane-mac-1:r, custom, lane-other-1:r" with "<failed>" failing as "<state>"

      Examples:
        | order       | failed       | state  |
        | Linux first | custom       | green  |
        | macOS first | lane-other-1:r | green  |
        | Linux first | preflight    | failed |
        | macOS first | lane-mac-1:r | failed |

    Scenario: fixed-only aggregates can share a declared producer
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '{"gate-linux":{"admissionStep":"Check","producers":["preflight"]},"gate-macos":{"admissionStep":"Check","producers":["preflight","local-mac"]}}'
      When the deliver config is parsed
      Then the deliver config is accepted
      And the accepted deliver config judges the names "gate-linux, gate-macos, preflight, local-mac, custom" with "custom" failing as "green"
      And the accepted deliver config judges the names "gate-linux, gate-macos, preflight, local-mac, custom" with "preflight" failing as "failed"

    Scenario: a required leaf job can also be an explicitly named upstream
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '{"gate-linux":{"admissionStep":"Check","producers":["gate-macos"],"plannedProducers":{"prefix":"lane-","suffixes":[":m"]}}}'
      When the deliver config is parsed
      Then the deliver config is accepted
      And the accepted deliver config judges the names "gate-linux, gate-macos, lane-1:m, custom" with "custom" failing as "green"
      And the accepted deliver config judges the names "gate-linux, gate-macos, lane-1:m, custom" with "gate-macos" failing as "failed"

    Scenario Outline: numeric lane text must still produce one distinct full name per slot in the actual run
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '{"gate-linux":{"admissionStep":"Check","producers":["preflight"],"plannedProducers":{"prefix":"custom2-","suffixes":<suffixes>}}}'
      When the deliver config is parsed
      Then the deliver config is accepted
      And the accepted config judges <lanes> numbered lanes with "<observations>" as "<state>"

      Examples:
        | suffixes     | lanes | observations | state  |
        | ["x","1x"]   | 10    | all jobs     | green  |
        | ["x","1x"]   | 11    | all jobs     | failed |
        | ["1x","x"]   | 11    | all jobs     | failed |
        | ["x","1x"]   | 11    | unique names | failed |
        | ["x","-1x"]  | 11    | all jobs     | green  |

    Scenario: the committed Linux and macOS checks ignore an unrelated job but reserve the complete Linux lane prefix
      When the committed deliver config is loaded
      Then the deliver config is accepted
      And the accepted deliver config judges the names "gate-linux, gate-macos, gate-linux-cucumber-1, gate-linux-cucumber-2, gate-linux-plan, gate-linux-lane-1 / mutation, gate-linux-lane-1 / replay, custom" with "custom" failing as "green"
      And the accepted deliver config judges the names "gate-linux, gate-macos, gate-linux-cucumber-1, gate-linux-cucumber-2, gate-linux-plan, gate-linux-lane-1 / mutation, gate-linux-lane-1 / replay, gate-linux-lane-custom, custom" with "custom" failing as "failed"

    Scenario Outline: invalid groups under numeric job names produce ordinary configuration errors
      Given a deliver config of the base form
      And the deliver config field "requiredJobs" is set to '["0","gate-macos"]'
      And the deliver config field "jobDependencies" is set to '<groups>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "<reason>"

      Examples:
        | groups                                                                                             | reason                         |
        | {"0":{"producers":["job","job"],"admissionStep":"Check"}}                                          | the producers are all different |
        | {"0":{"producers":["job"],"plannedProducers":{"prefix":"p-","suffixes":["x","x"]},"admissionStep":"Check"}} | the suffixes are all different  |

    Scenario Outline: dependency records round-trip every declared job label as data
      Given a deliver config of the base form
      And the deliver config field "requiredJobs" is set to '["<label>","gate-macos"]'
      And the deliver config field "jobDependencies" is set to '{"<label>":{"producers":["preflight"],"admissionStep":"Check"}}'
      When the deliver config is parsed
      Then the deliver config is accepted
      And the parsed dependency declarations equal every entry of the input

      Examples:
        | label        |
        | custom build |
        | 12           |
        | constructor  |
        | __proto__    |

    Scenario Outline: the dependency record must be a JSON object
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "jobDependencies"

      Examples:
        | value   |
        | null    |
        | []      |
        | "build" |

    Scenario: the committed aggregate binds the Linux producers and the family of its planned lanes to its admission step
      When the committed deliver config is loaded
      Then the committed Linux gate requires its two cucumber shards, its plan and the lanes the run planned at "Require all producers"

    Scenario Outline: a planned family at the edge of its rule is accepted
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is accepted

      Examples:
        | value |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":["x"]}}} |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"p-","suffixes":["a","b","c","d"]}}} |
        | {"gate-linux":{"admissionStep":"Check","producers":["a-p-"],"plannedProducers":{"prefix":"p-","suffixes":["x"]}}} |
        | {"gate-linux":{"admissionStep":"Check","producers":["a"],"plannedProducers":{"prefix":"lane-","suffixes":["x"]}},"gate-macos":{"admissionStep":"Check","producers":["pre-lane-check"]}} |

  Rule: a copy at the edge of a rule is accepted

    Scenario Outline: a value at the edge
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is accepted

      Examples:
        | field          | value                                                  |
        | destination    | "a"                                                    |
        | destination    | "release/main"                                         |
        | workPrefix     | "w-"                                                   |
        | workPrefix     | "feat/"                                                |
        | pullRequestTitle | "${name}"                                            |
        | pullRequestTitle | "${name}: a title of sixty-four characters exactly, no more, and " |
        | remote         | "a"                                                    |
        | remote         | "a.b_c/d-e"                                            |
        | trialPrefix    | "sentinel/"                                            |
        | trialPrefix    | "t-"                                                   |
        | repository     | "a.b_c-d/e.f_g-h"                                      |
        | repository     | "a../.b"                                               |
        | repository     | ".../..."                                              |
        | trialPrefix    | "feat/gate-1a-"                                        |
        | trialPrefix    | "gate-"                                               |
        | requiredJobs   | ["a"]                                                  |
        | requiredJobs   | ["a","b","c","d","e","f","g","h"]                      |
        | appendOnly     | []                                                     |
        | appendOnly     | ["a","b","c","d","e","f","g","h"]                      |
        | gateCommand    | ["a"]                                                  |
        | gateCommand    | ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p"] |
        | gateLog        | "reports/a"                                                    |
        | log            | "${state}/a"                                            |
        | log            | "${state}/a.b/c"                                        |
        | ciAttempts     | 1                                                      |
        | ciAttempts     | 10                                                     |
        | pollSeconds    | 1                                                      |
        | pollSeconds    | 300                                                    |
        | ciPolls        | 1                                                      |
        | ciPolls        | 600                                                    |
        | workflow       | "Gate CI (linux)"                                      |
        | environment    | ["PATH"]                                               |
        | environment    | ["GITHUB_TOKEN","SSH_AUTH_SOCK","XDG_CONFIG_HOME","TMPDIR"] |
        | environment    | ["PATH","HOME","LANG","LC_ALL","LC_CTYPE","TMPDIR","SSH_AUTH_SOCK","XDG_CONFIG_HOME","GH_TOKEN","GITHUB_TOKEN"] |

    Scenario Outline: a label of 64 characters
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to a string of 64 characters
      When the deliver config is parsed
      Then the deliver config is accepted

      Examples:
        | field    |
        | workflow |

  Rule: a broken copy is refused, and the reason names the field

    Scenario: a key that is unknown
      Given a deliver config of the base form
      And the deliver config field "extra" is set to '1'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "Unrecognized key"

    Scenario Outline: a key that is missing
      Given a deliver config of the base form
      And the deliver config field "<field>" is removed
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.<field>"

      Examples:
        | field          |
        | description    |
        | remote         |
        | repository     |
        | destination    |
        | workPrefix     |
        | pullRequestTitle |
        | trialPrefix    |
        | workflow       |
        | requiredJobs   |
        | environment    |
        | appendOnly     |
        | gateCommand    |
        | gateLog        |
        | log            |
        | ciAttempts     |
        | pollSeconds    |
        | ciPolls        |

    Scenario Outline: a value that breaks a rule
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "<reason>"

      Examples:
        | field          | value                          | reason                                             |
        | description    | ""                             | $.description                                      |
        | remote         | ""                             | $.remote                                           |
        | remote         | "-origin"                      | $.remote                                           |
        | remote         | "_origin"                      | $.remote                                           |
        | remote         | "or..gin"                      | $.remote a name holds no ..                        |
        | remote         | "ori gin"                      | $.remote                                           |
        | remote         | "origin\\n"                     | $.remote                                           |
        | remote         | "--upload-pack=x"              | $.remote                                           |
        | remote         | 1                              | $.remote                                           |
        | destination    | ""                             | $.destination                                      |
        | destination    | "-main"                        | $.destination                                      |
        | destination    | "ma..in"                       | $.destination a name holds no ..                   |
        | destination    | "ma in"                        | $.destination                                      |
        | destination    | ["main"]                       | $.destination                                      |
        | workPrefix     | "deliver"                      | $.workPrefix a prefix ends with - or /             |
        | workPrefix     | ""                             | $.workPrefix                                       |
        | workPrefix     | "-deliver/"                    | $.workPrefix                                       |
        | workPrefix     | "de..liver/"                   | $.workPrefix a name holds no ..                    |
        | pullRequestTitle | "Deliver the step"           | $.pullRequestTitle the title holds ${name} once    |
        | pullRequestTitle | "${name} and ${name}"        | $.pullRequestTitle the title holds ${name} once    |
        | pullRequestTitle | "@owner ${name}"             | $.pullRequestTitle the title holds no @, # nor backtick |
        | pullRequestTitle | "${name} #1"                 | $.pullRequestTitle the title holds no @, # nor backtick |
        | pullRequestTitle | "`${name}`"                  | $.pullRequestTitle the title holds no @, # nor backtick |
        | pullRequestTitle | ""                           | $.pullRequestTitle                                 |
        | pullRequestTitle | 1                            | $.pullRequestTitle                                 |
        | pullRequestTitle | "${name}: a title of sixty-five characters exactly, no more, and n" | $.pullRequestTitle |
        | trialPrefix    | "sentinel/gate-1a"             | $.trialPrefix a prefix ends with - or /            |
        | trialPrefix    | "-sentinel/"                   | $.trialPrefix                                      |
        | trialPrefix    | "sen..tinel/"                  | $.trialPrefix a name holds no ..                   |
        | trialPrefix    | "sen tinel-"                   | $.trialPrefix                                      |
        | trialPrefix    | ""                             | $.trialPrefix                                      |
        | repository     | "cdeust"                       | $.repository                                       |
        | repository     | "a/b/c"                        | $.repository                                       |
        | repository     | "/b"                           | $.repository                                       |
        | repository     | "a/"                           | $.repository                                       |
        | repository     | "a b/c"                        | $.repository                                       |
        | repository     | "a/b c"                        | $.repository                                       |
        | repository     | "a/b\\n"                        | $.repository                                       |
        | repository     | "./b"                          | $.repository a segment of the repository is neither . nor .. |
        | repository     | "../b"                         | $.repository a segment of the repository is neither . nor .. |
        | repository     | "a/."                          | $.repository a segment of the repository is neither . nor .. |
        | repository     | "a/.."                         | $.repository a segment of the repository is neither . nor .. |
        | destination    | "main\\n"                       | $.destination                                      |
        | pullRequestTitle | "${name}\\n"                   | $.pullRequestTitle                                 |
        | trialPrefix    | "sentinel/\\n"                 | $.trialPrefix                                      |
        | trialPrefix    | "deliver/"                     | $.workPrefix a work branch is never a trial branch |
        | trialPrefix    | "deliver/x-"                   | $.workPrefix a work branch is never a trial branch |
        | workPrefix     | "sentinel/"                    | $.workPrefix a work branch is never a trial branch |
        | workPrefix     | "sentinel/gate-1a-"            | $.workPrefix a work branch is never a trial branch |
        | workPrefix     | "sentinel/gate-1a-work/"       | $.workPrefix a work branch is never a trial branch |
        | workPrefix     | "de-liver"                     | $.workPrefix a prefix ends with - or /             |
        | destination    | "sentinel/gate-1a-main"        | $.destination the destination is never a trial branch nor a work branch |
        | destination    | "deliver/main"                 | $.destination the destination is never a trial branch nor a work branch |
        | workflow       | ""                             | $.workflow                                         |
        | workflow       | "ga\u0001te"                   | $.workflow a label is 1 to 64 characters           |
        | workflow       | "ga\u007fte"                   | $.workflow a label is 1 to 64 characters           |
        | workflow       | "gate\\n"                       | $.workflow a label is 1 to 64 characters           |
        | workflow       | 1                              | $.workflow                                         |
        | requiredJobs   | []                             | $.requiredJobs                                     |
        | requiredJobs   | ["a","b","c","d","e","f","g","h","i"] | $.requiredJobs                              |
        | requiredJobs   | ["a","a"]                      | $.requiredJobs the jobs are all different          |
        | requiredJobs   | [""]                           | $.requiredJobs.0                                   |
        | requiredJobs   | ["a\u0000b"]                   | $.requiredJobs.0 a label is 1 to 64 characters     |
        | appendOnly     | ["a","b","c","d","e","f","g","h","i"] | $.appendOnly                                |
        | appendOnly     | ["/etc/passwd"]                | $.appendOnly.0 a repository path is relative       |
        | appendOnly     | ["a/../b"]                     | $.appendOnly.0 a repository path is relative       |
        | appendOnly     | [".."]                         | $.appendOnly.0 a repository path is relative       |
        | appendOnly     | ["a\\\\b"]                     | $.appendOnly.0 a repository path is relative       |
        | appendOnly     | [""]                           | $.appendOnly.0                                     |
        | appendOnly     | "docs/design/journal.md"       | $.appendOnly                                       |
        | gateCommand    | []                             | $.gateCommand                                      |
        | gateCommand    | ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q"] | $.gateCommand        |
        | gateCommand    | [""]                           | $.gateCommand.0                                    |
        | gateCommand    | ["a\\u0000b"]                   | $.gateCommand.0 a word of the command is 1 to 200 characters |
        | gateCommand    | ["a\\u007f"]                    | $.gateCommand.0 a word of the command is 1 to 200 characters |
        | gateCommand    | ["a\\n"]                        | $.gateCommand.0 a word of the command is 1 to 200 characters |
        | gateCommand    | 1                              | $.gateCommand                                      |
        | gateCommand    | "npm run gate"                 | $.gateCommand                                      |
        | gateLog        | "state/other"                  | $.gateLog the gate log is a filename under reports/ |
        | gateLog        | "reports/nested/child"         | $.gateLog the gate log is a filename under reports/ |
        | gateLog        | ""                             | $.gateLog                                          |
        | gateLog        | "/reports/gate.log"            | $.gateLog the gate log is a filename under reports/            |
        | gateLog        | "../gate.log"                  | $.gateLog the gate log is a filename under reports/            |
        | gateLog        | "reports\\\\gate.log"          | $.gateLog the gate log is a filename under reports/            |
        | log            | ""                             | $.log the log path starts with ${state}/            |
        | log            | "/var/log/deliveries.jsonl"    | $.log the log path starts with ${state}/            |
        | log            | "$HOME/a"                      | $.log the log path starts with ${state}/            |
        | log            | "${state}"                      | $.log the log path starts with ${state}/            |
        | log            | "x${state}/a"                   | $.log the log path starts with ${state}/            |
        | log            | "${state}/../a"                 | $.log the log path has only ordinary components                       |
        | log            | "${state}/a/.."                 | $.log the log path has only ordinary components                       |
        | log            | 1                              | $.log                                              |
        | environment    | []                             | $.environment                                      |
        | environment    | ["PATH","HOME","LANG","LC_ALL","LC_CTYPE","TMPDIR","SSH_AUTH_SOCK","XDG_CONFIG_HOME","GH_TOKEN","GITHUB_TOKEN","PATH"] | $.environment the variables are all different |
        | environment    | ["PATH","PATH"]                | $.environment the variables are all different      |
        | environment    | "PATH"                         | $.environment                                      |
        | environment    | [1]                            | $.environment.0                                    |
        | environment    | [""]                           | $.environment.0                                    |
        | environment    | ["path"]                       | $.environment.0                                    |
        | environment    | ["1A"]                         | $.environment.0                                    |
        | environment    | ["_A"]                         | $.environment.0                                    |
        | environment    | ["A-B"]                        | $.environment.0                                    |
        | environment    | ["A B"]                        | $.environment.0                                    |
        | environment    | ["A=1"]                        | $.environment.0                                    |
        | environment    | ["A\\n"]                       | $.environment.0                                    |
        | environment    | ["A"]                          | $.environment.0                                    |
        | environment    | ["LD_PRELOAD"]                 | $.environment.0                                    |
        | environment    | ["PATH","DYLD_INSERT_LIBRARIES"] | $.environment.1                                  |
        | environment    | ["GIT"]                        | $.environment.0                                    |
        | environment    | ["constructor"]                | $.environment.0                                    |
        | environment    | ["GIT_DIR"]                    | $.environment.0                                    |
        | environment    | ["PATH","GIT_"]                | $.environment.1                                    |
        | environment    | ["PATH","GIT_CONFIG_COUNT"]    | $.environment.1                                    |
        | ciAttempts     | 0                              | $.ciAttempts                                       |
        | ciAttempts     | 11                             | $.ciAttempts                                       |
        | ciAttempts     | 1.5                            | $.ciAttempts                                       |
        | ciAttempts     | "6"                            | $.ciAttempts                                       |
        | pollSeconds    | 0                              | $.pollSeconds                                      |
        | pollSeconds    | 301                            | $.pollSeconds                                      |
        | ciPolls        | 0                              | $.ciPolls                                          |
        | ciPolls        | 601                            | $.ciPolls                                          |

    Scenario Outline: a label of 65 characters
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to a string of 65 characters
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.<field>"

      Examples:
        | field    |
        | workflow |

    Scenario Outline: a word of the command of 200 characters
      Given a deliver config of the base form
      And the deliver config field "gateCommand" is set to a list of one string of 200 characters
      When the deliver config is parsed
      Then the deliver config is accepted

      Examples:
        | field       |
        | gateCommand |

    Scenario Outline: a word of the command of 201 characters
      Given a deliver config of the base form
      And the deliver config field "gateCommand" is set to a list of one string of 201 characters
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.gateCommand.0 a word of the command is 1 to 200 characters"

      Examples:
        | field       |
        | gateCommand |

    Scenario Outline: a list holding a label of 65 characters
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to a list of one string of 65 characters
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.<field>.0 a label is 1 to 64 characters"

      Examples:
        | field        |
        | requiredJobs |

    Scenario Outline: a list holding a label of 64 characters
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to a list of one string of 64 characters
      When the deliver config is parsed
      Then the deliver config is accepted

      Examples:
        | field        |
        | requiredJobs |

  Rule: the reason of a copy with two faults holds both, one after the other

    Scenario: two faults
      Given a deliver config of the base form
      And the deliver config field "remote" is set to '"or..gin"'
      And the deliver config field "workPrefix" is set to '"deliver"'
      When the deliver config is parsed
      Then the deliver config is refused with the reason "$.remote a name holds no ..; $.workPrefix a prefix ends with - or /"
