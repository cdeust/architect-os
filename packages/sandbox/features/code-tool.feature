Feature: the code tool of 1a.0, composed from code.json (host side, fake runner, fake proxy)
  `npm run code` runs claude under srt in the current worktree. code.ts only hands the process to runCodeTool;
  everything it does is here.

  Scenario: without a terminal, the session pipes stdio through the sandbox and ends with its exit code
    Given a code tool session with the session token "tok" and the arguments "-p hello"
    When I run the code tool with "piped text" on stdin
    Then the code tool exits with 0
    And the sandbox ran the profile "builder" in "/work" with claude, the plugin directories of code.json and "-p hello"
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
    And the sandbox ran in the terminal with claude, the plugin directories of code.json and "-c"
    And the proxy was revoked then closed

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
    And the dependencies load the tool of code.json and its plugin directories under the repository
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
