Feature: the image of the rootless scenarios (rootless/image.json)
  The scenarios that run before a real rootless Docker daemon (rootless/*.feature, outside the gate) take the image of
  their sandboxes from one committed file, which the workflow rootless.yml reads too, to fetch the image before them.
  It names the image by its sha256 digest, never by a tag, and the absolute path of node inside it; nothing else.
  A broken copy is refused here, on every host, and not only by the Docker adapter on the Linux runner.

  Scenario: the committed file names an image by its digest and the absolute path of its node
    When the committed image of the rootless scenarios is loaded
    Then it is an image by its sha256 digest, and the absolute path of its node

  Scenario Outline: a broken copy is refused: <defect>
    When a copy of the committed image of the rootless scenarios is loaded with <defect>
    Then that copy of the image of the rootless scenarios is refused

    Examples:
      | defect                                |
      | a tag in place of the digest          |
      | a tag and no digest after the at sign |
      | a digest of 63 characters             |
      | a digest in capitals                  |
      | a relative path of node               |
      | a name of node and no path            |
      | no node                               |
      | no image                              |
      | a field nothing reads                 |
      | a list in place of the object         |

  Scenario: a copy that is not JSON is refused
    When a copy of the committed image of the rootless scenarios that is not JSON is loaded
    Then that copy of the image of the rootless scenarios is refused
