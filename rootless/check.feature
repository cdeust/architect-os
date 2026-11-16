Feature: the check at start of the Docker mode, before a real rootless daemon (docs/design/platform-v3-srt.md, §6)
  The client is the real docker of the PATH, the daemon the rootless one of DOCKER_HOST, the image the one of
  rootless/image.json, fetched before the scenarios: the adapter never downloads. The platform root is this checkout.
  These scenarios run on a Linux host only, `npm run test:rootless`, never in the gate. A refusal says its cause in the
  words of the real client and of the real daemon, which a fake client could not show (journal, §54). The scenario of
  the daemon with root is skipped on a host that has none.

  Scenario: the check passes before the rootless daemon
    When the sandboxes of this platform are checked before the rootless daemon of this host, with the image of this repository
    Then the check of the sandboxes of this platform passed

  Scenario: the daemon with root of the same host is refused, with what it says of itself
    When the sandboxes of this platform are checked before the daemon with root of this host
    Then the check of the sandboxes of this platform is refused matching '^ISOLATION_UNAVAILABLE: the daemon is not rootless: \["name='

  Scenario: an image that is not there is refused by its name, and nothing is downloaded
    When the sandboxes of this platform are checked before the rootless daemon of this host, with an image that is not there
    Then the check of the sandboxes of this platform is refused matching '^ISOLATION_UNAVAILABLE: canary: the container printed nothing; its error output: ".*No such image: node@sha256:0{64}'

  Scenario: a node that the image does not hold is refused by its path
    When the sandboxes of this platform are checked before the rootless daemon of this host, with a node that the image does not hold
    Then the check of the sandboxes of this platform is refused matching '^ISOLATION_UNAVAILABLE: canary: the container printed nothing; its error output: ".*/usr/local/bin/no-such-node'
