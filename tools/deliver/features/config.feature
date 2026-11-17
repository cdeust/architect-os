Feature: The descriptive file tools/deliver/deliver.json (its schema, the committed copy, and every broken copy)

  Rule: the committed file loads

    Scenario: the file committed in this repository is accepted by the schema
      When the committed deliver config is loaded
      Then the deliver config is accepted
      And the accepted deliver config holds the branches "feat/gate-1a, main" and the required jobs "gate-linux, gate-macos"
      And the committed deliver config names the section of its design

    Scenario: the base form of these scenarios is accepted
      Given a deliver config of the base form
      When the deliver config is parsed
      Then the deliver config is accepted

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
        | ciAttempts     | 1                                                      |
        | ciAttempts     | 10                                                     |
        | pollSeconds    | 1                                                      |
        | pollSeconds    | 300                                                    |
        | ciPolls        | 1                                                      |
        | ciPolls        | 600                                                    |
        | ruleSuitePolls | 1                                                      |
        | ruleSuitePolls | 60                                                     |
        | workflow       | "Gate CI (linux)"                                      |

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
        | appendOnly     |
        | gateVerdict    |
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
