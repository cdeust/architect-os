Feature: the closed environment of the delivery, under fresh inputs
  The delivery starts git and the client of the forge with the names of the key `environment` of its descriptive file
  that the host sets, then what each adapter adds (GIT_TERMINAL_PROMPT=0 for git); nothing else passes
  (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »). The command runs over a throwaway
  repository with a bare remote and a scripted client of the forge: the commit "h1" is ahead of both branches, at "p0".

  Rule: a variable of git in the process does not make the delivery act on another repository

    # expected because: « GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, GIT_NAMESPACE dans l'environnement : […] la livraison pousse depuis un autre dépôt » is parried by « La liste fermée » (§14)
    Scenario Outline: a <name> of the process: the commit of the worktree is pushed to its own remote, under its own names
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the process of the delivery command has the variable "<name>" set to "<value>"
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the remote of the delivery command holds "feat/gate-1a" at the commit "h1"
      And the remote of the delivery command holds "main" at the commit "h1"

      Examples:
        | name                 | value            |
        | GIT_NAMESPACE        | elsewhere        |
        | GIT_WORK_TREE        | ..               |
        | GIT_INDEX_FILE       | /nowhere/index   |
        | GIT_OBJECT_DIRECTORY | /nowhere/objects |
        | GIT_COMMON_DIR       | /nowhere         |

    # expected because: « Une configuration injectée par l'environnement (GIT_CONFIG_COUNT, GIT_CONFIG_PARAMETERS, GIT_CONFIG_GLOBAL) : une adresse de dépôt réécrite » is parried by « La liste fermée » (§14)
    Scenario: an address to push to injected by GIT_CONFIG_PARAMETERS: the push still reaches its own remote
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the process of the delivery command has the variable "GIT_CONFIG_PARAMETERS" set to "'remote.origin.pushurl=/nowhere/remote.git'"
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the remote of the delivery command holds "feat/gate-1a" at the commit "h1"
      And the remote of the delivery command holds "main" at the commit "h1"

  Rule: the client of the forge receives the names of the list that the process set, and nothing else

    # expected because: « L'hôte lance git, et le client de la forge, avec une liste fermée de variables : celles dont le nom est dans la liste sont prises de l'environnement de l'hôte […] ; rien d'autre ne passe » (§14)
    Scenario Outline: a variable that is not in the list and changes what the client of the forge does is not given to it: <name>
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the process of the delivery command has the variable "GH_TOKEN" set to "token-1"
      And the process of the delivery command has the variable "<name>" set to "<value>"
      When I run the delivery command with "step --until ci"
      Then the delivery command exited 0
      And every call of the scripted forge received exactly the variables of the list that the process had set, GH_TOKEN among them

      Examples:
        | name                  | value                  |
        | NODE_OPTIONS          | --require=/nowhere.cjs |
        | GH_HOST               | forge.example.invalid  |
        | GH_CONFIG_DIR         | /nowhere/gh            |
        | GH_ENTERPRISE_TOKEN   | secret                 |
        | HTTPS_PROXY           | http://127.0.0.1:1     |
        | http_proxy            | http://127.0.0.1:1     |
        | SSH_ASKPASS           | /nowhere/askpass       |
        | DYLD_INSERT_LIBRARIES | /nowhere/inject.dylib  |
        | GIT_TRACE             | /nowhere/trace         |
        | gh_token              | lower                  |

  Rule: the delivery keeps what it needs to identify itself

    # expected because: the list of the delivery holds « ce qu'il faut pour s'identifier auprès de la forge sur un autre poste (SSH_AUTH_SOCK, XDG_CONFIG_HOME, GH_TOKEN, GITHUB_TOKEN) » (§14, table)
    Scenario Outline: a <name> that the process sets is given to the client of the forge
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the process of the delivery command has the variable "GH_TOKEN" set to "token-1"
      And the process of the delivery command has the variable "<name>" set to "<value>"
      When I run the delivery command with "step --until ci"
      Then the delivery command exited 0
      And every call of the scripted forge received exactly the variables of the list that the process had set, GH_TOKEN among them

      Examples:
        | name          | value               |
        | GITHUB_TOKEN  | token-2             |
        | SSH_AUTH_SOCK | /nowhere/agent.sock |

    # contract silent: on a name of the list set to the empty string; « The environment of a program: each of host.names that host.env sets » (closedEnvironment, host-process.ts), and a variable set to the empty string is set
    Scenario: a GH_TOKEN set to the empty string is still given to the client of the forge
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the process of the delivery command has the variable "GH_TOKEN" set to ""
      When I run the delivery command with "step --until ci"
      Then the delivery command exited 0
      And every call of the scripted forge received exactly the variables of the list that the process had set, GH_TOKEN among them

  Rule: the names of the key environment are taken from a closed set

    # expected because: « Le schéma n'admet plus que des noms pris dans un ensemble fermé » (§14, table « Décidé après les entrées inventées »): a GIT_ name is outside the set, at its position
    Scenario: a GIT_ name after two names of the list is refused at its position
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH","HOME","GIT_SSH_COMMAND"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.2"

    # expected because: the refusal of the schema « the variables are all different » (deliver-schema.ts) holds for a name given twice whatever the positions
    Scenario: a name given first and last is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH","HOME","GH_TOKEN","PATH"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment the variables are all different"

    # expected because: the set is closed and its names are in upper case; another case of a name of the set is not in it
    Scenario: a GIT_ prefix in another case is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["Git_DIR"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.0"

    # changed: it expected a name GIT, outside the set, to be accepted; the set is closed, so it is refused
    Scenario: a name GIT, without the underscore, is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH","GIT"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.1"

    # expected because: the set is closed; a name that holds a line break is not in it
    Scenario: a name that hides a GIT_ variable after a line break is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH\nGIT_DIR"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.0"

    # expected because: the set is closed; the characters next to the ranges of a name are not in it
    Scenario Outline: a character just outside the ranges of a name is refused: <value>
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '<value>'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.0"

      Examples:
        | value      |
        | ["@PATH"]  |
        | ["[PATH"]  |
        | ["PATH:"]  |
        | ["PATH`"]  |
        | ["ÉTAT"]   |

    # changed: it expected a name Z_, outside the set, to be accepted; it is refused
    Scenario: a name made of the last letter and an underscore is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["Z_"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.0"

    # expected because: PATH alone is in the set
    Scenario: a list of one real name, PATH alone, is accepted
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH"]'
      When the deliver config is parsed
      Then the deliver config is accepted

    # changed: it expected 32 names, 22 of them outside the set, to be accepted; the bound of 32 is gone and the set says it all
    Scenario: a list of 32 names of real variables is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH","HOME","LANG","LC_ALL","LC_CTYPE","TMPDIR","SSH_AUTH_SOCK","XDG_CONFIG_HOME","GH_TOKEN","GITHUB_TOKEN","USER","LOGNAME","SHELL","TERM","TZ","LC_MESSAGES","LC_COLLATE","LC_NUMERIC","LC_TIME","LC_MONETARY","LC_PAPER","LC_NAME","LC_ADDRESS","LC_TELEPHONE","LC_MEASUREMENT","LC_IDENTIFICATION","XDG_CACHE_HOME","XDG_DATA_HOME","XDG_STATE_HOME","NO_COLOR","COLUMNS","LINES"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.10"

    # expected because: a name outside the set is refused whatever the length of the list
    Scenario: a list of 33 names of real variables is refused
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH","HOME","LANG","LC_ALL","LC_CTYPE","TMPDIR","SSH_AUTH_SOCK","XDG_CONFIG_HOME","GH_TOKEN","GITHUB_TOKEN","USER","LOGNAME","SHELL","TERM","TZ","LC_MESSAGES","LC_COLLATE","LC_NUMERIC","LC_TIME","LC_MONETARY","LC_PAPER","LC_NAME","LC_ADDRESS","LC_TELEPHONE","LC_MEASUREMENT","LC_IDENTIFICATION","XDG_CACHE_HOME","XDG_DATA_HOME","XDG_STATE_HOME","NO_COLOR","COLUMNS","LINES","EDITOR"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment"

    # expected because: « Un programme lancé par git sur l'ordre d'une variable » (§14): the names of the loader are outside the set
    Scenario Outline: a variable of the loader is refused: <name>
      Given a deliver config of the base form
      And the deliver config field "environment" is set to '["PATH","<name>"]'
      When the deliver config is parsed
      Then the deliver config is refused with a reason holding "$.environment.1"

      Examples:
        | name                  |
        | LD_PRELOAD            |
        | DYLD_INSERT_LIBRARIES |

  Rule: the closed environment of a program, on names the host leaves unset, sets empty, or spells in another case

    # expected because: « The environment of a program: each of host.names that host.env sets, then added, which wins. Nothing else. » (closedEnvironment, host-process.ts); a variable set to the empty string is set
    Scenario: a name that the host sets to the empty string is given, empty
      When I close the environment of the names "A" over a host that sets "A=" with "" added
      Then the closed environment is "A="

    # expected because: « each of host.names that host.env sets » (closedEnvironment, host-process.ts): the names of an environment are compared as they are written, and a lower-case name is another variable
    Scenario: a name in lower case does not take the variable in upper case
      When I close the environment of the names "a" over a host that sets "A=1" with "" added
      Then the closed environment is ""

    # expected because: « each of host.names that host.env sets » (closedEnvironment, host-process.ts)
    Scenario: a name given twice is given once
      When I close the environment of the names "A,A" over a host that sets "A=1" with "" added
      Then the closed environment is "A=1"

    # expected because: « each of host.names that host.env sets, then added, which wins. Nothing else. » (closedEnvironment, host-process.ts): the shape of git-repository.ts, a GIT_ variable of the host outside the list and GIT_TERMINAL_PROMPT added
    Scenario: a GIT_ variable of the host that is not in the names is not given, and the added one is
      When I close the environment of the names "A" over a host that sets "A=1,GIT_DIR=/nowhere" with "GIT_TERMINAL_PROMPT=0" added
      Then the closed environment is "A=1,GIT_TERMINAL_PROMPT=0"

    # expected because: « each of host.names that host.env sets » (closedEnvironment, host-process.ts): a host that sets nothing gives nothing, whatever the name
    Scenario: a name that the host does not set, and that every object answers, is not given
      When I close the environment of the names "constructor" over a host that sets "" with "" added
      Then the closed environment is ""
