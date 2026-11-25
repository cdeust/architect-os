Feature: what the git of the delivery receives, and the programs it does not start
  The delivery starts git with the names of the key `environment` of its descriptive file that the host sets, and
  GIT_TERMINAL_PROMPT=0; and with no file monitor and no hook of the repository
  (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »). A fake git, the program of the
  adapter, records the names of its environment; a real git shows the hook.

  Rule: every call receives exactly the names of the list that the host sets, and GIT_TERMINAL_PROMPT

    Scenario Outline: the call <method> receives the names of the list that the host sets, the prompt variable, and nothing else
      Given the host of the delivery repository sets "PATH=/bin,HOME=/home/x,LANG=C,GH_TOKEN=t,GITHUB_TOKEN=u,NODE_OPTIONS=--no-warnings,GIT_DIR=/nowhere,GIT_EXEC_PATH=/nowhere"
      And a delivery repository over a git that records the names of its environment
      When I call "<method>" on the delivery repository
      Then every call of the git of the delivery received exactly the names "GH_TOKEN, GITHUB_TOKEN, GIT_TERMINAL_PROMPT, HOME, LANG, PATH"

      Examples:
        | method             |
        | head               |
        | fetch              |
        | remoteHead         |
        | parentsOf          |
        | changedPaths       |
        | isAncestor         |
        | deletedLines       |
        | push               |
        | deleteRemoteBranch |

    Scenario: a name of the list that the host does not set is not received
      Given the host of the delivery repository sets "GH_TOKEN=t"
      And a delivery repository over a git that records the names of its environment
      When I call "head" on the delivery repository
      Then every call of the git of the delivery received exactly the names "GH_TOKEN, GIT_TERMINAL_PROMPT"

    Scenario: a name of the list that the host sets empty is received, empty
      Given the host of the delivery repository sets "GH_TOKEN="
      And a delivery repository over a git that records the names of its environment
      When I call "head" on the delivery repository
      Then every call of the git of the delivery received exactly the names "GH_TOKEN, GIT_TERMINAL_PROMPT"

  Rule: a hook of the repository is not run by the delivery

    Scenario: a pre-push hook of the worktree is not run by a delivery that pushes
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the worktree of the delivery command has a pre-push hook that writes a witness file
      When I run the delivery command with "step"
      Then the delivery command exited 0
      And the remote of the delivery command holds "main" at the commit "h1"
      And the pre-push hook of the delivery command has not run

    Scenario: the same hook is run by a git that is started without the options of the delivery, so that the scenario above can fail
      Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
      And the worktree of the delivery command has a pre-push hook that writes a witness file
      When git pushes directly from the worktree of the delivery command, without the options of the delivery
      Then the pre-push hook of the delivery command has run
