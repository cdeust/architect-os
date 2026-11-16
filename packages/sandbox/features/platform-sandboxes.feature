Feature: the sandboxes of a platform, by the means its operator chose
  platformSandboxes gives the check at start and the runner of a module or of a task, by srt or by Docker, as the
  operator wrote it: nothing is detected. With Docker it builds one runner for the platform, whose options refuse in
  their own words, and the docker client is resolved in the PATH of the environment it is given. The client is the fake
  of docker-process.feature. The runner it gives for srt is exercised by features/sandbox/gateway-entry.feature.

  Scenario: the check of Docker asks info, then runs a canary with the means and the root of the platform
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness reaches its fake client as docker through the PATH of its environment
    When I ask for the sandboxes of the platform by Docker with its good means
    And I check the sandboxes of the platform
    Then the Docker process check succeeded
    And the Docker client was asked for info 1 time and ran the canary 1 time
    And the canary run holds the means of the platform and the root of this repository
    And the Docker client was never run

  Scenario: a runner of the platform starts the profile module without a second check
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness reaches its fake client as docker through the PATH of its environment
    When I ask for the sandboxes of the platform by Docker with its good means
    And I check the sandboxes of the platform
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time
    And the sandbox of the Docker process run holds the image of the platform

  Scenario: two runners of two sets of variables share the one check
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness reaches its fake client as docker through the PATH of its environment
    When I ask for the sandboxes of the platform by Docker with its good means
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    And the Docker process harness now starts with the variables "callbackPort=4200"
    And I start the Docker process profile "module" with the command "node serve.js" and wait for the client
    Then the Docker client was asked for info 1 time and ran the canary 1 time
    And the entries of the Docker process runs are told the ports "4100, 4200"

  Scenario: an image without a digest is refused by platformSandboxes itself
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness reaches its fake client as docker through the PATH of its environment
    When I ask for the sandboxes of the platform by Docker with the image "node:22-alpine"
    Then the Docker process runner is refused starting with "ISOLATION_UNAVAILABLE: image without a digest"
    And the Docker client was never run

  Scenario: a PATH without docker makes the check refuse
    Given a Docker process harness with the variables "callbackPort=4100"
    And the PATH of the environment of the Docker process harness holds no docker
    When I ask for the sandboxes of the platform by Docker with its good means
    And I check the sandboxes of the platform
    Then the Docker process start is refused with "ISOLATION_UNAVAILABLE: docker info: spawn docker ENOENT"

  Scenario: the check of srt resolves and runs nothing
    Given a Docker process harness with the variables "callbackPort=4100"
    And the Docker process harness reaches its fake client as docker through the PATH of its environment
    When I ask for the sandboxes of the platform by srt and check them
    Then the Docker process check succeeded
    And the Docker client was never run
    And the Docker client was asked for info 0 time and ran the canary 0 time
