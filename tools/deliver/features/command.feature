Feature: npm run deliver, the command as a whole (the real adapters over a throwaway repository with a bare remote, a scripted client of the forge, the fixture gate and a temporary home)
  The commit "h1" is ahead of both branches, at "p0". The trial branch is "sentinel/gate-1a-step". No scenario reaches the network: the remote is a directory.

  Background:
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"

  Rule: a run that goes to its end

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

    Scenario Outline: a home that is not an absolute path: the log is refused before any act, and nothing is written in the worktree
      Given the delivery command is told the home "<home>"
      When I run the delivery command with "step"
      Then the delivery command exited 3
      And the delivery command printed nothing on its standard output
      And the delivery command wrote on its standard error:
        """
        architect-os deliver: the delivery log is not an absolute path
        """
      And the worktree of the delivery command holds no entry named "<home>"
      And the remote of the delivery command has no branch "sentinel/gate-1a-step"

      Examples:
        | home               |
        | zz-deliver-home    |
        | zz-deliver-no-home |

  Rule: the entry point

    Scenario: the dependencies of a process
      When I build the delivery dependencies of a fake process
      Then the delivery dependencies hold what the process gives
      And the delivery dependencies hold git, gh, the home of the user and the timer of node
      And the delivery dependencies hold the descriptive file of this package

    Scenario: cli.ts hands the process to the command
      When I start cli.ts of the delivery command with no argument
      Then cli.ts of the delivery command exited 2 and printed nothing on its standard output
