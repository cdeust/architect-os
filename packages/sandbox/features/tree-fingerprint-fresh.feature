Feature: the fingerprint of the tree, under an environment of the process that it must not obey (fresh inputs)
  The host starts git with a closed list of variables: PATH, LANG, LC_ALL, LC_CTYPE and TMPDIR, each taken when the
  process sets it, GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM set to /dev/null, GIT_ATTR_NOSYSTEM set to 1, and GIT_INDEX_FILE for the temporary index;
  nothing else passes, and HOME in particular does not (docs/design/orchestration-fable-5-2.md
  §14, « Un environnement fermé pour git »). Each scenario sets in the process a variable that would change the tree, or
  the run of git, if it reached git, and checks that it did not.

  Rule: a variable of git that names another repository, another work tree or another store of objects does not move the fingerprint

    # expected because: « GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE désignent un autre dépôt que le dossier où il tourne » ; « Aucune variable GIT_ de l'hôte n'atteint git » (§14), and the tree is « l'arbre git de tout le répertoire de travail » (TreeFingerprint.tree)
    Scenario: a GIT_WORK_TREE of the process, alone, that names a subdirectory does not narrow the tree to that subdirectory
      Given a throwaway repository with one commit
      And the file "sub/x.txt" of the repository holds "x\n"
      And the process has the variable "GIT_WORK_TREE" set to "sub"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

    # expected because: the threat row « GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, GIT_NAMESPACE dans l'environnement : l'empreinte est celle d'un autre dépôt » is parried by « La liste fermée » (§14)
    Scenario: a GIT_OBJECT_DIRECTORY of the process that names a directory that does not exist does not stop the fingerprint
      Given a throwaway repository with one commit
      And the process has the variable "GIT_OBJECT_DIRECTORY" set to "/nowhere/objects"
      When I take the fingerprint of the repository
      Then the fingerprint commit is the HEAD of the repository
      And the fingerprint tree is the tree of HEAD
      And the fingerprint is clean

    # expected because: « Aucune variable GIT_ de l'hôte n'atteint git » (§14); GIT_COMMON_DIR, by the documentation of git, sets the directory of the refs and the objects of the repository
    Scenario: a GIT_COMMON_DIR of the process that names a directory that does not exist does not stop the fingerprint
      Given a throwaway repository with one commit
      And the process has the variable "GIT_COMMON_DIR" set to "/nowhere"
      When I take the fingerprint of the repository
      Then the fingerprint commit is the HEAD of the repository
      And the fingerprint tree is the tree of HEAD
      And the fingerprint is clean

  Rule: a configuration given by the environment does not change the tree

    # expected because: « Une configuration injectée par l'environnement (GIT_CONFIG_COUNT, GIT_CONFIG_PARAMETERS, GIT_CONFIG_GLOBAL) » is parried by « La liste fermée » (§14)
    Scenario: a configuration injected by GIT_CONFIG_PARAMETERS that converts line endings does not change the tree
      Given a throwaway repository with one commit
      And the process has the variable "GIT_CONFIG_PARAMETERS" set to "'core.autocrlf=input'"
      And the file "crlf.txt" of the repository holds "one\r\ntwo\r\n"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

    # expected because: the same threat row names GIT_CONFIG_GLOBAL; « Aucune n'est lue : l'appelant pose GIT_CONFIG_GLOBAL et GIT_CONFIG_SYSTEM vers un fichier vide » (§14, après la revue de la douzième passe)
    Scenario: a GIT_CONFIG_GLOBAL of the process that names a file which converts line endings does not change the tree
      Given a throwaway repository with one commit
      And the file "global.cfg" of the repository holds "[core]\nautocrlf = input\n"
      And the process has the variable "GIT_CONFIG_GLOBAL" set to "global.cfg"
      And the file "crlf.txt" of the repository holds "one\r\ntwo\r\n"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

    # expected because: « Aucune variable GIT_ de l'hôte n'atteint git » (§14); GIT_CONFIG_SYSTEM, by the documentation of git, replaces the system configuration file
    Scenario: a GIT_CONFIG_SYSTEM of the process that names a file which converts line endings does not change the tree
      Given a throwaway repository with one commit
      And the file "system.cfg" of the repository holds "[core]\nautocrlf = input\n"
      And the process has the variable "GIT_CONFIG_SYSTEM" set to "system.cfg"
      And the file "crlf.txt" of the repository holds "one\r\ntwo\r\n"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

    # expected because: the fingerprint takes « PATH, LANG, LC_ALL, LC_CTYPE, TMPDIR » from the host (§14, table), and XDG_CONFIG_HOME is in the list of the delivery only; by the documentation of git, $XDG_CONFIG_HOME/git/config is a global configuration file
    Scenario: an XDG_CONFIG_HOME of the process, which is not in the list of the fingerprint, does not give git its configuration
      Given a throwaway repository with one commit
      And the file "xdg/git/config" of the repository holds "[core]\nautocrlf = input\n"
      And the process has the variable "XDG_CONFIG_HOME" set to "xdg"
      And the file "crlf.txt" of the repository holds "one\r\ntwo\r\n"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

    # expected because: « Aucune variable GIT_ de l'hôte n'atteint git » (§14); GIT_ATTR_SOURCE, by the documentation of git, is the tree the attributes are read from, and git stops when it names no tree
    Scenario: a GIT_ATTR_SOURCE of the process that names no tree does not stop the fingerprint
      Given a throwaway repository with one commit
      And the file "a.txt" of the repository holds "changed\n"
      And the process has the variable "GIT_ATTR_SOURCE" set to "nowhere"
      When I take the fingerprint of the repository
      Then the fingerprint is not clean
      And the fingerprint tree is the tree that committing everything would give

  Rule: each call of git receives the names of the list that the process set, and nothing else

    # expected because: « Un programme lancé par git sur l'ordre d'une variable (GIT_SSH_COMMAND, GIT_ASKPASS, GIT_EXEC_PATH, GIT_EDITOR, GIT_PAGER) » and « GIT_TRACE, GIT_CURL_VERBOSE écrivent des en-têtes d'authentification » are parried by « La liste fermée » ; « rien d'autre ne passe » (§14)
    Scenario Outline: a variable of git that starts a program, writes a trace or reads another repository is not given to git: <name>
      PATH is set by the step of the fake git, which puts itself first on it, and TMPDIR by the step of the temporary directory
      that the fingerprint must leave empty; the names the scenario sets itself are below.

      Given a fake git that records its calls
      And a temporary directory that the fingerprint must leave empty
      And a throwaway directory
      And the process has the variable "HOME" set to "/nowhere/home"
      And the process has the variable "LANG" set to "C"
      And the process has the variable "LC_CTYPE" set to "C"
      And the process has no variable "LC_ALL"
      And the process has the variable "<name>" set to "<value>"
      When I take the fingerprint of the directory
      Then each call of the fake git received exactly the names of the list that the process had, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due

      Examples:
        | name                              | value                |
        | GIT_EXEC_PATH                     | /nowhere/libexec     |
        | GIT_PAGER                         | /nowhere/pager       |
        | GIT_TRACE2_EVENT                  | /nowhere/trace.json  |
        | GIT_NAMESPACE                     | elsewhere            |
        | GIT_ALTERNATE_OBJECT_DIRECTORIES  | /nowhere/objects     |
        | GIT_CEILING_DIRECTORIES           | /                    |

    # expected because: « celles dont le nom est dans la liste sont prises de l'environnement de l'hôte, puis viennent celles que l'appelant pose lui-même ; rien d'autre ne passe » (§14): the rule is on every name, not on the prefix GIT_
    Scenario Outline: a variable that is not git's and still changes what a program does is not given to git: <name>
      PATH is set by the step of the fake git, which puts itself first on it, and TMPDIR by the step of the temporary directory
      that the fingerprint must leave empty; the names the scenario sets itself are below.

      Given a fake git that records its calls
      And a temporary directory that the fingerprint must leave empty
      And a throwaway directory
      And the process has the variable "HOME" set to "/nowhere/home"
      And the process has the variable "LANG" set to "C"
      And the process has the variable "LC_CTYPE" set to "C"
      And the process has no variable "LC_ALL"
      And the process has the variable "<name>" set to "<value>"
      When I take the fingerprint of the directory
      Then each call of the fake git received exactly the names of the list that the process had, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due

      Examples:
        | name                  | value                  |
        | LD_PRELOAD            | /nowhere/inject.so     |
        | DYLD_INSERT_LIBRARIES | /nowhere/inject.dylib  |
        | NODE_OPTIONS          | --require=/nowhere.cjs |
        | HTTPS_PROXY           | http://127.0.0.1:1     |
        | git_dir               | /nowhere               |

    # expected because: « Le jeton de la forge passe dans l'environnement de git […] il n'est dans la liste que de la livraison […] ; ni l'empreinte ni la porte ne le reçoivent » (§14)
    Scenario Outline: what the delivery needs to identify itself is not given to the git of the fingerprint: <name>
      PATH is set by the step of the fake git, which puts itself first on it, and TMPDIR by the step of the temporary directory
      that the fingerprint must leave empty; the names the scenario sets itself are below.

      Given a fake git that records its calls
      And a temporary directory that the fingerprint must leave empty
      And a throwaway directory
      And the process has the variable "HOME" set to "/nowhere/home"
      And the process has the variable "LANG" set to "C"
      And the process has the variable "LC_CTYPE" set to "C"
      And the process has no variable "LC_ALL"
      And the process has the variable "<name>" set to "<value>"
      When I take the fingerprint of the directory
      Then each call of the fake git received exactly the names of the list that the process had, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due

      Examples:
        | name          | value               |
        | GITHUB_TOKEN  | secret              |
        | SSH_AUTH_SOCK | /nowhere/agent.sock |

  Rule: a name of the list is given when the process sets it, even to the empty string, and not when it does not

    # expected because: « Each name is taken only when the host sets it » (closedEnvironment, packages/sandbox/src/tree-fingerprint.ts); a variable set to the empty string is set
    Scenario: a LANG set to the empty string is given to git
      PATH is set by the step of the fake git, which puts itself first on it, and TMPDIR by the step of the temporary directory
      that the fingerprint must leave empty; the names the scenario sets itself are below.

      Given a fake git that records its calls
      And a temporary directory that the fingerprint must leave empty
      And a throwaway directory
      And the process has the variable "LC_CTYPE" set to "C"
      And the process has no variable "LC_ALL"
      And the process has the variable "LANG" set to ""
      When I take the fingerprint of the directory
      Then each call of the fake git received exactly the names of the list that the process had, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due
