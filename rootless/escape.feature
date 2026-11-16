Feature: no profile of the platform escapes its container (docs/design/platform-v3-srt.md, §8, exit of brick 1b.6b)
  The escape test of brick 1b (features/sandbox/escape.feature), replayed for the Docker mode: the profiles module and
  worker, the two the platform launches, each run the attacks below, each a real command inside a real container
  started by the Docker adapter before a real rootless daemon. The failure is observed on the host, as under srt: the
  marker of the secret never appears, the file or the hook does not exist on the host afterwards, the host's listener
  accepted no connection, no HTTP response was obtained, no nested user namespace was made.

  The bait is the one of the srt test, laid out by the host in the real home of its user: a mount of that home, or of
  its parent, would show it at the same path, where a bait under a temporary folder would be hidden by the tmpfs of the
  container whatever the adapter mounted. The platform root is a throwaway one (the compiled sandbox package and its
  profiles, in a git repository whose hook is the bait). A container starts no program but the node of its image: each
  command of an attack is run by that node, with the same arguments, outputs and exit code. The image holds no curl,
  so the two network attacks ask node for the same answer, `000` for none; and a container is given no proxy variable,
  so "through the proxy of its environment" and "directly" are the same request here.
  The witness of each local attack, the same command on the host, is in features/sandbox/escape.feature.

  Three things belong to this mode. A port of the loopback of the host that the profile does not allow, where a
  listener of the host answers: the relay gives one port, not the loopback. The socket of a Docker daemon, the rootless
  one and, where the host has one, the one with root. And the folder of another task, which here is another container
  of the same platform: its own folders, its relay folder, and what the sandbox finds in its own relay folder.

  What a container reads of the platform root is recorded, not refused: the root is mounted in it whole and read-only,
  and its user is neither root nor the user of the host, so it reads there what any other user of the host can read.

  The controls: a container that could run nothing would pass every attack. The three programs of the attacks run in
  each profile when they attack nothing, and each profile writes a file in each of its own folders and reads it back.

  Scenario Outline: profile <profile> cannot escape its container: <attack>
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    When it runs the escape attack "<attack>" inside its sandbox
    Then the escape attack failed, as the host observes it

    Examples:
      | profile | attack                                                                 |
      | module  | reads the fake secret of the home                                      |
      | module  | writes a file directly under the home                                  |
      | module  | writes the pre-commit hook of the repository                           |
      | module  | reaches example.com, through the proxy of its environment and directly |
      | module  | reaches 169.254.169.254 on port 80                                     |
      | module  | reaches the Postgres socket                                            |
      | module  | makes a nested user namespace                                          |
      | worker  | reads the fake secret of the home                                      |
      | worker  | writes a file directly under the home                                  |
      | worker  | writes the pre-commit hook of the repository                           |
      | worker  | reaches example.com, through the proxy of its environment and directly |
      | worker  | reaches 169.254.169.254 on port 80                                     |
      | worker  | reaches the Postgres socket                                            |
      | worker  | makes a nested user namespace                                          |

  Scenario Outline: profile <profile> reads nothing of another container of the same platform
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    When another sandbox of the same platform holds a marker in each of its own folders, and it looks for it from its own sandbox
    Then it found neither the marker nor anything of the other sandbox, and its relay folder holds its own socket alone

    Examples:
      | profile |
      | module  |
      | worker  |

  Scenario Outline: profile <profile> reaches no port of the loopback of the host but the one of its profile
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    When it tries, inside its sandbox, a port of the loopback of the host that its profile does not allow, where a listener answers
    Then the listener of the host saw no connection of the sandbox, which was refused the connection

    Examples:
      | profile |
      | module  |
      | worker  |

  Scenario Outline: profile <profile> does not reach the socket of the <daemon> daemon
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    When it tries, inside its sandbox, the socket of the <daemon> daemon of the host
    Then the sandbox did not reach that socket, which does not exist for it

    Examples:
      | profile | daemon    |
      | module  | rootless  |
      | module  | with root |
      | worker  | rootless  |
      | worker  | with root |

  Scenario Outline: profile <profile> reads of the platform root what any other user of the host can read, and no more
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    And the platform root holds a file others can read and a file of its owner alone, each with a marker
    When it reads both files of the platform root inside its sandbox
    Then it read the file others can read, and was refused the file of the owner alone

    Examples:
      | profile |
      | module  |
      | worker  |

  Scenario Outline: control: in a container of profile <profile>, the program of an attack runs when it attacks nothing: <program>
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    When it runs the program "<program>" inside its sandbox, as an attack is run
    Then that program ended with the code 0

    Examples:
      | profile | program                                   |
      | module  | cat ${repo}/packages/sandbox/package.json |
      | module  | touch ${tmp}/control                      |
      | module  | unshare --version                         |
      | worker  | cat ${repo}/packages/sandbox/package.json |
      | worker  | touch ${tmp}/control                      |
      | worker  | unshare --version                         |

  Scenario Outline: positive control: profile <profile> writes a file in its own folder <folder> and reads it back
    Given a Docker runner for profile "<profile>" over a throwaway platform root, before the rootless daemon of this host, beside the bait of every escape attack
    When it writes a file in its own folder "<folder>" inside its sandbox and reads it back
    Then the content read back is the one written

    Examples:
      | profile | folder     |
      | module  | tmp        |
      | module  | disposable |
      | worker  | tmp        |
      | worker  | config     |
      | worker  | disposable |
