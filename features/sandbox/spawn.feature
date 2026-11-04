Feature: a hostile child under the srt adapter (platform-v3-srt.md, §6)
  The adapter launches in its own process group and kills the whole group: a descendant that ignores SIGTERM does
  not outlive its sandbox. An output beyond the bound is refused by readCapped and the sandbox stopped. A child that
  closes its standard input early does not bring the host down while it writes.

  Scenario: a descendant that ignores SIGTERM dies with its sandbox
    Given an srt runner over a throwaway git repository
    When I start profile "builder" with the hostile script "a descendant that ignores SIGTERM"
    And I read the pid the hostile script printed, then stop the sandbox
    Then the descendant is gone

  Scenario: an output beyond the bound is refused and the sandbox stopped
    Given an srt runner over a throwaway git repository
    When I start profile "builder" with the hostile script "five megabytes on stdout, then wait"
    And I read its stdout capped at 1048576 bytes, then stop the sandbox on refusal
    Then the capped read of the sandbox is refused with "OUTPUT_TOO_LARGE: sortie au-delà de 1048576 octets"
    And the stopped sandbox has exited

  Scenario: a child that closes stdin at once does not bring the host down while it writes two megabytes
    Given an srt runner over a throwaway git repository
    When I start profile "builder" with the hostile script "exit at once"
    And I write two megabytes on its stdin and wait for it to end
    Then it exits with code 0
