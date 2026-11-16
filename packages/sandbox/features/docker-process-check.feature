Feature: the check at start of the Docker adapter of a platform process
  Before it launches anything, the adapter checks that the daemon is rootless and that a canary container, launched
  with the options of a sandbox, is confined as the design says (docs/design/platform-v3-srt.md, §6). The docker client
  is the fake of docker-process.feature: it answers `info` with what the scenario gave it, and the canary connects to
  the socket of the mounted relay folder and prints a probe line built from what the scenario gave it, the good values
  by default. The relay and the listener of the check are real.

  Scenario: the check passes: the canary is launched with the options of a sandbox, and nothing of it is left
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness bounds the check to 10001 ms
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info exactly once, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the Docker client was asked for info 1 time and ran the canary 1 time
    And the canary run has the options of the sandbox run, up to the image
    And the canary run ends with
      """
      /srv/platform/packages/sandbox/dist/src/container-entry.js
      <port>
      --
      /usr/local/bin/node
      /srv/platform/packages/sandbox/dist/src/container-probe-entry.js
      {"port":<port>,"outside":{"host":"192.0.2.1","port":80},"boundMs":5001,"unwritable":["/","/srv/platform","/relay"],"writable":["/work","/config","/tmp","/home/aos"],"cgroup":"/sys/fs/cgroup"}
      """
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And the listener of the check is closed

  Scenario: the same check asked twice runs one check
    Given a Docker process harness with the variables "callbackPort=4100"
    When I check the Docker process runner
    And I check the Docker process runner
    Then the Docker process check succeeded
    And the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario: a check after a start that checked does not check again
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I check the Docker process runner
    Then the Docker process check succeeded
    And the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario: the check alone passes, and a start after it does not check again
    Given a Docker process harness with the variables "callbackPort=4100"
    When I check the Docker process runner
    Then the Docker process check succeeded
    And the Docker client was asked for info 1 time and ran the canary 1 time
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario Outline: a daemon that holds a rootless entry is accepted: <output>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '<output>', the error output '' and the exit code 0
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time

    Examples:
      | output                                                               |
      | ["name=rootless"]                                                    |
      | ["name=seccomp,profile=builtin","name=rootless,x=y","name=cgroupns"] |
      | ["name=seccomp,profile=builtin","name=rootless"][newline]            |

  Scenario: a docker client that warns on its error output and exits with 0 is judged on what it printed
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '["name=rootless"]', the error output 'WARNING: No swap limit support' and the exit code 0
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario Outline: a daemon that is not rootless, or that says nothing of it, is refused, and no container is launched: <output>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '<output>', the error output '' and the exit code 0
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with '<message>'
    And no container was launched by the Docker client
    And no relay folder exists

    Examples:
      | output                                           | message                                                                                                |
      | []                                               | ISOLATION_UNAVAILABLE: the daemon is not rootless: []                                                  |
      | ["name=seccomp,profile=builtin","name=cgroupns"] | ISOLATION_UNAVAILABLE: the daemon is not rootless: ["name=seccomp,profile=builtin","name=cgroupns"]    |
      | ["name=rootlessx"]                               | ISOLATION_UNAVAILABLE: the daemon is not rootless: ["name=rootlessx"]                                  |
      | ["xname=rootless"]                               | ISOLATION_UNAVAILABLE: the daemon is not rootless: ["xname=rootless"]                                  |
      | ["name=rootles,name=rootless"]                   | ISOLATION_UNAVAILABLE: the daemon is not rootless: ["name=rootles,name=rootless"]                      |
      | rootless                                         | ISOLATION_UNAVAILABLE: docker info printed "rootless", not a JSON array of strings                     |
      |                                                  | ISOLATION_UNAVAILABLE: docker info printed "", not a JSON array of strings                             |
      | null                                             | ISOLATION_UNAVAILABLE: docker info printed "null", not a JSON array of strings                         |

  Scenario Outline: an output that is JSON but not an array of strings is refused: <output>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '<output>', the error output '' and the exit code 0
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused matching '^ISOLATION_UNAVAILABLE: docker info printed <printed>, not a JSON array of strings$'
    And no container was launched by the Docker client

    Examples:
      | output                   | printed                |
      | {"name":"name=rootless"} | .*name=rootless.*      |
      | ["name=rootless",2]      | .*name=rootless.*,2.*  |
      | [2,"name=rootless"]      | .*2,.*name=rootless.*  |

  Scenario: an output of several lines is quoted by its first line
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output 'first[newline]second', the error output '' and the exit code 0
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: docker info printed "first", not a JSON array of strings'

  Scenario: a docker client that exits with another code than 0 is refused with the first line of its error output, whatever it printed
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '["name=rootless"]', the error output 'Cannot connect[newline]second line' and the exit code 1
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "ISOLATION_UNAVAILABLE: docker info: Cannot connect"
    And no container was launched by the Docker client
    And no relay folder exists

  Scenario: a docker client that exits with another code than 0 and says nothing is refused with the reason of the exit
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '["name=rootless"]', the error output '' and the exit code 3
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "ISOLATION_UNAVAILABLE: docker info: Command failed: "
    And no container was launched by the Docker client

  Scenario: a docker client that cannot be run is refused, and no container is launched
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness has no docker client
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "ISOLATION_UNAVAILABLE: docker info: spawn "
    And no relay folder exists

  Scenario: a docker info that does not end within the bound is refused
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness bounds the check to 300 ms
    And the fake docker client never ends info
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "ISOLATION_UNAVAILABLE: docker info: no answer within 300 ms"
    And no container was launched by the Docker client

  Scenario Outline: a wrong value read through the relay is refused: <json>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports "read" as '<json>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused matching '^ISOLATION_UNAVAILABLE: canary: value read through 127.0.0.1:[0-9]+: read <read>, expected ..content.:.[0-9a-f-]{36}..$'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | json                   | read                 |
      | {"content":"other"}    | ..content.:.other..    |
      | {"content":""}         | ..content.:...         |
      | {"error":"no answer"}  | ..error.:.no answer..  |
      | {"error":"ECONNRESET"} | ..error.:.ECONNRESET.. |
      | "x"                    | .x.                  |

  Scenario Outline: a container that is not the user of the sandbox, or has other interfaces than lo, is refused: <field> <json>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports "<field>" as '<json>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with '<message>'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | field      | json          | message                                                                                |
      | uid        | 0             | ISOLATION_UNAVAILABLE: canary: uid: read 0, expected 10001                             |
      | uid        | 10002         | ISOLATION_UNAVAILABLE: canary: uid: read 10002, expected 10001                         |
      | uid        | "10001"       | ISOLATION_UNAVAILABLE: canary: uid: read "10001", expected 10001                       |
      | interfaces | ["lo","eth0"] | ISOLATION_UNAVAILABLE: canary: network interfaces: read ["lo","eth0"], expected ["lo"] |
      | interfaces | ["eth0"]      | ISOLATION_UNAVAILABLE: canary: network interfaces: read ["eth0"], expected ["lo"]      |
      | interfaces | []            | ISOLATION_UNAVAILABLE: canary: network interfaces: read [], expected ["lo"]            |
      | interfaces | null          | ISOLATION_UNAVAILABLE: canary: network interfaces: read null, expected ["lo"]          |
      | writes     | null          | ISOLATION_UNAVAILABLE: canary: write in /: read nothing, expected {"error":"EROFS"}    |
      | writes     | ["/"]         | ISOLATION_UNAVAILABLE: canary: write in /: read nothing, expected {"error":"EROFS"}    |
      | cgroup     | "memory.max"  | ISOLATION_UNAVAILABLE: canary: memory.max: read nothing, expected {"content":"268435456"} |

  Scenario Outline: a connection outside that does not fail with ENETUNREACH is refused: <json>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports "outside" as '<json>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: connection to 192.0.2.1:80: read <json>, expected {"error":"ENETUNREACH"}'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | json                     |
      | {"error":"ECONNREFUSED"} |
      | {"content":"connected"}  |
      | {"error":"no answer"}    |
      | {"error":"EHOSTUNREACH"} |

  Scenario Outline: a write that does not fail with EROFS is refused: <path> <json>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports the write in '<path>' as '<json>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: write in <path>: read <json>, expected {"error":"EROFS"}'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | path          | json                  |
      | /             | {"error":"EACCES"}    |
      | /             | {"content":"written"} |
      | /srv/platform | {"error":"EACCES"}    |
      | /srv/platform | {"content":"written"} |
      | /relay        | {"error":"EACCES"}    |
      | /relay        | {"content":"written"} |

  Scenario Outline: a write that does not succeed in a tmpfs is refused: <path> <json>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports the write in '<path>' as '<json>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: write in <path>: read <json>, expected {"content":"written"}'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | path      | json               |
      | /work     | {"error":"EACCES"} |
      | /work     | {"error":"EROFS"}  |
      | /config   | {"error":"EACCES"} |
      | /config   | {"error":"EROFS"}  |
      | /tmp      | {"error":"EACCES"} |
      | /tmp      | {"error":"EROFS"}  |
      | /home/aos | {"error":"EACCES"} |
      | /home/aos | {"error":"EROFS"}  |

  Scenario Outline: a bound that the cgroup does not show is refused: <file> <json>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports the cgroup file '<file>' as '<json>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: <file>: read <json>, expected {"content":"<expected>"}'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | file            | json                    | expected  |
      | memory.max      | {"content":"268435457"} | 268435456 |
      | memory.max      | {"content":"268435455"} | 268435456 |
      | memory.max      | {"content":"max"}       | 268435456 |
      | memory.max      | {"error":"ENOENT"}      | 268435456 |
      | memory.swap.max | {"content":"1"}         | 0         |
      | memory.swap.max | {"content":"max"}       | 0         |
      | memory.swap.max | {"error":"ENOENT"}      | 0         |
      | pids.max        | {"content":"65"}        | 64        |
      | pids.max        | {"content":"63"}        | 64        |
      | pids.max        | {"content":"max"}       | 64        |
      | pids.max        | {"error":"EACCES"}      | 64        |

  Scenario: the refusal names the first condition that does not hold
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports "interfaces" as '["lo","eth0"]'
    And the probe of the fake docker client reports "uid" as '0'
    And the probe of the fake docker client reports the cgroup file 'pids.max' as '{"content":"max"}'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: uid: read 0, expected 10001'

  Scenario Outline: a probe that prints something else than the expected JSON is refused: <text>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client prints the text '<text>'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: the probe printed "<text>", not a JSON object'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | text     |
      | not json |
      | null     |
      | 5        |
      | true     |

  Scenario: a probe that prints a JSON array is refused for its first condition
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client prints the text '[]'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused matching '^ISOLATION_UNAVAILABLE: canary: value read through 127.0.0.1:[0-9]+: read nothing, expected'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

  Scenario Outline: a canary that prints nothing is refused with what it wrote on its error output: <said>
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client prints nothing
    And the canary of the fake docker client writes '<said>' on its error output
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: the container printed nothing; its error output: "<quoted>"'
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

    Examples:
      | said                                                                              | quoted                                                                     |
      |                                                                                   |                                                                            |
      | docker: Error response from daemon: No such image.[newline]Run docker run --help for more information[newline] | docker: Error response from daemon: No such image.\\nRun docker run --help for more information |
      | [newline]  Error: Cannot find module[newline]                                     | Error: Cannot find module                                                  |

  Scenario: a canary that prints an empty line is refused as one that prints nothing
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client prints the text ''
    And the canary of the fake docker client writes 'node: not found' on its error output
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with 'ISOLATION_UNAVAILABLE: canary: the container printed nothing; its error output: "node: not found"'

  Scenario: a canary whose client warns on its error output is judged on its report
    Given a Docker process harness with the variables "callbackPort=4100"
    And the canary of the fake docker client writes 'WARNING: the platform of the image does not match the host[newline]' on its error output
    When I check the Docker process runner
    Then the Docker process check succeeded

  Scenario: a canary that writes more than the bound of an output on its error output is refused
    Given a Docker process harness with the variables "callbackPort=4100"
    And the canary of the fake docker client writes 16385 bytes on its error output
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "ISOLATION_UNAVAILABLE: canary: OUTPUT_TOO_LARGE: "
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And no relay folder exists

  Scenario: a canary that writes exactly the bound of an output on its error output is judged on its report
    Given a Docker process harness with the variables "callbackPort=4100"
    And the canary of the fake docker client writes 16384 bytes on its error output
    When I check the Docker process runner
    Then the Docker process check succeeded

  Scenario: a canary whose removal cannot be run fails the check, which names the container that may be left
    Given a Docker process harness with the variables "callbackPort=4100"
    And the canary of the fake docker client removes the docker client of the harness
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused matching "^COMMAND_NOT_FOUND: container aos-sandbox-[0-9a-f-]{36} not removed: spawn .+ ENOENT$"
    And no relay folder exists
    And the listener of the check is closed

  Scenario: a probe that prints more than its bound is refused
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client prints a line of 16385 bytes
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused starting with "ISOLATION_UNAVAILABLE: canary: OUTPUT_TOO_LARGE: "
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

  Scenario: a probe that prints exactly its bound is accepted
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client prints a line of 16384 bytes
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario: a probe that does not end within the bound is refused
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness bounds the check to 300 ms
    And the probe of the fake docker client never ends
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "ISOLATION_UNAVAILABLE: canary: the probe has not ended within 300 ms"
    And every canary container was removed by its name, with only the environment "DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, HOME, PATH"
    And the relay folder of every canary is gone
    And no relay folder exists
    And the listener of the check is closed

  Scenario: another process of the host that resets a connection to the port of the check does not bring the host down
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client first resets a connection of its own to the port of the check
    When I check the Docker process runner
    Then the Docker process check succeeded
    And the listener of the check is closed

  Scenario: a relay folder that cannot be made leaves the check refused, and no container launched
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness has a temporary root with a path of 86 characters
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused matching "^ISOLATION_UNAVAILABLE: relay socket /.+/r-[^/]+/s: a path of 104 characters, more than 103$"
    And no container was launched by the Docker client
    And no relay folder exists

  Scenario: a start after a check that succeeded does not check again
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario: a start after a daemon with root checks again, and a daemon that came back is accepted
    Given a Docker process harness with the variables "callbackPort=4100"
    And the fake docker client answers info with the output '[]', the error output '' and the exit code 0
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "ISOLATION_UNAVAILABLE: the daemon is not rootless: []"
    When the fake docker client answers info as a rootless daemon again
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 2 times and ran the canary 1 time

  Scenario: a start after a canary that was refused checks again, and a refusal is not remembered as a success
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports "uid" as '0'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker process start is refused with "ISOLATION_UNAVAILABLE: canary: uid: read 0, expected 10001"
    When the probe of the fake docker client is good again
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 2 times and ran the canary 2 times
    And the canary run has the options of the sandbox run, up to the image

  Scenario: two starts at once share one check
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" twice at once and wait for the clients
    Then the Docker client was asked for info 1 time and ran the canary 1 time
    And the relay folder of every canary is gone
    And the listener of the check is closed

  Scenario: a module and a worker, each started with variables of its own, share one check
    Given a Docker process harness with the variables "callbackPort=4100"
    When I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And the Docker process harness now starts with the variables "brokerPort=4200, taskToken=tok-test"
    And I start the Docker process profile "worker" with the command "node task-serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time

  Scenario: a worker started with the variables of a module is refused: the variables are those of its own runner
    Given a Docker process harness with the variables "brokerPort=4200, taskToken=tok-test"
    When I start the Docker process profile "worker" with the command "node task-serve.js" and wait for the client
    And the Docker process harness now starts with the variables "callbackPort=4100"
    And I try to start the Docker process profile "worker" with the command "node task-serve.js"
    Then the Docker process start is refused with "PROFILE_INVALID: variable inconnue : ${brokerPort}"

  Scenario: two starts one after the other on a canary that is refused are both refused, each by a check of its own
    Given a Docker process harness with the variables "callbackPort=4100"
    And the probe of the fake docker client reports "uid" as '0'
    When I try to start the Docker process profile "module" with the command "node serve.js"
    And I try to start the Docker process profile "module" with the command "node serve.js"
    Then the Docker client was asked for info 2 times and ran the canary 2 times
