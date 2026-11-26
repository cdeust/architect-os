Feature: npm run deliver, the command as a whole (the real adapters over a throwaway repository with a bare remote, a scripted client of the forge, the fixture gate and a temporary home)
  The commit "h1" is ahead of both branches, at "p0". The trial branch is "sentinel/gate-1a-step". No scenario reaches the network: the remote is a directory.

  Background:
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"

  Rule: a run that goes to its end

    Scenario: delivery reads the required producer from the newest effective attempt
      Given the delivery command has its required producer only in the preceding attempt
      When I run the delivery command with "step --until ci"
      Then the delivery command exited 0
      And the delivery command only read the third and second job attempts, in order

    Scenario Outline: delivery reads every effective job of a planned family on a partial rerun
      Given the delivery command has a <pair> latest pair with an older <result> lane
      When I run the delivery command with "step --until ci"
      Then the delivery command exited <exit>

      Examples:
        | pair     | result  | exit |
        | split    | success | 0    |
        | split    | failure | 1    |
        | complete | failure | 1    |

    Scenario: a delivery to its end
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the delivery command printed on its standard output:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":1,"polls":1,"run":42},"gate":"ran","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
        """
      And the delivery command wrote on its standard error:
        """
        préalables
        branche d'essai
        porte
        CI
        publication
        rangement
        """
      And the remote of the delivery command holds "feat/gate-1a" at the commit "h1"
      And the remote of the delivery command holds "main" at the commit "h1"
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"
      And the log of the delivery command holds 1 lines

    Scenario: without INIT_CWD, the working directory is the worktree
      When I run the delivery command with "step" from the worktree, without INIT_CWD
      Then the delivery command exited 0
      And the remote of the delivery command holds "main" at the commit "h1"

    Scenario Outline: until the CI: the branches are not moved and the trial branch stays
      When I run the delivery command with "<arguments>"
      Then the delivery command exited 0
      And the delivery command printed on its standard output:
        """
        {"outcome":"ready","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":1,"polls":1,"run":42},"gate":"ran","published":[],"ruleSuites":{}}
        """
      And the delivery command wrote on its standard error:
        """
        préalables
        branche d'essai
        porte
        CI
        """
      And the remote of the delivery command holds "feat/gate-1a" at the commit "p0"
      And the remote of the delivery command holds "main" at the commit "p0"
      And the remote of the delivery command holds "sentinel/gate-1a-step" at the commit "h1"
      And the log of the delivery command holds 1 lines

      Examples:
        | arguments         |
        | step --until ci   |
        | --until ci step   |

    Scenario: started again after --until ci: the gate is not run again, and the delivery ends
      When I run the delivery command with "step --until ci"
      And the gate of the delivery command is red from now on
      And I run the delivery command with "step"
      Then the delivery command exited 0
      And the delivery command printed on its standard output:
        """
        {"outcome":"delivered","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":1,"polls":1,"run":42},"gate":"reused","published":["feat/gate-1a","main"],"ruleSuites":{"feat/gate-1a":"pass","main":"pass"}}
        """
      And the remote of the delivery command holds "main" at the commit "h1"
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"
      And the log of the delivery command holds 2 lines

  Rule: a run that stops

    Scenario: a red gate
      Given the gate of the delivery command is red from now on
      When I run the delivery command with "step"
      Then the delivery command exited 1
      And the delivery command printed on its standard output:
        """
        {"outcome":"stopped","hash":"h1","trial":"sentinel/gate-1a-step","parent":"p0","ci":{"attempts":0,"polls":0},"gate":"ran","published":[],"phase":"porte","reason":"porte rouge","ruleSuites":{}}
        """
      And the delivery command wrote on its standard error:
        """
        préalables
        branche d'essai
        porte
        stopped at porte: porte rouge
        """
      And the remote of the delivery command holds "main" at the commit "p0"
      And the log of the delivery command holds 1 lines

    Scenario: a tree that is not clean: nothing is pushed
      Given a file of the delivery command worktree changes
      When I run the delivery command with "step"
      Then the delivery command exited 1
      And the delivery command printed on its standard output:
        """
        {"outcome":"stopped","phase":"préalables","reason":"arbre non propre"}
        """
      And the delivery command wrote on its standard error:
        """
        préalables
        stopped at préalables: arbre non propre
        """
      And the remote of the delivery command holds "main" at the commit "p0"
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"
      And the log of the delivery command holds 0 lines

  Rule: the arguments say the name and where the run ends

    Scenario Outline: the arguments "<arguments>" are read
      Then the delivery arguments "<arguments>" are read as the name "<name>" until "<until>"

      Examples:
        | arguments       | name | until |
        | step            | step | end   |
        | step --until ci | step | ci    |
        | --until ci step | step | ci    |

  Rule: a run that is refused before any act

    Scenario Outline: an argument list that is not one name and perhaps --until ci
      When I run the delivery command with "<arguments>"
      Then the delivery command exited 2
      And the delivery command printed nothing on its standard output
      And the delivery command wrote on its standard error:
        """
        architect-os deliver: usage: deliver <name> [--until ci]
        """
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"

      Examples:
        | arguments         |
        |                   |
        | step other        |
        | step --until      |
        | step --until end  |
        | step --force      |
        | --force step      |
        | --force           |
        | step --until ci --until ci |
        | --until ci        |

    Scenario: a descriptive file that the schema refuses
      Given the descriptive file of the delivery command has "ciPolls" set to 0
      When I run the delivery command with "step"
      Then the delivery command exited 2
      And the delivery command printed nothing on its standard output
      And the delivery command wrote on its standard error:
        """
        architect-os deliver: $.ciPolls Too small: expected number to be >=1
        """
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"

    Scenario Outline: a descriptive file that cannot be read
      Given the descriptive file of the delivery command <file>
      When I run the delivery command with "step"
      Then the delivery command exited 2
      And the delivery command printed nothing on its standard output
      And the delivery command wrote on its standard error:
        """
        architect-os deliver: the descriptive file cannot be read
        """

      Examples:
        | file                |
        | is missing          |
        | holds 'not JSON'    |

  Rule: a port that throws

    Scenario: a forge that does not answer: the fixed message of the error, never what the program printed
      Given the forge of the delivery command exits 1 for the runs of "h1"
      When I run the delivery command with "step"
      Then the delivery command exited 3
      And the delivery command printed nothing on its standard output
      And the delivery command wrote on its standard error:
        """
        préalables
        branche d'essai
        porte
        CI
        architect-os deliver: the forge did not answer: runs (exit code 1)
        """
      And the log of the delivery command holds 0 lines

    Scenario: a runtime root that is not an absolute path: the log is refused before any act, and nothing is written
      Given the delivery command is told its runtime root as a path that is not absolute
      When I run the delivery command with "step"
      Then the delivery command exited 3
      And the delivery command printed nothing on its standard output
      And the delivery command wrote on its standard error:
        """
        architect-os deliver: the runtime root for the log is not an absolute path
        """
      And the home of the delivery command holds no delivery log
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"

  Rule: the environment of the process is not given to git nor to the client of the forge

    Scenario: a GIT_DIR of the process that names another repository: the commit of the worktree is pushed to its own remote
      Given the process of the delivery command has a GIT_DIR that names another repository
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the remote of the delivery command holds "feat/gate-1a" at the commit "h1"
      And the remote of the delivery command holds "main" at the commit "h1"

    Scenario: a rewrite of the address of the remote injected by GIT_CONFIG_COUNT: the push still reaches its own remote, and the other receives nothing
      Given the process of the delivery command injects by GIT_CONFIG_COUNT the rewrite of its remote to another remote
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the remote of the delivery command holds "feat/gate-1a" at the commit "h1"
      And the remote of the delivery command holds "main" at the commit "h1"
      And the other remote of the delivery command holds no branch

    Scenario: a witness program named as GIT_SSH_COMMAND and GIT_ASKPASS is not run by the delivery
      Given the process of the delivery command names a witness program as its GIT_SSH_COMMAND and its GIT_ASKPASS
      And the remote of the delivery command is an address that only ssh could reach
      When I run the delivery command with "step"
      Then the delivery command exited 3
      And the witness program of the delivery command has not run

    Scenario: the same witness program is run by a git that is given those variables, so that the scenario above can fail
      Given the process of the delivery command names a witness program as its GIT_SSH_COMMAND and its GIT_ASKPASS
      And the remote of the delivery command is an address that only ssh could reach
      When git is started directly with the environment of the delivery command, witness included
      Then the witness program of the delivery command has run

    Scenario: the client of the forge receives the variables of the list that the process set, and no other
      Given the process of the delivery command has the variable "GH_TOKEN" set to "token-1"
      And the process of the delivery command has the variable "SECRET_ELSEWHERE" set to "secret"
      And the process of the delivery command has the variable "GIT_ASKPASS" set to "/nowhere"
      When I run the delivery command with "step --until ci"
      Then the delivery command exited 0
      And every call of the scripted forge received exactly the variables of the list that the process had set, GH_TOKEN among them

  Rule: the entry point

    Scenario: the dependencies of a process
      When I build the delivery dependencies of a fake process
      Then the delivery dependencies hold what the process gives
      And the delivery dependencies hold git, gh and the timer of node
      And the delivery dependencies hold the descriptive file of this package

    Scenario: cli.ts hands the process to the command
      When I start cli.ts of the delivery command with no argument
      Then cli.ts of the delivery command exited 2 and printed nothing on its standard output
