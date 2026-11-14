Feature: the code tool of 1a.0, composed from code.json (host side, fake runner, fake proxy)
  `npm run code` runs claude under srt in the current worktree. code.ts only hands the process to runCodeTool;
  everything it does is here.

  Scenario: without a terminal, the session pipes stdio through the sandbox and ends with its exit code
    Given a code tool session with the session token "tok" and the arguments "-p hello"
    When I run the code tool with "piped text" on stdin
    Then the code tool exits with 0
    And the sandbox ran the profile "builder" in "/work" with the command of code.json, the system prompt and "-p hello"
    And the runner was given the proxy port "4321" and the session token "tok"
    And the code tool stdout is "piped text"
    And the code tool stderr is "sandbox stderr"
    And the code tool stdin is destroyed
    And the proxy was started with the options of code.json and the session token "tok"
    And the proxy was revoked then closed

  Scenario: in a terminal, the session runs in the terminal and a signal exit gives 1
    Given a code tool session with the session token "tok" and the arguments "-c"
    And the session has a terminal, where the sandbox exits by a signal
    When I run the code tool
    Then the code tool exits with 1
    And the sandbox ran in the terminal with the command of code.json, the system prompt and "-c"
    And the proxy was revoked then closed

  Scenario: a worktree without its system prompt file runs the command of code.json without one
    Given a code tool session with the session token "tok" and the arguments "-p hi"
    And the worktree has no system prompt file
    When I run the code tool with "hi" on stdin
    Then the code tool exits with 0
    And the sandbox ran the command of code.json and "-p hi", without a system prompt

  Scenario: the system prompt file is read at the root of the worktree of INIT_CWD, when it exists
    Given a hand-written git layout for the linked worktree "w"
    And a process with INIT_CWD in "src" of the worktree "w"
    When I build the process dependencies with stdout not a terminal
    Then the system prompt of the dependencies is none
    Given the worktree "w" holds the file "CLAUDE.md"
    Then the system prompt of the dependencies is "CLAUDE.md" of the worktree "w"

  Scenario: a piped sandbox that exits by a signal gives 1
    Given a code tool session with the session token "tok" and the arguments "-p x"
    And the piped sandbox exits by a signal
    When I run the code tool
    Then the code tool exits with 1
    And the code tool stdin is destroyed and no longer piped

  Scenario: a runner that fails still revokes and closes the proxy
    Given a code tool session with the session token "tok" and the arguments "-p x"
    And the runner fails with "no srt"
    When I run the code tool
    Then the code tool fails with "no srt"
    And the proxy was revoked then closed

  Scenario: an unreadable host credential stops before any proxy
    Given a code tool session with the session token "tok" and the arguments "-p x"
    And the host credential cannot be read
    When I run the code tool
    Then the code tool fails with the sandbox error "ISOLATION_UNAVAILABLE" "ISOLATION_UNAVAILABLE: identifiant de l'hôte illisible : se connecter avec claude sur l'hôte"
    And no proxy was started

  Scenario: the process dependencies come from code.json, the environment and the arguments
    Given a process with INIT_CWD "/target", the cwd "/elsewhere" and the arguments "node code.ts -p x"
    When I build the process dependencies with standard streams that are terminals
    Then the dependencies run in "/target" with the arguments "-p x" in a terminal
    And the dependencies load the tool of code.json
    And the dependencies start the auth proxy of auth-proxy.ts
    And the dependencies give a fresh 64-hex session token each time
    And the dependencies build an srt runner for the variables "authProxyPort" "1" and "sessionToken" "t"
    And the dependencies pass the process streams through

  Scenario: without INIT_CWD the process runs in its cwd; one stream that is not a terminal means no terminal
    Given a process without INIT_CWD, the cwd "/elsewhere" and the arguments "node code.ts"
    When I build the process dependencies with stdout not a terminal
    Then the dependencies run in "/elsewhere" with the arguments "" without a terminal

  Scenario: the srt runner options of the code tool
    Given a process with INIT_CWD "/target", the cwd "/elsewhere" and the arguments "node code.ts"
    Then the srt options for the variables "authProxyPort" "1" and "sessionToken" "t" are those of the package

  Scenario Outline: a failure is reported on stderr with exit code 2: <case>
    When the code tool failure reporter gets <error>
    Then it returns 2 and writes "<line>" to stderr

    Examples:
      | case             | error                                      | line                         |
      | a sandbox error  | a sandbox error "PROFILE_INVALID" "no way" | architect-os code: PROFILE_INVALID: no way\n |
      | any other error  | the error "boom"                           | architect-os code: Error: boom\n |

  Scenario: with review.json, the session gets the launcher prompt and no worktree prompt
    Given a code tool session with the session token "tok" and the arguments "-p brief"
    And the session takes the tool and the system prompts of the dependencies of review.json
    When I run the code tool with "brief" on stdin
    Then the code tool exits with 0
    And the sandbox ran the profile "reviewer" with the command of review.json, the launcher prompt and "-p brief"

  Scenario: the dependencies of review.json leave the worktree prompt aside even when the worktree has one
    Given a hand-written git layout for the linked worktree "w"
    And the worktree "w" holds the file "CLAUDE.md"
    And a process with INIT_CWD in "src" of the worktree "w"
    When I build the process dependencies of the tool file "review.json"
    Then the dependencies load the tool of review.json
    And the system prompts of the dependencies are the launcher prompt only

  Scenario: a tool naming both prompt files passes the worktree one first, then the launcher one
    Given a hand-written git layout for the linked worktree "w"
    And the worktree "w" holds the file "CLAUDE.md"
    And a process with INIT_CWD in "src" of the worktree "w"
    And a tool file derived from code.json naming the system prompt file "CLAUDE.md" and the launcher prompt file "prompts/review.md"
    When I build the process dependencies of the stored tool file
    Then the system prompts of the dependencies are "CLAUDE.md" of the worktree "w", then the launcher prompt

  Scenario: the session passes one flag per system prompt, in order, after the command and before the arguments
    Given a code tool session with the session token "tok" and the arguments "-p x"
    And the session system prompts are "/a/first.md" and "/b/second.md"
    When I run the code tool with "x" on stdin
    Then the sandbox ran the command of code.json, the system prompts "/a/first.md" then "/b/second.md", and "-p x"

  Scenario: a named launcher prompt file that is missing is refused, naming the file
    Given a hand-written git layout for the linked worktree "w"
    And a process with INIT_CWD in "src" of the worktree "w"
    And a tool file derived from code.json naming the system prompt file "CLAUDE.md" and the launcher prompt file "prompts/absent.md"
    When I build the process dependencies of the stored tool file
    Then the system prompts of the dependencies are refused naming the launcher file "prompts/absent.md"

  Scenario: a session whose system prompts are refused stops before any proxy starts
    Given a code tool session with the session token "tok" and the arguments "-p x"
    And the session system prompts are refused with "no bar"
    When I run the code tool
    Then the code tool fails with the sandbox error "ISOLATION_UNAVAILABLE" "ISOLATION_UNAVAILABLE: no bar"
    And no proxy was started
