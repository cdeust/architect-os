Feature: The shell entry aos, witnessed from outside (docs/design/orchestration-fable-5-2.md §14, « Un seul lieu d'écriture »)
  `./aos -- PROGRAM [ARG ...]` admits a run, then replaces itself with PROGRAM. These scenarios start it as a host
  process, from a copy of the launcher that holds only `aos`, `.nvmrc` and `tools/runtime` without node_modules nor dist,
  at paths that hold a space: the admission runs before any install. The copy's list of trusted Node locations names
  one directory, which holds the Node of this suite; a spy npm on the PATH records whether it was entered. The copy's
  policy has floors of one byte unless a scenario says otherwise, so that the witnesses do not depend on the free space
  of the machine; the committed floors are judged by tools/runtime/features/policy.feature.

  A child process kills no mutant: the decisions are judged in process by tools/runtime/features and, for what the
  delivery reads of the launcher, tools/deliver/features. This feature is under features/arch, which the mutation
  profile leaves out; why is written in cucumber.mjs.

  Background:
    Given a copy of the launcher with no node_modules and no dist, at a path that holds a space
    And a spy npm on the PATH of the launcher
    And a working directory of the launcher that holds an existing report
    And a runtime root for the launcher marked "architect-os-runtime-root/v2\nenvironment=workstation\n"

  Rule: a refused launch never enters npm, writes nothing and leaves the report as it was

    Scenario Outline: the launcher refuses <case> with <code>, before npm
      Given <arrangement>
      When the launcher copy runs "npm run gate" from the working directory
      Then the launcher exits 2 with "aos: <code>" alone on stderr
      And the spy npm was never entered
      And the existing report of the working directory is unchanged
      And nothing was written under the runtime root of the launcher

      Examples:
        | case                            | arrangement                                                                                   | code                        |
        | an absent setting               | the launcher is given no runtime root setting                                                 | RUNTIME_ROOT_REQUIRED       |
        | an empty setting                | the launcher is given the runtime root setting ""                                             | RUNTIME_ROOT_REQUIRED       |
        | a relative setting              | the launcher is given the runtime root setting "relative/aos"                                 | RUNTIME_ROOT_UNSAFE         |
        | a missing volume                | the launcher is given a runtime root setting below a directory that does not exist            | RUNTIME_ROOT_UNAVAILABLE    |
        | a root reached through a link   | the launcher is given its runtime root through a symbolic link                                | RUNTIME_ROOT_UNSAFE         |
        | an unmarked directory           | the runtime root of the launcher loses its marker                                             | RUNTIME_MARKER_MISSING      |
        | a marker of the first version   | the runtime root of the launcher is marked "architect-os-runtime-root/v1\n"                   | RUNTIME_MARKER_INVALID      |
        | a marker that names no environment | the runtime root of the launcher is marked "architect-os-runtime-root/v2\n"                | RUNTIME_ENVIRONMENT_UNKNOWN |
        | an unknown environment          | the runtime root of the launcher is marked "architect-os-runtime-root/v2\nenvironment=laptop\n" | RUNTIME_ENVIRONMENT_UNKNOWN |
        | a broken policy                 | the policy of the launcher copy has the root floor "0" and the home floor "1"                 | RUNTIME_POLICY_INVALID      |
        | a root floor above any disk     | the policy of the launcher copy has the root floor "1000000000000000000000000000000" and the home floor "1" | RUNTIME_ROOT_SPACE_LOW |
        | a home floor above any disk     | the policy of the launcher copy has the root floor "1" and the home floor "1000000000000000000000000000000" | RUNTIME_HOME_SPACE_LOW |
        | no Node in a trusted location   | no trusted location of the launcher copy holds a node                                         | RUNTIME_NODE_MISSING        |
        | a trusted Node of another version | the first trusted location of the launcher copy holds a node that reports "v20.0.0"        | RUNTIME_NODE_UNSUPPORTED    |

    Scenario Outline: the launcher refuses the arguments <arguments> with USAGE, before npm
      When the launcher copy runs with the arguments <arguments> from the working directory
      Then the launcher exits 2 with "aos: USAGE" alone on stderr
      And the spy npm was never entered
      And nothing was written under the runtime root of the launcher

      Examples:
        | arguments              |
        | "npm", "run", "gate"   |
        | "--"                   |
        | "--", ""               |
        | "-", "npm"             |
        | "--", "-c", "npm"      |
        | "--", "--", "npm"      |
        | "--", "-"              |

    Scenario Outline: with no setting and no Node in a trusted location, <case> is refused first, with <code>
      Given the launcher is given no runtime root setting
      And no trusted location of the launcher copy holds a node
      When the launcher copy runs with the arguments <arguments> from the working directory
      Then the launcher exits 2 with "aos: <code>" alone on stderr
      And the spy npm was never entered

      Examples:
        | case                           | arguments                   | code                  |
        | the grammar                    | "npm", "run", "gate"        | USAGE                 |
        | a program that begins with "-" | "--", "-c", "npm"           | USAGE                 |
        | the setting                    | "--", "npm", "run", "gate"  | RUNTIME_ROOT_REQUIRED |

    Scenario: a program that begins with "-" is refused before admission, though the PATH holds a program of that name
      Given the PATH of the launcher holds a program named "-c" that prints its arguments
      When the launcher copy runs with the arguments "--", "-c", "npm", "run" from the working directory
      Then the launcher exits 2 with "aos: USAGE" alone on stderr
      And the spy npm was never entered
      And nothing was written under the runtime root of the launcher

    Scenario: the same program, given by its path, is admitted and receives its arguments
      Given the PATH of the launcher holds a program named "-c" that prints its arguments
      When the launcher copy runs the program named "-c" by its path, with the arguments "npm", "-u"
      Then the launcher exits 0
      And the program named "-c" printed the arguments "npm", "-u"

    Scenario: the committed entry of this checkout refuses an unmarked root before npm, with a Node of a trusted location
      Given the runtime root of the launcher loses its marker
      When the committed launcher of this checkout runs "npm run gate" from the working directory
      Then the launcher exits 2 with "aos: RUNTIME_MARKER_MISSING" alone on stderr
      And the spy npm was never entered
      And the existing report of the working directory is unchanged

    Scenario: an admission that cannot be loaded exits 3, before npm
      Given the launcher copy has lost tools/runtime/src/cli.ts
      When the launcher copy runs "npm run gate" from the working directory
      Then the launcher exits 3, its stderr ending with "aos: RUNTIME_UNEXPECTED"
      And the spy npm was never entered
      And nothing was written under the runtime root of the launcher

    Scenario: an error the admission catches exits 3 with its one diagnostic, before npm
      Given the policy decoder of the launcher copy throws an error nobody foresaw
      When the launcher copy runs "npm run gate" from the working directory
      Then the launcher exits 3 with "aos: RUNTIME_UNEXPECTED" alone on stderr
      And the spy npm was never entered
      And the existing report of the working directory is unchanged
      And nothing was written under the runtime root of the launcher

    Scenario: a list of trusted Node locations that names a relative directory exits 3, before npm
      Given the list of trusted Node locations of the launcher copy names "bin" first
      When the launcher copy runs "npm run gate" from the working directory
      Then the launcher exits 3 with "aos: RUNTIME_UNEXPECTED" alone on stderr
      And the spy npm was never entered
      And nothing was written under the runtime root of the launcher

  Rule: the Node of the admission comes from a trusted location, never from the caller's PATH

    Scenario: the committed list of trusted Node locations names absolute directories, each once, the runner's at the pin of .nvmrc
      Then each line of tools/runtime/node-locations is an absolute directory, given once, ending with a line end
      And each location of tools/runtime/node-locations in the runner's tool cache names the version of .nvmrc

    Scenario: a node first on the caller's PATH, which reports the pinned version, is never entered before npm
      Given the PATH of the launcher finds first a node that reports the pinned version and records each time it is entered
      When the launcher copy runs "npm run gate" from the working directory
      Then the launcher exits 0
      And the spy npm was entered with the arguments "run", "gate"
      And the node of the caller's PATH was never entered

    Scenario: the command an admitted launch becomes is looked up in the caller's PATH, as it was
      Given the PATH of the launcher finds first a node that reports the pinned version and records each time it is entered
      When the launcher copy runs "node a b" from the working directory
      Then the launcher exits 0
      And the node of the caller's PATH was entered once, with the arguments "a", "b"

  Rule: an admitted launch is PROGRAM itself, with the locations of a new run

    Scenario: an admitted launch enters npm with its arguments
      When the launcher copy runs "npm run gate" from the working directory
      Then the launcher exits 0
      And the spy npm was entered with the arguments "run", "gate"
      And the receipt of the one run under the runtime root names the command kind "npm"

    Scenario Outline: the receipt of an admitted launch of <program> names the command kind <kind>, not the program
      When the launcher copy runs <program> with the argument "--version" from the working directory
      Then the receipt of the one run under the runtime root names the command kind "<kind>"

      Examples:
        | program               | kind  |
        | the spy npx           | npx   |
        | node                  | node  |
        | the Node of the suite | other |

    Scenario: an admitted launch hands the probe the exact locations and keeps its directory, arguments, stdin and status
      Given the runtime root of the launcher is marked "architect-os-runtime-root/v2\nenvironment=hosted-runner\n"
      And the launcher inherits conflicting locations, a NODE_OPTIONS that would stop any node, and a coverage output
      When the launcher copy runs the probe with the arguments "a b", "" and "-c" and the stdin "question\nline 2" from the working directory
      Then the launcher exits with the status of the probe, 5
      And the probe saw the working directory, the three arguments and the stdin unchanged
      And the probe saw exactly the locations of one new run under the runtime root, and no NODE_OPTIONS nor coverage output
      And the probe saw the XDG_CONFIG_HOME of the caller handed over, not the one the launcher inherited under that name
      And the run of the probe holds its directories, two empty npm configurations and a receipt
      And the receipt of the run of the probe names "hosted-runner" and the command kind "other", and holds no argument, no stdin, no path and no inherited value
      And the working directory holds no coverage output and no redirected warnings

    Scenario: a caller with no XDG_CONFIG_HOME has its absence handed over
      When the launcher copy runs the probe with the arguments "a b", "" and "-c" and the stdin "" from the working directory
      Then the launcher exits with the status of the probe, 5
      And the probe saw the handed-over XDG_CONFIG_HOME "unset"

    Scenario: from a directory of the checkout, ../aos finds its own checkout and keeps the directory of the caller
      When the probe is run through "../aos" from the directory "bench" of the launcher copy
      Then the launcher exits with the status of the probe, 5
      And the probe saw the directory "bench" of the launcher copy as its working directory

    Scenario: an admitted launch of a program that does not exist exits 127
      When the launcher copy runs "no-such-program-of-the-runtime-entry" from the working directory
      Then the launcher exits 127

    Scenario: a program whose name holds "=" is run as a program, with its arguments
      Given the PATH of the launcher holds a program named "a=b" that prints its arguments
      When the launcher copy runs "a=b c=d -u" from the working directory
      Then the launcher exits 0
      And the program named "a=b" printed the arguments "c=d", "-u"

    Scenario: from a caller whose umask lets anyone read and write, what the admitted command creates is private to the account
      When the launcher copy runs, from a caller with the umask 000, a command that creates a file in its temporary directory
      Then the file the caller created before the launcher has the mode 666
      And the file the admitted command created has the mode 600

    Scenario: independent launches overlapping on a freshly marked root all dispatch, each with its own run and its receipt
      When 6 launches of the launcher copy start together on the runtime root, each running the probe
      Then each launch exits with the status of the probe, in its own run directly under the runtime root
      And each of those runs holds a receipt that names it

  Rule: the settings of npm the launcher controls have one value each, whatever spelling the caller gave them

    Scenario Outline: through <shell>, inherited spellings of npm's locations and node-options, in mixed case and with dashes, reach neither the command, nor npm, nor npm's lifecycle child
      Given the launcher inherits the npm settings of every spelling, and settings that are not its own
      And the PATH of the launcher finds the real npm of the Node of the suite
      When the launcher copy is run by "<shell>" with the probe
      Then the probe saw, of the npm settings, only the four locations of its run and the settings that are not the launcher's
      When the launcher copy is run by "<shell>" with "npm config get cache logs-dir userconfig globalconfig node-options"
      Then npm printed the four locations of its run and no node-options
      When the launcher copy is run by "<shell>" with "npm run --silent probe" from a package whose script runs the probe
      Then the lifecycle child of npm saw no NODE_OPTIONS, and npm's cache and log locations of its run

      Examples:
        | shell     |
        | /bin/sh   |
        | /bin/dash |
        | /bin/bash |

  Rule: an admitted delivery identifies itself to the forge as its caller does; the run keeps its own configuration

    Scenario Outline: through the launcher, a delivery whose caller has <case> gives the client of the forge <forwarded>, and the gate the run's configuration
      Given a throwaway repository for a delivery through the launcher, its commit ahead of the destination, and a scripted forge
      And the identity of the scripted forge is configured <where>
      And the launcher inherits <xdg> and a forged handover of XDG_CONFIG_HOME
      When the launcher copy runs the delivery command with "step --until ci" from the throwaway worktree
      Then the delivery through the launcher exits 0, ready
      And every call of the scripted forge through the launcher received exactly the names "<names>" and <forwarded>
      And the gate of the delivery through the launcher saw the XDG_CONFIG_HOME of its run
      And no configuration nor identity of the forge was copied under the runtime root

      Examples:
        | case                         | where                                          | xdg                                       | forwarded                            | names                              |
        | an XDG_CONFIG_HOME of its own | in a configuration directory of its own        | the XDG_CONFIG_HOME of that directory     | the XDG_CONFIG_HOME of that directory | HOME PATH TMPDIR XDG_CONFIG_HOME   |
        | no XDG_CONFIG_HOME           | in the default configuration of its home       | no XDG_CONFIG_HOME                        | no XDG_CONFIG_HOME                   | HOME PATH TMPDIR                   |
        | an empty XDG_CONFIG_HOME     | in the default configuration of its home       | an empty XDG_CONFIG_HOME                  | an empty XDG_CONFIG_HOME             | HOME PATH TMPDIR XDG_CONFIG_HOME   |

  Rule: the admission imports nothing but Node's built-ins and its own modules

    Scenario: the committed sources of the admission import only node: built-ins and #runtime modules, and no process launcher
      Given the committed sources of tools/runtime/src
      Then each import of the admission sources is a node: built-in other than a process launcher, or a #runtime module that exists

    Scenario Outline: a copy of the admission sources that imports <specifier> is refused for that file
      Given the committed sources of tools/runtime/src
      When the admission source "domain/space.ts" of that copy also imports "<specifier>"
      Then the import check of the admission sources refuses only "domain/space.ts", for "<specifier>"

      Examples:
        | specifier                                |
        | zod                                      |
        | fs                                       |
        | node:child_process                       |
        | child_process                            |
        | node:worker_threads                      |
        | node:cluster                             |
        | ../../../../packages/contracts/src/index.js |
        | #runtime/domain/gone.js                  |
