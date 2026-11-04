Feature: the Docker adapter of the SandboxRunner port
  Only where srt is not supported, chosen by configuration. Its hardened options are those of the former
  services/memory docker runner, taken over without extension. Here the docker client is a fake executable that
  records its arguments and environment, echoes stdin to stdout and exits; no Docker daemon is needed.

  Scenario: the container gets a read-only filesystem, no capability, no escalation, a non-root user
    When I build the docker arguments of the test options for the container "c1" and the argv "--flag"
    Then the docker arguments start with "run --rm -i --name c1 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges --user 10001:10001"
    And the docker argument after "--network" is "exec"
    And the docker argument after "--memory" is "256m"
    And the docker argument after "--pids-limit" is "64"
    And the docker arguments forward only the environment "INTERNAL_TOOLS_URL=http://memory:8083"
    And the docker arguments end with "worker:test --flag"

  Scenario: a profile other than the configured one is refused
    Given a Docker sandbox runner with the fake docker client
    When I try to start the Docker profile "builder"
    Then the Docker start is refused with "PROFILE_INVALID: profil inconnu de l'adaptateur Docker : builder"

  Scenario: a missing docker client is COMMAND_NOT_FOUND
    Given a Docker sandbox runner whose docker client does not exist
    When I try to start the Docker profile "memory-worker"
    Then the Docker start is refused starting with "COMMAND_NOT_FOUND: client Docker introuvable"

  Scenario: the input goes in on stdin, the output comes back on stdout, the exit code is the client's
    Given a Docker sandbox runner with the fake docker client
    When I start the Docker profile "memory-worker", send "ping" and wait for the end
    Then the Docker sandbox printed "ping" and exited with 7
    And the fake docker client was run with a container named "aos-sandbox-" and a UUID
    And the fake docker client saw only the environment "DOCKER_CONFIG, HOME, PATH"

  Scenario: stop kills the client and removes the container by its name
    Given a Docker sandbox runner with the fake docker client
    When I start the Docker profile "memory-worker" with the image "hang" and stop it
    Then the Docker sandbox exited by the signal "SIGKILL"
    And the fake docker client was asked to remove the container it ran
