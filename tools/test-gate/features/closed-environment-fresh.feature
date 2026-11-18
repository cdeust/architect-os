Feature: the gate reads its own repository, whatever variable of git the process holds (fresh inputs)
  The gate starts git with a closed list of variables of the host (PATH, LANG, LC_ALL, LC_CTYPE, TMPDIR) and nothing
  else (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »). The expectation (head, first
  parent, diff) is taken through the gate's own git before the poison; each scenario then sets in the process one
  variable that would change what git reads, or stop it, if it reached git. One scenario sets two, HOME and
  XDG_CONFIG_HOME, and takes its expectation after writing a file with CRLF line ends.

  Background:
    Given a gate repository
    And the gate repository file "notes.txt" reads:
      """
      first
      """
    And the gate first parent is committed
    And the gate repository file "notes.txt" reads:
      """
      second
      """
    And the gate head is committed
    And the gate repository file "notes.txt" reads:
      """
      third
      """
    And the expectation is taken from the gate repository, before the poison

  Rule: a variable of git that names another work tree, another index or another store does not move what the gate reads

    # expected because: « GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE […] dans l'environnement : […] la porte compare à une autre base » is parried by « La liste fermée » (§14)
    Scenario: a GIT_WORK_TREE of the process, alone, that names a subdirectory does not change the diff
      Given the gate repository file "sub/notes.txt" reads:
        """
        elsewhere
        """
      And the process has the variable "GIT_WORK_TREE" set to "sub"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: the same threat row names GIT_INDEX_FILE; « Aucune variable GIT_ de l'hôte n'atteint git » (§14)
    Scenario: a GIT_INDEX_FILE of the process that names an index that does not exist does not change the diff
      Given the process has the variable "GIT_INDEX_FILE" set to "/nowhere/index"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: the same threat row names GIT_OBJECT_DIRECTORY; « Aucune variable GIT_ de l'hôte n'atteint git » (§14)
    Scenario: a GIT_OBJECT_DIRECTORY of the process that names a directory that does not exist does not stop the gate
      Given the process has the variable "GIT_OBJECT_DIRECTORY" set to "/nowhere/objects"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: « Aucune variable GIT_ de l'hôte n'atteint git » (§14); GIT_COMMON_DIR, by the documentation of git, sets the directory of the refs and the objects
    Scenario: a GIT_COMMON_DIR of the process that names a directory that does not exist does not stop the gate
      Given the process has the variable "GIT_COMMON_DIR" set to "/nowhere"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

  Rule: a configuration given by the environment does not change the diff

    # expected because: « Une configuration injectée par l'environnement (GIT_CONFIG_COUNT, GIT_CONFIG_PARAMETERS, GIT_CONFIG_GLOBAL) » is parried by « La liste fermée » (§14)
    Scenario: a GIT_CONFIG_PARAMETERS of the process that drops the prefixes of the diff does not change the diff
      Given the process has the variable "GIT_CONFIG_PARAMETERS" set to "'diff.noprefix=true'"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: the same threat row names GIT_CONFIG_COUNT (§14), and no scenario of the gate sets it
    Scenario: a GIT_CONFIG_COUNT of the process that drops the prefixes of the diff does not change the diff
      Given the process has the variable "GIT_CONFIG_COUNT" set to "1"
      And the process has the variable "GIT_CONFIG_KEY_0" set to "diff.noprefix"
      And the process has the variable "GIT_CONFIG_VALUE_0" set to "true"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: the same threat row names GIT_CONFIG_GLOBAL; « Aucune n'est lue : l'appelant pose GIT_CONFIG_GLOBAL et GIT_CONFIG_SYSTEM vers un fichier vide » (§14, après la revue de la douzième passe)
    Scenario: a GIT_CONFIG_GLOBAL of the process that names a file which drops the prefixes of the diff does not change the diff
      Given the gate repository file "global.cfg" reads:
        """
        [diff]
        noprefix = true
        """
      And the process has the variable "GIT_CONFIG_GLOBAL" set to "global.cfg"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: « Aucune variable GIT_ de l'hôte n'atteint git » (§14); GIT_CONFIG_SYSTEM, by the documentation of git, replaces the system configuration file
    Scenario: a GIT_CONFIG_SYSTEM of the process that names a file which drops the prefixes of the diff does not change the diff
      Given the gate repository file "system.cfg" reads:
        """
        [diff]
        noprefix = true
        """
      And the process has the variable "GIT_CONFIG_SYSTEM" set to "system.cfg"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: the gate takes « Les mêmes » as the fingerprint, « PATH, LANG, LC_ALL, LC_CTYPE, TMPDIR » (§14, table): XDG_CONFIG_HOME is in the list of the delivery only; by the documentation of git, $XDG_CONFIG_HOME/git/config is a global configuration file
    Scenario: an XDG_CONFIG_HOME of the process, which is not in the list of the gate, does not give git its configuration
      Given the gate repository file "xdg/git/config" reads:
        """
        [diff]
        noprefix = true
        """
      And the process has the variable "XDG_CONFIG_HOME" set to "xdg"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"

    # expected because: « Aucune n'est lue » for the global configuration of the gate (§14, après la revue de la douzième passe): the file of the HOME of the process is not read, nor the git/config of its XDG_CONFIG_HOME. Each carries its own weight: the .gitconfig converts line ends (the CRLF of notes.txt would be read as LF), the git/config drops the prefixes of the diff
    Scenario: a HOME whose .gitconfig converts line endings and an XDG_CONFIG_HOME whose git/config drops the prefixes do not change what the gate reads
      Given the gate repository file "notes.txt" reads "third" with CRLF line ends
      And the expectation is taken from the gate repository, before the poison
      And the HOME of the process holds a .gitconfig that sets core.autocrlf
      And the XDG_CONFIG_HOME of the process holds a configuration file in git that sets diff.noprefix
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read is the expected one and adds the line "third" with a CRLF line end to "notes.txt"

    # expected because: « Aucune variable GIT_ de l'hôte n'atteint git » (§14); GIT_ATTR_SOURCE, by the documentation of git, is the tree the attributes are read from, and git stops when it names no tree
    Scenario: a GIT_ATTR_SOURCE of the process that names no tree does not stop the diff
      Given the process has the variable "GIT_ATTR_SOURCE" set to "nowhere"
      When the gate reads its repository
      Then the head it read is the head of the gate repository
      And the first parent it read is the first parent of the gate repository
      And the diff it read adds the line "third" to "notes.txt"
