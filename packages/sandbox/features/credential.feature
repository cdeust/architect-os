Feature: usage reading and command credential (host side)

  Scenario: usageOf reads a JSON response and ignores unparseable bodies
    When I read the usage of an "application/json" body '{"model":"m","content":[{"text":"x"}],"usage":{"input_tokens":1}}'
    Then the usage is '{"model":"m","input_tokens":1}'
    When I read the usage of an "application/json" body 'not json'
    Then the usage is '{}'
    When I read the usage of an "application/json" body '{"type":"error","error":{"type":"rate_limit_error","message":"m"}}'
    Then the usage is '{"error_type":"rate_limit_error"}'

  Scenario: usageOf reads a stream: a message_start without message, a usage outside message_delta ignored
    When I read the usage of a server-sent-events body:
      """
      data: {"type":"message_start"}
      data: {"type":"message_delta","usage":{"output_tokens":7}}
      data: {"type":"ping","message":{"model":"not-the-model"},"usage":{"output_tokens":9}}
      """
    Then the usage is '{"output_tokens":7}'

  Scenario: commandCredential reads claudeAiOauth.accessToken and caches it while it is fresh
    Given a credential command that counts its runs and prints the access token "a" valid for one hour
    When I read the credential twice
    Then both readings give the access token "a"
    And the credential command ran 1 time

  Scenario: commandCredential refuses an expired credential and never echoes the command output
    Given a credential command that prints the access token "zz-secret" expired since the epoch plus 1 ms
    Then reading the credential is refused with "expired"
    Given a credential command that prints "zz-secret not json"
    Then reading the credential is refused with "^credential is not JSON$"
    Given a credential command that prints "zz-secret" and exits with code 3
    Then reading the credential is refused with "^credential command failed$"

  Scenario Outline: commandCredential reads <case>
    Given a credential command that prints the JSON '<json>'
    Then reading the credential gives '<credential>'

    Examples:
      | case                 | json                                                      | credential          |
      | no expiry            | {"claudeAiOauth":{"accessToken":"a"}}                     | {"accessToken":"a"} |
      | a non-numeric expiry | {"claudeAiOauth":{"accessToken":"a","expiresAt":"soon"}} | {"accessToken":"a"} |

  Scenario Outline: commandCredential refuses <case>
    Given a credential command that prints the JSON '<json>'
    Then reading the credential is refused with "^credential has no access token$"

    Examples:
      | case               | json                                |
      | no claudeAiOauth   | {}                                  |
      | a non-string token | {"claudeAiOauth":{"accessToken":1}} |

  Scenario: commandCredential refuses an empty command and an output over 64 KiB
    Given a credential command with no argv
    Then reading the credential is refused with "^credential command empty$"
    Given a credential command that prints a valid credential padded to 65537 bytes
    Then reading the credential is refused with "^credential command failed$"

  Scenario Outline: on a clock at 1000 ms and a 60000 ms margin, a credential expiring at <expiresAt> is <verdict>
    Given a credential command that prints the access token "a" expiring at <expiresAt> ms, read with the clock at 1000 ms
    Then reading the credential is <verdict>

    Examples:
      | expiresAt | verdict  |
      | 61000     | refused  |
      | 61001     | accepted |
