Feature: no profile escapes its srt sandbox (platform-v3-srt.md, §8, exit of brick 1b)
  Every kind of profile, builder, reviewer, module and worker, runs eight attacks, each a real command inside a real
  srt sandbox, over a throwaway home. Every attack fails, and the failure is observed on the host, not trusted from an
  exit code: the marker of the secret never appears in the output, the file written outside or the hook does not exist
  on the host afterwards, the host's listener on the Postgres socket accepted no connection, curl obtained no HTTP
  response (its code is 000), no nested user namespace was made.

  The bait, laid out by the host for each scenario: a throwaway home whose `.ssh/id_test` holds a marker; the hook
  `.git/hooks/pre-commit` of the repository (of the platform root for module and worker); a Unix socket
  `.s.PGSQL.5432` on which the host listens (no real Postgres: the macOS job has none); a folder shaped like another
  sandbox's, `aos-sb/s-other…/tmp/secret`, mode 0700, beside the sandbox's own folder, holding the marker.
  example.com is reached twice in its row, once through the proxy variables of the environment, as a normal program
  does, and once by a direct connection; 169.254.169.254 is reached directly on port 80, with a short timeout.

  The witness runs the five local attacks as the same commands on the host, without srt: they succeed, so each is a
  real attack. The three others have no witness: example.com and 169.254.169.254 would reach the real network, and
  `unshare` does not exist on macOS. There the start of `unshare -r true` is refused as a command not found, and the
  row passes because the command is absent, not because srt refused the namespace; on Linux it runs and must fail.

  The positive control: a sandbox that cannot write would pass every attack above. Each profile writes a file in each of
  its own writable folders under its sandbox folder (`${tmp}`, `${config}`, the disposable cwd) and reads it back.

  Scenario Outline: profile <profile> cannot escape its srt sandbox: <attack>
    Given an srt runner for profile "<profile>" over a throwaway home, beside the bait of every escape attack
    When it runs the escape attack "<attack>" inside its sandbox
    Then the escape attack failed, as the host observes it

    Examples:
      | profile  | attack                                                                 |
      | builder  | reads the fake secret of the home                                      |
      | builder  | writes a file directly under the home                                  |
      | builder  | writes the pre-commit hook of the repository                           |
      | builder  | reaches example.com, through the proxy of its environment and directly |
      | builder  | reaches 169.254.169.254 on port 80                                     |
      | builder  | reaches the Postgres socket                                            |
      | builder  | reads the folder of another task                                       |
      | builder  | makes a nested user namespace                                          |
      | reviewer | reads the fake secret of the home                                      |
      | reviewer | writes a file directly under the home                                  |
      | reviewer | writes the pre-commit hook of the repository                           |
      | reviewer | reaches example.com, through the proxy of its environment and directly |
      | reviewer | reaches 169.254.169.254 on port 80                                     |
      | reviewer | reaches the Postgres socket                                            |
      | reviewer | reads the folder of another task                                       |
      | reviewer | makes a nested user namespace                                          |
      | module   | reads the fake secret of the home                                      |
      | module   | writes a file directly under the home                                  |
      | module   | writes the pre-commit hook of the repository                           |
      | module   | reaches example.com, through the proxy of its environment and directly |
      | module   | reaches 169.254.169.254 on port 80                                     |
      | module   | reaches the Postgres socket                                            |
      | module   | reads the folder of another task                                       |
      | module   | makes a nested user namespace                                          |
      | worker   | reads the fake secret of the home                                      |
      | worker   | writes a file directly under the home                                  |
      | worker   | writes the pre-commit hook of the repository                           |
      | worker   | reaches example.com, through the proxy of its environment and directly |
      | worker   | reaches 169.254.169.254 on port 80                                     |
      | worker   | reaches the Postgres socket                                            |
      | worker   | reads the folder of another task                                       |
      | worker   | makes a nested user namespace                                          |

  Scenario Outline: witness: without srt, the local attack succeeds on the host: <attack>
    Given a throwaway git repository and a throwaway home, beside the bait of every escape attack, and no sandbox
    When the host runs the escape attack "<attack>" itself, without srt
    Then the escape attack succeeded, as the host observes it

    Examples:
      | attack                                       |
      | reads the fake secret of the home            |
      | writes a file directly under the home        |
      | writes the pre-commit hook of the repository |
      | reaches the Postgres socket                  |
      | reads the folder of another task             |

  Scenario Outline: positive control: profile <profile> writes a file in its own folder <folder> and reads it back
    Given an srt runner for profile "<profile>" over a throwaway home, beside the bait of every escape attack
    When it writes a file in its own folder "<folder>" inside its sandbox and reads it back
    Then the content read back is the one written

    Examples:
      | profile  | folder     |
      | builder  | tmp        |
      | builder  | config     |
      | reviewer | tmp        |
      | reviewer | config     |
      | module   | tmp        |
      | module   | disposable |
      | worker   | tmp        |
      | worker   | config     |
      | worker   | disposable |
