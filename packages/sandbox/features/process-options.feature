Feature: the options of the srt runner of a platform process
  processRunnerOptions gives the gateway, and the scenarios under srt, the one description of how a module or a worker
  is run: the committed profiles and the canary of the package, the pinned srt, a disposable working directory, nothing
  trusted, and of the host only a closed PATH and the home folder. The gateway does not resolve srt itself.

  Scenario: the options of a platform process, for a platform root and a node
    When the options of a platform process are made for the root "/opt/platform", the node "/opt/node/bin/node" and the variables '{"callbackPort":"4100"}'
    Then the options of the platform process are, with the home and the temporary folder of this host:
      """
      {
        "profilesDir": "/opt/platform/packages/sandbox/profiles",
        "node": "/opt/node/bin/node",
        "canaryProbe": "/opt/platform/packages/sandbox/src/canary-probe.mjs",
        "tmpRoot": "<tmp>",
        "home": "<home>",
        "hostEnv": { "PATH": "/opt/node/bin:/usr/bin:/bin", "HOME": "<home>" },
        "trusted": [],
        "variables": { "callbackPort": "4100" },
        "workspace": "disposable"
      }
      """
    And the srt of the platform process is the cli.js of the installed sandbox runtime, a file that exists

  Scenario: for the root of this repository, the profiles and the canary of the options exist
    When the options of a platform process are made for the root of this repository
    Then the profiles "module.json, worker.json" and the canary of the options are files that exist
