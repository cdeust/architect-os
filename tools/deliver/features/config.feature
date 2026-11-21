Feature: The descriptive file tools/deliver/deliver.json (its schema, the committed copy, and every broken copy)

  Rule: the committed file loads

    Scenario: the file committed in this repository is accepted by the schema
      When the committed deliver config is loaded
      Then the deliver config is accepted
      And the accepted deliver config holds the branches "feat/gate-1a, main" and the required jobs "gate-linux, gate-macos"
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

    Scenario Outline: a dependency conflict identifies its specific cause
      Given a deliver config of the base form
      And the deliver config field "jobDependencies" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "<reason>"

      Examples:
        | value | reason |
        | {"gate-linux":{"admissionStep":"Check","producers":["a","a"]}} | the producers are all different |
        | {"gate-linux":{"admissionStep":"Check","producers":["a","gate-macos"]},"gate-macos":{"admissionStep":"Check","producers":["b"]}} | an aggregate must be required and its producers must be leaf jobs |

    Scenario: the committed aggregate binds the three Linux producers to its admission step
      When the committed deliver config is loaded
      Then the committed Linux gate requires its two cucumber shards and mutation at "Require all producers"

  Rule: a copy at the edge of a rule is accepted

    Scenario Outline: a value at the edge
      Given a deliver config of the base form
      And the deliver config field "<field>" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is accepted

      Examples:
        | field          | value                                                  |
        | branches       | ["a"]                                                  |
        | branches       | ["a","b","c","d"]                                      |
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
        | gateVerdict    | "a"                                                    |
        | gateCommand    | ["a"]                                                  |
        | gateCommand    | ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p"] |
        | gateLog        | "a"                                                    |
        | log            | "${state}/a"                                            |
        | log            | "${state}/a.b/c"                                        |
        | ciAttempts     | 1                                                      |
        | ciAttempts     | 10                                                     |
        | pollSeconds    | 1                                                      |
        | pollSeconds    | 300                                                    |
        | ciPolls        | 1                                                      |
        | ciPolls        | 600                                                    |
        | ruleSuitePolls | 1                                                      |
        | ruleSuitePolls | 60                                                     |
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
        | branches       |
        | trialPrefix    |
        | workflow       |
        | requiredJobs   |
        | environment    |
        | appendOnly     |
        | gateVerdict    |
        | gateCommand    |
        | gateLog        |
        | log            |
        | ciAttempts     |
        | pollSeconds    |
        | ciPolls        |
        | ruleSuitePolls |

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
        | branches       | []                             | $.branches                                         |
        | branches       | ["a","b","c","d","e"]          | $.branches                                         |
        | branches       | ["a","a"]                      | $.branches the branches are all different          |
        | branches       | ["-a"]                         | $.branches.0                                       |
        | branches       | ["a","b..c"]                   | $.branches.1 a name holds no ..                    |
        | branches       | ["a b"]                        | $.branches.0                                       |
        | branches       | "main"                         | $.branches                                         |
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
        | branches       | ["a\\n"]                       | $.branches.0                                       |
        | trialPrefix    | "sentinel/\\n"                 | $.trialPrefix                                      |
        | trialPrefix    | "feat/"                        | $.trialPrefix a trial branch is never a branch to publish |
        | trialPrefix    | "feat/gate-"                   | $.trialPrefix a trial branch is never a branch to publish |
        | branches       | ["feat/gate-1a","sentinel/gate-1a-"] | $.trialPrefix a trial branch is never a branch to publish |
        | branches       | ["feat/gate-1a","sentinel/gate-1a-x"] | $.trialPrefix a trial branch is never a branch to publish |
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
        | gateVerdict    | ""                             | $.gateVerdict                                      |
        | gateVerdict    | "/reports/gate-base.json"      | $.gateVerdict a repository path is relative        |
        | gateVerdict    | "../gate-base.json"            | $.gateVerdict a repository path is relative        |
        | gateVerdict    | "reports\\\\gate-base.json"    | $.gateVerdict a repository path is relative        |
        | gateCommand    | []                             | $.gateCommand                                      |
        | gateCommand    | ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q"] | $.gateCommand        |
        | gateCommand    | [""]                           | $.gateCommand.0                                    |
        | gateCommand    | ["a\\u0000b"]                   | $.gateCommand.0 a word of the command is 1 to 200 characters |
        | gateCommand    | ["a\\u007f"]                    | $.gateCommand.0 a word of the command is 1 to 200 characters |
        | gateCommand    | ["a\\n"]                        | $.gateCommand.0 a word of the command is 1 to 200 characters |
        | gateCommand    | 1                              | $.gateCommand                                      |
        | gateCommand    | "npm run gate"                 | $.gateCommand                                      |
        | gateLog        | ""                             | $.gateLog                                          |
        | gateLog        | "/reports/gate.log"            | $.gateLog a repository path is relative            |
        | gateLog        | "../gate.log"                  | $.gateLog a repository path is relative            |
        | gateLog        | "reports\\\\gate.log"          | $.gateLog a repository path is relative            |
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
        | ruleSuitePolls | 0                              | $.ruleSuitePolls                                   |
        | ruleSuitePolls | 61                             | $.ruleSuitePolls                                   |

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
      And the deliver config field "branches" is set to '["a","a"]'
      When the deliver config is parsed
      Then the deliver config is refused with the reason "$.remote a name holds no ..; $.branches the branches are all different"
