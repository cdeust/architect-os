Feature: the canary of the srt adapter (platform-v3-srt.md, §6)
  Before every sandbox, srt runs a canary under the real profile: it must fail to read a secret file that the adapter puts in
  a sibling folder of the sandbox's own, under the folder of all the sandboxes that the profile denies reading, and to
  reach a port the host listens on. The profile is the real one, unchanged: the canary adds nothing to it. Any other verdict, or none, refuses the start with ISOLATION_UNAVAILABLE: no
  fallback, no run outside the sandbox. A lying canary stands for an srt that would let the read or the connection
  through.

  Scenario: the real canary lets the sandbox start
    Given an srt runner over a throwaway git repository
    And I note the entries of the temporary directory
    When I start profile "builder" with command "true", close its input, drain its output and wait for it to end
    Then it exits with code 0
    And no per-sandbox folder is left in the temporary directory

  Scenario Outline: a canary that says <verdict> refuses the start
    Given an srt runner over a throwaway git repository whose canary prints '<line>'
    And I note the entries of the temporary directory
    When I try to start profile "builder" with command "true"
    Then it is refused with "ISOLATION_UNAVAILABLE: <message>"
    And no per-sandbox folder is left in the temporary directory

    Examples:
      | verdict                   | line                                   | message                                      |
      | the read was allowed      | {"read":"allowed","connect":"denied"}  | canari : lecture allowed, connexion denied   |
      | the connection was allowed | {"read":"denied","connect":"allowed"} | canari : lecture denied, connexion allowed   |
      | nothing                   | not json                               | canari sans verdict : srt absent ou en échec |

  Scenario: a profile that does not deny reading the folder of the sandboxes is refused: the canary reads a sibling folder
    Given an srt runner over a throwaway git repository whose builder profile does not deny reading the folder of the sandboxes
    And I note the entries of the temporary directory
    When I try to start profile "builder" with command "true"
    Then it is refused with "ISOLATION_UNAVAILABLE: canari : lecture allowed, connexion denied"
    And no per-sandbox folder is left in the temporary directory

  Scenario: the secret of the canary lives in a sibling folder of the sandbox, named after it, and is removed with the refusal
    Given an srt runner over a throwaway git repository whose canary reports the path of its secret as what it read
    And I note the entries of the temporary directory
    When I try to start profile "builder" with command "true"
    Then it is refused because the canary read a secret in the sibling folder of the sandbox
    And no per-sandbox folder is left in the temporary directory
