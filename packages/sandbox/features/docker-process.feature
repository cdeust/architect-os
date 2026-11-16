Feature: the Docker adapter of a platform process
  A module or a worker under Docker: the same profile templates as under srt, a container with no network at all, and
  the one loopback port of the template reached through a Unix socket of the sandbox. The docker client is a fake
  executable that records its arguments and its environment; the relay is real, with real sockets and real loopback
  listeners. No Docker daemon is needed.

  Scenario: the module container gets exactly these arguments
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node /srv/platform/modules/data/serve.js --flag $(id);`id`*&>/dev/null" and wait for the client
    Then the arguments of the Docker process run are exactly
      """
      run
      --rm
      -i
      --pull
      never
      --init
      --log-driver
      none
      --name
      <name>
      --network
      none
      --read-only
      --cap-drop
      ALL
      --security-opt
      no-new-privileges
      --security-opt
      apparmor=unconfined
      --user
      10001:10001
      --memory
      256m
      --memory-swap
      256m
      --pids-limit
      64
      --tmpfs
      /work:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --tmpfs
      /config:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --tmpfs
      /tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --tmpfs
      /home/aos:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --mount
      type=bind,source=/srv/platform,target=/srv/platform,readonly
      --mount
      type=bind,source=<folder>,target=/relay,readonly
      --workdir
      /work
      --entrypoint
      /usr/local/bin/node
      --env
      TMPDIR
      --env
      GATEWAY_CALLBACK_URL
      --env
      NODE_USE_ENV_PROXY
      --env
      HOME=/home/aos
      --env
      AOS_RELAY_SOCKET=/relay/s
      node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      /srv/platform/packages/sandbox/dist/src/container-entry.js
      4100
      --
      /usr/local/bin/node
      /srv/platform/modules/data/serve.js
      --flag
      $(id);`id`*&>/dev/null
      """
    And the container of the Docker process run has a unique name
    And the relay folder of the Docker process run is a folder of its own under the sandboxes parent

  Scenario: the worker container gets exactly these arguments
    Given a Docker process harness with the variables "brokerPort=4200, taskToken=tok-test"
    When I start the Docker process profile "worker" with the command "node /srv/platform/services/memory/worker/task-serve.js" and wait for the client
    Then the arguments of the Docker process run are exactly
      """
      run
      --rm
      -i
      --pull
      never
      --init
      --log-driver
      none
      --name
      <name>
      --network
      none
      --read-only
      --cap-drop
      ALL
      --security-opt
      no-new-privileges
      --security-opt
      apparmor=unconfined
      --user
      10001:10001
      --memory
      256m
      --memory-swap
      256m
      --pids-limit
      64
      --tmpfs
      /work:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --tmpfs
      /config:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --tmpfs
      /tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --tmpfs
      /home/aos:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700
      --mount
      type=bind,source=/srv/platform,target=/srv/platform,readonly
      --mount
      type=bind,source=<folder>,target=/relay,readonly
      --workdir
      /work
      --entrypoint
      /usr/local/bin/node
      --env
      TMPDIR
      --env
      CLAUDE_CODE_TMPDIR
      --env
      CLAUDE_CONFIG_DIR
      --env
      ANTHROPIC_BASE_URL
      --env
      ANTHROPIC_API_KEY
      --env
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
      --env
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      --env
      DISABLE_AUTOUPDATER
      --env
      DISABLE_TELEMETRY
      --env
      HOME=/home/aos
      --env
      AOS_RELAY_SOCKET=/relay/s
      node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      /srv/platform/packages/sandbox/dist/src/container-entry.js
      4200
      --
      /usr/local/bin/node
      /srv/platform/services/memory/worker/task-serve.js
      """
    And the Docker client of the process run holds in its own environment "ANTHROPIC_API_KEY=tok-test, ANTHROPIC_BASE_URL=http://127.0.0.1:4200, CLAUDE_CONFIG_DIR=/config, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0"
    And no argument of the Docker process run holds "tok-test"

  Scenario: the variables of the profile are resolved in the arguments of the program, as under srt
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node ${repo}/modules/memory/dist/src/serve.js ${worktree} ${worktreeName} ${tmp} ${config} ${home} ${sandboxes}" and wait for the client
    Then the program of the Docker process run is given the arguments "/srv/platform/modules/memory/dist/src/serve.js /work work /tmp /config /home/aos /sandboxes"

  Scenario Outline: a variable of the launcher in an argument of the program is refused, and nothing is launched: <variable>
    Given a Docker process harness with the variables "brokerPort=4200, taskToken=tok-test"
    When I try to start the Docker process profile "worker" with the command "node ${repo}/task-serve.js ${<variable>}"
    Then the Docker process start is refused with "PROFILE_INVALID: variable inconnue : ${<variable>}"
    And the Docker client was asked for info 0 times and ran the canary 0 times
    And the Docker client was never run
    And no relay folder exists

    Examples:
      | variable        |
      | taskToken       |
      | brokerPort      |
      | subprocessScrub |
      | nothingKnown    |

  Scenario: nothing of the host environment reaches the container
    Given a Docker process harness with the variables "callbackPort=4100"
    And the host environment also holds "SECRET=s3cret-host-value, ANTHROPIC_API_KEY=host-key, LANG=C.UTF-8, NO_PROXY=host-proxy"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the container of the Docker process run is given by name the variables "TMPDIR, GATEWAY_CALLBACK_URL, NODE_USE_ENV_PROXY", and by value "HOME=/home/aos, AOS_RELAY_SOCKET=/relay/s"
    And no argument of the Docker process run holds "s3cret-host-value", "host-key", "C.UTF-8" or "host-proxy"
    And the Docker client of the process run saw only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, GATEWAY_CALLBACK_URL, HOME, NODE_USE_ENV_PROXY, PATH, TMPDIR"
    And the Docker client of the process run holds in its own environment "GATEWAY_CALLBACK_URL=http://127.0.0.1:4100/mcp, TMPDIR=/tmp"

  Scenario Outline: an image that does not carry a digest is refused
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner with the image "<image>"
    Then the Docker process runner is refused starting with "ISOLATION_UNAVAILABLE: image without a digest"

    Examples:
      | image                                                                              |
      | node:22-alpine                                                                     |
      | node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa        |
      | node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa      |
      | node@sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA       |
      | node@sha256:gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa       |
      | node@sha512:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa       |
      | @sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa           |
      | -node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa      |
      | a b@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa        |
      | a@b@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa        |
      | node:22@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa x  |

  Scenario Outline: an image that carries a digest is accepted
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner with the image "<image>"
    Then the Docker process runner is built

    Examples:
      | image                                                                              |
      | n@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef          |
      | registry.example:5000/team/node:22@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |

  Scenario Outline: a template whose network is not exactly one loopback port is refused, nothing is launched
    Given a Docker process harness with the variables "callbackPort=4100"
    And the network of the profile "module" is allowed '<allowed>' and denied '<denied>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "PROFILE_INVALID: module : the network must be exactly one entry"
    And the Docker client was never run
    And no relay folder exists

    Examples:
      | allowed                                    | denied               |
      | ["127.0.0.1:4100", "127.0.0.1:4101"]       | []                   |
      | ["10.0.0.1:4100"]                          | []                   |
      | ["localhost:4100"]                         | []                   |
      | ["127.0.0.1"]                              | []                   |
      | ["127.0.0.1:"]                             | []                   |
      | ["127.0.0.1:41x"]                          | []                   |
      | ["127x0x0x1:4100"]                         | []                   |
      | ["x127.0.0.1:4100"]                        | []                   |
      | ["127.0.0.1:4100"]                         | ["example.com"]      |
      | []                                         | []                   |
      | ["127.0.0.1:0"]                            | []                   |
      | ["127.0.0.1:65536"]                        | []                   |
      | ["127.0.0.1:123456"]                       | []                   |

  Scenario Outline: the bounds of the port are accepted
    Given a Docker process harness with the variables "callbackPort=<port>"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the entry of the Docker process run is told the port "<port>"

    Examples:
      | port  |
      | 1     |
      | 65535 |

  Scenario Outline: a port outside the bounds, given by the launcher, is refused
    Given a Docker process harness with the variables "callbackPort=<port>"
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "PROFILE_INVALID: module : the network must be exactly one entry"
    And the Docker client was never run
    And no relay folder exists

    Examples:
      | port  |
      | 0     |
      | 65536 |

  Scenario Outline: a profile that cannot be loaded or resolved is refused, nothing is launched
    Given a Docker process harness with the variables "callbackPort=4100"
    When I try to start the Docker process profile "<profile>" with the command "node serve.js"
    Then the Docker process start is refused with "<message>"
    And the Docker client was never run
    And no relay folder exists

    Examples:
      | profile | message                                       |
      | nope    | PROFILE_INVALID: profil inconnu : nope        |
      | worker  | PROFILE_INVALID: variable inconnue : ${brokerPort} |

  Scenario Outline: a command that does not start with node is refused, nothing is launched
    Given a Docker process harness with the variables "callbackPort=4100"
    When I try to start the Docker process profile "module" with the command "<command>"
    Then the Docker process start is refused starting with "COMMAND_NOT_FOUND: argv[0] must be node"
    And the Docker client was never run
    And no relay folder exists

    Examples:
      | command      |
      | sh -c id     |
      |              |

  Scenario: a docker client that can no longer be found after the check is COMMAND_NOT_FOUND and leaves no relay folder
    Given a Docker process harness with the variables "callbackPort=4100"
    When I check the Docker process runner
    Then the Docker process check succeeded
    When the docker client of the harness is removed
    And I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "COMMAND_NOT_FOUND: docker client not started: spawn "
    And no relay folder exists

  Scenario: an argument the docker client cannot be started with is COMMAND_NOT_FOUND and leaves no relay folder
    Given a Docker process harness with the variables "callbackPort=4100"
    When I try to start the Docker process profile "module" with the command "node a[nul]b"
    Then the Docker process start is refused starting with "COMMAND_NOT_FOUND: docker client not started: "
    And the Docker client was never run
    And no relay folder exists

  Scenario: a relay socket path of 103 characters is accepted
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness has a temporary root with a path of 85 characters
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the relay folder of the Docker process run is a folder of its own under the sandboxes parent

  Scenario: a relay socket path of 104 characters is refused on every host, and leaves no relay folder
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness has a temporary root with a path of 86 characters
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused matching "^ISOLATION_UNAVAILABLE: relay socket /.+/r-[^/]+/s: a path of 104 characters, more than 103$"
    And the Docker client was never run
    And no relay folder exists

  Scenario Outline: a platform root or a temporary root that a mount cannot carry is refused: <case>
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner whose path option <which> is '<path>'
    Then the Docker process runner is refused with 'ISOLATION_UNAVAILABLE: not a path a mount can carry: <path>'

    Examples:
      | case                          | which   | path           |
      | a relative root               | root    | srv/platform   |
      | a root with a comma           | root    | /srv/plat,form |
      | a root with a double quote    | root    | /srv/a"b       |
      | the root of the host          | root    | /              |
      | an empty root                 | root    |                |
      | a relative temporary          | tmpRoot | tmp/aos        |
      | a temporary with a comma      | tmpRoot | /tmp/a,b       |
      | a temporary with double quote | tmpRoot | /tmp/a"b       |

  Scenario Outline: a node of the image that is not an absolute path is refused: <case>
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner whose path option node is '<path>'
    Then the Docker process runner is refused with 'ISOLATION_UNAVAILABLE: node is not an absolute path of the image: <path>'

    Examples:
      | case            | path     |
      | a name          | node     |
      | a relative path | bin/node |
      | empty           |          |

  Scenario: a platform root with a control character is refused
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner whose path option root is "/srv/a[newline]b"
    Then the Docker process runner is refused starting with "ISOLATION_UNAVAILABLE: not a path a mount can carry: /srv/a"

  Scenario Outline: a platform root or a temporary root with <case> is accepted
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner whose path option <which> is "<path>"
    Then the Docker process runner is built

    Examples:
      | case                  | which   | path              |
      | a space               | root    | /srv/my platform  |
      | an equals sign        | tmpRoot | /tmp/a=b          |
      | a non-ASCII character | root    | /srv/plateforme-é |

  Scenario Outline: a bound that does not bound is refused: <which> <value>
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner whose bound <which> is <value>
    Then the Docker process runner is refused with "ISOLATION_UNAVAILABLE: <which> is not a whole number of at least <least>: <value>"

    Examples:
      | which          | value            | least |
      | memoryMiB      | 5                | 6     |
      | memoryMiB      | 0                | 6     |
      | memoryMiB      | -1               | 6     |
      | memoryMiB      | 6.5              | 6     |
      | memoryMiB      | 9007199254740992 | 6     |
      | pidsLimit      | 0                | 1     |
      | pidsLimit      | -1               | 1     |
      | pidsLimit      | 1.5              | 1     |
      | checkTimeoutMs | 0                | 1     |
      | checkTimeoutMs | -1               | 1     |
      | checkTimeoutMs | 1.5              | 1     |

  Scenario Outline: a bound from its least value to the largest exact whole number is accepted: <which> <value>
    Given a Docker process harness with the variables "callbackPort=4100"
    When I build a Docker process runner whose bound <which> is <value>
    Then the Docker process runner is built

    Examples:
      | which          | value            |
      | memoryMiB      | 6                |
      | pidsLimit      | 1                |
      | checkTimeoutMs | 1                |
      | pidsLimit      | 9007199254740991 |

  Scenario Outline: a template that sets a variable of the docker client or of the adapter is refused, and nothing is launched: <name>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the profile "module" also sets the variable "<name>"
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "PROFILE_INVALID: module : <name> is a variable of the docker client or of the adapter"
    And the Docker client was never run
    And no relay folder exists

    Examples:
      | name              |
      | DOCKER_HOST       |
      | DOCKER_TLS_VERIFY |
      | PATH              |
      | HOME              |
      | AOS_RELAY_SOCKET  |

  Scenario: launcher variables named like those of the adapter, or that the template does not use, change nothing
    Given a Docker process harness with the variables "callbackPort=4100, tmp=/evil-tmp, repo=/evil-repo, sandboxes=/evil-sb, taskToken=tok-unused"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client of the process run holds in its own environment "TMPDIR=/tmp, GATEWAY_CALLBACK_URL=http://127.0.0.1:4100/mcp"
    And no argument of the Docker process run holds "/evil-tmp", "/evil-repo", "/evil-sb" or "tok-unused"

  Scenario: a template that declares files is refused, and nothing is launched
    Given a Docker process harness with the variables "callbackPort=4100"
    And the profile "module" also declares the file "${tmp}/settings.json"
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "PROFILE_INVALID: module : the template declares files, which this adapter does not write"
    And the Docker client was never run
    And no relay folder exists

  Scenario: the reviewer template, made for srt and its files, is refused, and nothing is launched
    Given a Docker process harness with the variables "authProxyPort=4300, sessionToken=tok-session"
    When I try to start the Docker process profile "reviewer" with the command "node serve.js"
    Then the Docker process start is refused with "PROFILE_INVALID: reviewer : the template declares files, which this adapter does not write"
    And the Docker client was never run
    And no relay folder exists

  Scenario: the relay folder and its socket let the user of the container connect, and no one else get in
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the sandboxes parent has the mode "700"
    And the relay folder of the Docker process run has the mode "755"
    And the relay socket of the Docker process run is a socket of the mode "666"

  Scenario: a connection to the socket of the sandbox reaches the listener of the port and gets its answer, no other
    Given a loopback listener that answers "first" is the callback port
    And a second loopback listener that answers "second" on another port
    And a Docker process harness with the variables taken from the callback port
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I connect to the relay socket of the Docker process, send "ping" and read the answer
    Then the answer through the relay is "first:ping"
    And the first listener was reached 1 time and the second listener 0 times

  Scenario: a client that ends its request still reads its answer
    Given a loopback listener that answers "first" once its client has ended is the callback port
    And a Docker process harness with the variables taken from the callback port
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I connect to the relay socket of the Docker process, send "ping", end my side and read the answer
    Then the answer through the relay is "first:ping"

  Scenario: a listener that ends its answer still reads the rest of the request
    Given a loopback listener that says "hello", ends its side and keeps what it then receives is the callback port
    And a Docker process harness with the variables taken from the callback port
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I connect to the relay socket of the Docker process, read until its end, then send "late" and end my side
    Then the answer through the relay is "hello"
    And the listener of the callback port received "late"

  Scenario: a port that nothing listens on closes the connection
    Given a Docker process harness with the variables taken from a port nothing listens on
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I connect to the relay socket of the Docker process, send "ping" and read the answer
    Then the answer through the relay is ""

  Scenario: a connection its client leaves is closed at the listener of the port while the sandbox still runs
    Given a loopback listener that holds its connections open is the callback port
    And a Docker process harness with the variables taken from the callback port
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I open a connection through the relay of the Docker process and wait until the listener holds it
    And I close my end of the connection through the relay
    Then the listener of the callback port sees the connection closed
    And the relay socket of the Docker process run is a socket of the mode "666"

  Scenario: stop kills the client, removes the container by its name, closes the relay and cuts its connections
    Given a loopback listener that holds its connections open is the callback port
    And a Docker process harness with the variables taken from the callback port
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I open a connection through the relay of the Docker process and wait until the listener holds it
    And I stop the Docker process sandbox
    Then the Docker process sandbox exited by the signal "SIGKILL"
    And the fake client of the process run was asked for the removal of its container with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay of the Docker process is closed and its folder removed
    And the connection through the relay is cut and the listener sees it closed

  Scenario: stop called twice tells the same end twice, and asks for one removal
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I stop the Docker process sandbox
    And I stop the Docker process sandbox
    Then the Docker process sandbox exited by the signal "SIGKILL"
    And the fake client of the process run was asked 1 time for a removal
    And the relay of the Docker process is closed and its folder removed

  Scenario: two sandboxes at once: stopping the second leaves the relay of the first one serving
    Given a loopback listener that answers "first" is the callback port
    And a Docker process harness with the variables taken from the callback port
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I stop the Docker process sandbox
    And I connect to the relay socket of the Docker process, send "ping" and read the answer
    Then the Docker process sandbox exited by the signal "SIGKILL"
    And the answer through the relay is "first:ping"

  Scenario: stop says which container may be left when the docker client can no longer be run
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And the docker client of the harness is removed
    And I try to stop the Docker process sandbox and wait for the end of its client
    Then the Docker process stop is refused matching "^COMMAND_NOT_FOUND: container aos-sandbox-[0-9a-f-]{36} not removed: spawn .+ ENOENT$"
    And the Docker process sandbox exited by the signal "SIGKILL"
    And the relay of the Docker process is closed and its folder removed

  Scenario: a relay folder that something else removed does not keep the sandbox from ending
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And the relay folder of the Docker process is removed by something else
    And I stop the Docker process sandbox
    Then the Docker process sandbox exited by the signal "SIGKILL"

  Scenario: when the client exits by itself the relay is closed, and the container removed by its name before the end is told
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node exit" and wait for its end
    Then the Docker process sandbox exited with 7
    And the fake client of the process run was asked for the removal of its container with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay of the Docker process is closed and its folder removed

  Scenario: a client that closes its stdin early does not bring the host down
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node close-stdin", write 1000000 bytes on its stdin and wait for its end
    Then the Docker process sandbox exited with 0
