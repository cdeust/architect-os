Feature: one file and one module give the git of the host what precedes its subcommand and its whole environment
  packages/sandbox/git-closed.json is the only place where what the git of the fingerprint, of the gate, of its guard
  and of the delivery share is written: options, variables, names taken from the host. packages/sandbox/src/git-closed.ts
  reads it for the fingerprint, the gate and the delivery, and adds what each sets for itself; the guard of the checkout
  (tools/test-gate/with-tree-lock.py), which a shell starts before any Node, reads the same file. What each caller
  really gives its git is held by its own scenarios (tree-fingerprint.feature,
  tools/test-gate/features/closed-environment.feature, tools/deliver/features/ports.feature and git-environment.feature).

  The options and variables make a fingerprint and a verdict independent of the machine and are a second barrier. The
  boundary itself is elsewhere: a session cannot write the git directory of its repository (profile.feature, and the
  attacks of features/sandbox/escape.feature).

  Scenario: the committed file loads against its schema, with each option, variable and name
    When the committed closed git file is loaded
    Then the closed git options are "--no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null"
    And the closed git variables are "GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1"
    And the closed git variables of a call that reads no configuration of the machine are "GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1"
    And the closed git names taken from the host are "PATH LANG LC_ALL LC_CTYPE TMPDIR"

  Rule: a broken copy of the file is refused by each of its two readers, and no git is started

    The two readers are written in two languages. Each rule is one pattern over printable ASCII, matched whole, and
    the file is UTF-8 JSON and nothing else, so that neither reader accepts what the other refuses; the copies below
    are the proof, and they are the same for both.

    Scenario Outline: the <reader> reads the committed copy
      Given a copy of the committed closed git file with the change "nothing"
      Then the <reader> accepts the closed git copy

      Examples:
        | reader            |
        | TypeScript module |
        | guard             |

    Scenario Outline: the <reader> refuses a copy that is not UTF-8 JSON: <change>
      Given a copy of the committed closed git file with the change "<change>"
      Then the <reader> refuses the closed git copy as text that is not JSON

      Examples:
        | reader            | change                                          |
        | TypeScript module | text that is not JSON                           |
        | TypeScript module | a number that JSON does not have                |
        | TypeScript module | a byte order mark                               |
        | TypeScript module | the file in UTF-16                              |
        | TypeScript module | a byte that is not UTF-8                        |
        | guard             | text that is not JSON                           |
        | guard             | a number that JSON does not have                |
        | guard             | a byte order mark                               |
        | guard             | the file in UTF-16                              |
        | guard             | a byte that is not UTF-8                        |

    Scenario Outline: the <reader> refuses a copy with <change>
      Given a copy of the committed closed git file with the change "<change>"
      Then the <reader> refuses the closed git copy for its schema

      Examples:
        | reader            | change                                          |
        | TypeScript module | a list in place of the object                   |
        | TypeScript module | a key of its own                                |
        | TypeScript module | a key removed                                   |
        | TypeScript module | no option                                       |
        | TypeScript module | options that are not a list                     |
        | TypeScript module | an option that is not text                      |
        | TypeScript module | an option that is a subcommand                  |
        | TypeScript module | an option with one dash                         |
        | TypeScript module | an option with dashes after its first character |
        | TypeScript module | an option that holds a space                    |
        | TypeScript module | a -c with no value after it                     |
        | TypeScript module | a -c whose value is another -c                  |
        | TypeScript module | a -c whose value sets nothing                   |
        | TypeScript module | a -c whose value begins with dashes             |
        | TypeScript module | a -c whose value ends with a carriage return    |
        | TypeScript module | a first option that is a configuration          |
        | TypeScript module | a variable that is not of git                   |
        | TypeScript module | a variable in lower case                        |
        | TypeScript module | a variable that ends in lower case              |
        | TypeScript module | a variable named __proto__                      |
        | TypeScript module | a variable with no value                        |
        | TypeScript module | a variable whose value ends with a line end     |
        | TypeScript module | a variable that is not text                     |
        | TypeScript module | variables that are a list                       |
        | TypeScript module | a machine variable that is not of git           |
        | TypeScript module | no name of the host                             |
        | TypeScript module | names of the host that are not a list           |
        | TypeScript module | the name HOME                                   |
        | TypeScript module | the name XDG_CONFIG_HOME                        |
        | TypeScript module | a name of the host that is a git variable       |
        | TypeScript module | a name of the host in lower case                |
        | TypeScript module | a name of the host followed by a line end       |
        | TypeScript module | a name of the host that is not text             |
        | TypeScript module | a name of the host twice                        |
        | guard             | a list in place of the object                   |
        | guard             | a key of its own                                |
        | guard             | a key removed                                   |
        | guard             | no option                                       |
        | guard             | options that are not a list                     |
        | guard             | an option that is not text                      |
        | guard             | an option that is a subcommand                  |
        | guard             | an option with one dash                         |
        | guard             | an option with dashes after its first character |
        | guard             | an option that holds a space                    |
        | guard             | a -c with no value after it                     |
        | guard             | a -c whose value is another -c                  |
        | guard             | a -c whose value sets nothing                   |
        | guard             | a -c whose value begins with dashes             |
        | guard             | a -c whose value ends with a carriage return    |
        | guard             | a first option that is a configuration          |
        | guard             | a variable that is not of git                   |
        | guard             | a variable in lower case                        |
        | guard             | a variable that ends in lower case              |
        | guard             | a variable named __proto__                      |
        | guard             | a variable with no value                        |
        | guard             | a variable whose value ends with a line end     |
        | guard             | a variable that is not text                     |
        | guard             | variables that are a list                       |
        | guard             | a machine variable that is not of git           |
        | guard             | no name of the host                             |
        | guard             | names of the host that are not a list           |
        | guard             | the name HOME                                   |
        | guard             | the name XDG_CONFIG_HOME                        |
        | guard             | a name of the host that is a git variable       |
        | guard             | a name of the host in lower case                |
        | guard             | a name of the host followed by a line end       |
        | guard             | a name of the host that is not text             |
        | guard             | a name of the host twice                        |

    Scenario Outline: the <reader> accepts a copy with <change>
      The names HOMEBREW_PREFIX and XDG_CONFIG_HOMES only begin like the two refused names.

      Given a copy of the committed closed git file with the change "<change>"
      Then the <reader> accepts the closed git copy

      Examples:
        | reader            | change                                          |
        | TypeScript module | an option and a configuration added             |
        | TypeScript module | no variable                                     |
        | TypeScript module | names that begin like refused ones              |
        | guard             | an option and a configuration added             |
        | guard             | no variable                                     |
        | guard             | names that begin like refused ones              |

    Scenario: loading a refused copy throws its reason
      Given a copy of the committed closed git file with the change "text that is not JSON"
      Then loading the closed git copy throws "git-closed.json : JSON invalide"
      Given a copy of the committed closed git file with the change "no option"
      Then loading the closed git copy throws "git-closed.json : schéma refusé"

  Rule: the module gives each caller the whole of what precedes its subcommand

    Scenario: a caller that adds nothing is given the options of the file
      Then the closed git options of a caller that adds "" are "--no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null"

    Scenario: what a caller adds for itself follows the options of the file, each value after its own -c
      Then the closed git options of a caller that adds "core.quotePath=false color.ui=never" are "--no-replace-objects --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all -c core.attributesFile=/dev/null -c core.quotePath=false -c color.ui=never"

    Scenario: the options are those of the copy the caller reads
      Given a copy of the committed closed git file with the change "an option and a configuration added"
      Then the closed git options of the copy for a caller that adds "color.ui=never" end with "-c core.attributesFile=/dev/null --no-pager -c core.quotePath=false -c color.ui=never"

  Rule: the module gives each caller its whole environment

    Scenario: a git that reads no configuration of the machine is given the names of the file that the process sets, and no other
      Given the process has the closed git variable "LANG" set to "C"
      And the process has the closed git variable "LC_CTYPE" set to ""
      And the process has no closed git variable "LC_ALL"
      And the process has the closed git variable "HOME" set to "/nowhere/home"
      And the process has the closed git variable "GIT_DIR" set to "/nowhere"
      Then the environment of a git that reads no configuration of the machine has, beside PATH and TMPDIR, exactly:
        | LANG                   | C         |
        | LC_CTYPE               |           |
        | GIT_CONFIG_GLOBAL      | /dev/null |
        | GIT_CONFIG_SYSTEM      | /dev/null |
        | GIT_CONFIG_NOSYSTEM    | 1         |
        | GIT_ATTR_NOSYSTEM      | 1         |
        | GIT_NO_REPLACE_OBJECTS | 1         |

    Scenario: the private index of the fingerprint is added to it
      Given the process has the closed git variable "LANG" set to "C"
      And the process has no closed git variable "LC_ALL"
      And the process has no closed git variable "LC_CTYPE"
      Then the environment of a git that reads no configuration of the machine, with the index "/t/index", has, beside PATH and TMPDIR, exactly:
        | LANG                   | C         |
        | GIT_INDEX_FILE         | /t/index  |
        | GIT_CONFIG_GLOBAL      | /dev/null |
        | GIT_CONFIG_SYSTEM      | /dev/null |
        | GIT_CONFIG_NOSYSTEM    | 1         |
        | GIT_ATTR_NOSYSTEM      | 1         |
        | GIT_NO_REPLACE_OBJECTS | 1         |

    Scenario: the git of the delivery is given what the delivery took from the host, its own variable, and the variables of the file, not those of a git that reads no configuration
      Then the environment of the git of a delivery that took "PATH=/bin HOME=/h GH_TOKEN=" from the host is exactly:
        | PATH                   | /bin |
        | HOME                   | /h   |
        | GH_TOKEN               |      |
        | GIT_TERMINAL_PROMPT    | 0    |
        | GIT_ATTR_NOSYSTEM      | 1    |
        | GIT_NO_REPLACE_OBJECTS | 1    |

    Scenario: a real git given that environment reads no configuration outside its repository
      On macOS the git of the system reads a configuration file of its installation whatever GIT_CONFIG_SYSTEM says
      (a credential helper, a default branch): GIT_CONFIG_NOSYSTEM alone stops it. The step lists the configuration
      git reads, with the scope of each value, in a repository made for it.

      Then a real git given the environment of a git that reads no configuration of the machine lists only the configuration of its repository

  Rule: a variable a caller sets for itself is its own to decide, and a file that names it too is refused

    The private index of the fingerprint, the prompt of the delivery and the locks of the guard are set by their caller.
    A file that set one of them would either lose silently or win silently: both are refused.

    Scenario Outline: a copy of the file that names <variable> is refused when <caller> builds its environment
      Given a copy of the committed closed git file with the variable "<variable>" in its "<place>"
      Then building the environment of <caller> from the copy throws "git-closed.json : variable que l'appelant pose lui-même"

      Examples:
        | variable            | place              | caller          |
        | GIT_INDEX_FILE      | environment        | the fingerprint |
        | GIT_INDEX_FILE      | machineIndependent | the fingerprint |
        | GIT_TERMINAL_PROMPT | environment        | the delivery    |

    Scenario Outline: the same copy builds the environment of <caller>, which does not set <variable>
      Given a copy of the committed closed git file with the variable "<variable>" in its "<place>"
      Then building the environment of <caller> from the copy gives the variable "<variable>" of the copy

      Examples:
        | variable            | place              | caller          |
        | GIT_TERMINAL_PROMPT | environment        | the fingerprint |
        | GIT_INDEX_FILE      | environment        | the delivery    |

    Scenario: a variable of the file that only a git reading no configuration is given does not reach the delivery, whatever it is
      Given a copy of the committed closed git file with the variable "GIT_TERMINAL_PROMPT" in its "machineIndependent"
      Then building the environment of the delivery from the copy gives no variable "GIT_CONFIG_GLOBAL"
      And building the environment of the delivery from the copy gives the variable "GIT_TERMINAL_PROMPT" of the delivery

    Scenario Outline: the guard refuses a copy of the file that names <variable>, which the guard sets itself
      Given a copy of the committed closed git file with the variable "<variable>" in its "<place>"
      Then the guard refuses the closed git copy for its schema

      Examples:
        | variable           | place              |
        | GIT_OPTIONAL_LOCKS | environment        |
        | GIT_OPTIONAL_LOCKS | machineIndependent |

    Scenario: the guard reads a copy that names a variable it does not set
      Given a copy of the committed closed git file with the variable "GIT_INDEX_FILE" in its "environment"
      Then the guard accepts the closed git copy
