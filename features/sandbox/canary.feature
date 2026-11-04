Feature: the canary of the srt adapter (platform-v3-srt.md, §6)
  Before every sandbox, srt runs a canary under the real profile: it must fail to read a file put in denyRead and to
  reach a port the host listens on. Any other verdict, or none, refuses the start with ISOLATION_UNAVAILABLE: no
  fallback, no run outside the sandbox. A lying canary stands for an srt that would let the read or the connection
  through.

  Scenario: the real canary lets the sandbox start
    Given an srt runner over a throwaway git repository
    When I start profile "builder" with command "true", close its input, drain its output and wait for it to end
    Then it exits with code 0

  Scenario Outline: a canary that says <verdict> refuses the start
    Given an srt runner over a throwaway git repository whose canary prints '<line>'
    When I try to start profile "builder" with command "true"
    Then it is refused with "ISOLATION_UNAVAILABLE: <message>"

    Examples:
      | verdict                   | line                                   | message                                      |
      | the read was allowed      | {"read":"allowed","connect":"denied"}  | canari : lecture allowed, connexion denied   |
      | the connection was allowed | {"read":"denied","connect":"allowed"} | canari : lecture denied, connexion allowed   |
      | nothing                   | not json                               | canari sans verdict : srt absent ou en échec |
