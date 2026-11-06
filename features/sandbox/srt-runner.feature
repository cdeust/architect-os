Feature: SandboxRunner contract on the real srt adapter
  Every scenario here starts real srt sandboxes: they run on Linux and macOS (bubblewrap, socat and ripgrep on Linux).
  The in-memory rows of the same contract are in packages/sandbox/features/runner-contract.feature.

  Scenario Outline: SandboxRunner contract: refuses an unknown profile
    Given a "<adapter>" sandbox runner
    When I try to start profile "nope" with command "cat"
    Then it is refused with "PROFILE_INVALID"

    Examples:
      | adapter |
      | srt     |

  Scenario Outline: SandboxRunner contract: runs the command with pipes: stdin in, stdout out, exit 0
    Given a "<adapter>" sandbox runner
    When I start profile "builder" with command "cat"
    And I send the line "ping" on its standard input and close it
    Then its standard output is the line "ping"
    And it exits with code 0

    Examples:
      | adapter |
      | srt     |

  Scenario Outline: SandboxRunner contract: stop() ends a running sandbox
    Given a "<adapter>" sandbox runner
    When I start profile "builder" with command "cat"
    And I stop it
    Then the exit code of the stop is not 0
    And its exit is the same as the exit of the stop

    Examples:
      | adapter |
      | srt     |

  Scenario: srt adapter removes the per-sandbox folder (profile, canary, tmp) once the sandbox ends
    Given an srt runner over a throwaway git repository
    And I note the entries of the temporary directory
    When I start profile "builder" with command "cat", close its input, drain its output and wait for it to end
    Then no per-sandbox folder is left in the temporary directory

  Scenario: srt adapter refuses to start when a trusted path is writable by the sandbox (the launcher inside the worktree)
    Given an srt runner over a throwaway git repository that trusts a launcher file inside the worktree
    When I try to start profile "builder" with command "cat"
    Then it is refused with "ISOLATION_UNAVAILABLE: chemin de confiance inscriptible"

  Scenario: srt adapter resolves the profile variables in the arguments of the command: ${config} is the session folder
    Given an srt runner over a throwaway git repository
    When I start profile "builder" with command "test -d ${config}", close its input, drain its output and wait for it to end
    Then it exits with code 0

  Scenario: srt adapter refuses an argument with an unknown variable
    Given an srt runner over a throwaway git repository
    When I try to start profile "builder" with command "echo ${nope}"
    Then it is refused with "PROFILE_INVALID: variable inconnue"

  Scenario: srt adapter runs a platform process in a disposable cwd, made in the folder of its sandbox, 0700, and removed with it
    Given an srt runner for the processes of the platform over a throwaway platform root
    And I note the entries of the temporary directory
    When I start profile "module" with command "node -p process.cwd()+':'+(require('fs').statSync('.').mode&511).toString(8)" and read its output to its end
    Then its output is a folder named "work" inside a per-sandbox folder, of mode "700"
    And no per-sandbox folder is left in the temporary directory

  Scenario: srt adapter lets a platform process read the platform root, never write it
    Given an srt runner for the processes of the platform over a throwaway platform root
    When I start profile "module" with command "node -p require('fs').readFileSync(process.argv[1]+'/marker','utf8') ${repo}" and read its output to its end
    Then its output is "platform"
    When I start profile "module" with command "touch ${repo}/written", close its input, drain its output and wait for it to end
    Then it does not exit with code 0
    And the platform root holds no file "written"
