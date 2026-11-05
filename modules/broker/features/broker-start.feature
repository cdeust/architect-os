Feature: starting the broker, its process, its descriptive file
  The broker does not start without a key file only its owner reads, nor without its port. As a process, child of the
  gateway, it speaks MCP on its stdio and nothing else, and ends with its stdin. broker.json carries what it relays.

  Scenario Outline: a key file the broker cannot trust refuses the start: <case>
    Given a key file that is <case>
    When I start a broker with that key file
    Then the start is refused with "<message>"

    Examples:
      | case                  | message                                                  |
      | readable by its group | key file must be readable by its owner only (0600): KEY |
      | readable by all       | key file must be readable by its owner only (0600): KEY |
      | empty                 | key file holds no key: KEY                               |
      | two words             | key file holds no key: KEY                               |
      | a directory           | key file is not a regular file: KEY                      |

  Scenario: a key file of mode 0400 is trusted
    Given a key file that is readable by its owner only, read-only
    When I start a broker with that key file
    Then the broker started

  Scenario: a key file ended by a newline, as an editor or echo writes it, is trusted
    Given a key file that is ended by a newline
    When I start a broker with that key file
    Then the broker started

  Scenario: a port already taken refuses the start and closes the MCP server
    Given a key file that is a valid one
    When I start a broker with that key file on a port already taken
    Then the start is refused with code "EADDRINUSE"
    And the broker's MCP server no longer answers on its stdio

  Scenario: serve runs the broker of BROKER_CONFIG on its stdio until its stdin ends, then gives 0
    Given a broker configuration file with a valid key file and a free port
    When I serve the broker with that configuration over a pair of streams
    And the gateway grants a token over those streams and the worker spends it
    Then the gateway got the usage record of that spending over those streams
    When the gateway ends the broker's stdin
    Then serve of the broker gives 0 and its port refuses connections

  Scenario: serve over a stdin that ends while the broker starts gives 0 and frees its port
    Given a broker configuration file with a valid key file and a free port
    When I serve the broker with that configuration over a stdin that ends at once
    Then serve of the broker gives 0 and its port refuses connections

  Scenario: serve reports a broker that cannot start and gives 1
    Given a broker configuration file with a key file readable by all
    When I serve the broker with that configuration over a pair of streams
    Then serve of the broker gives 1 and wrote "broker: key file must be readable by its owner only (0600): KEY"

  Scenario: the configuration file is BROKER_CONFIG, or the broker.json of the module
    Then the configuration file of the environment "BROKER_CONFIG=/etc/b.json" is "/etc/b.json"
    And the configuration file of an empty environment is the committed broker.json

  Scenario: the broker process, launched as the gateway launches it, speaks MCP on its stdio
    Given a broker configuration file with a valid key file and a free port
    When the gateway launches the broker process with that configuration
    And the gateway grants a token to the process and the worker spends it
    Then the gateway got the usage record of that spending from the process
    When the gateway closes the broker process
    Then the port of the broker process refuses connections

  Scenario: the committed broker.json is valid: one upstream, POST /v1/messages, a fixed port, the key file of its uid
    Given the committed broker.json
    Then it relays to "https://api.anthropic.com" on port 8084 the routes "^/v1/messages(/count_tokens)?(\?[^#]*)?$"
    And its key file is under the home directory

  Scenario Outline: a broken copy of broker.json is rejected: <case>
    Given the committed broker.json
    Then a copy where <change> is rejected

    Examples:
      | case             | change                                |
      | http upstream    | upstream is "http://api.anthropic.com" |
      | privileged port  | port is 80                            |
      | relative route   | routes is ["/v1/messages"]            |
      | no route         | routes is []                          |
      | an unknown field | budget is 1                           |
      | no key file      | keyFile is ""                         |
      | a scheme led by x  | upstream is "xhttps://api.anthropic.com" |
      | a scheme ended by x | upstream is "httpsx://api.anthropic.com" |
      | an empty beta    | betas is [""]                         |

  Scenario: a copy of broker.json that names a beta is accepted, and relays with it
    Given the committed broker.json
    Then a copy where betas is ["a-beta-2026-01-01"] is accepted with the betas ["a-beta-2026-01-01"]
