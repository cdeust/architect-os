Feature: the entry of a platform process in its container
  The function the container runs (container-relay.ts) is called here in the scenario's own process, with real
  sockets, real loopback listeners and a real child; the compiled file that calls it is run once by node.

  Scenario: it relays the loopback port to the socket and runs the command, whose output and exit code come back
    Given a Unix socket server that answers "pong" to what it receives
    And a free loopback port for the container entry
    When I run the container entry with the command "relay-client"
    Then the container entry ended with 3
    And the stdout of the container entry is "got:pong:ping"
    And the port of the container entry is free again
    And no SIGTERM listener of the container entry remains

  Scenario: the entry listens on the IPv4 loopback only
    Given a Unix socket server that answers "pong" to what it receives
    And a free loopback port for the container entry
    When I run the container entry with the command "ipv6-client"
    Then the container entry ended with 0
    And the stdout of the container entry is "refused"

  Scenario: a relay socket that is gone closes the connection of the command
    Given a free loopback port for the container entry
    When I run the container entry with the command "relay-client"
    Then the container entry ended with 5
    And the stdout of the container entry is "closed"

  Scenario: a connection the command resets is ended at the relay socket while the command still runs
    Given a Unix socket server that answers "pong" and holds its connections open
    And a free loopback port for the container entry
    When I start the container entry with the command "reset-client"
    And I wait until the stdout of the container entry holds "left"
    Then the Unix socket server sees its connection closed
    When SIGTERM reaches the process of the container entry
    Then the container entry ended with 42

  Scenario: a port already taken gives 1 and the command is not started
    Given a Unix socket server that answers "pong" to what it receives
    And a loopback listener holds the port of the container entry
    When I run the container entry with the command "write-marker"
    Then the container entry ended with 1
    And the stderr of the container entry holds "container entry: relay on 127.0.0.1:"
    And the marker of the command was not written

  Scenario: a connection another process still holds through the entry is ended when the command ends
    Given a Unix socket server that holds its connections open
    And a free loopback port for the container entry
    When I start the container entry with the command "wait-for-term"
    And I wait until the stdout of the container entry holds "ready"
    And a client of this scenario connects to the port of the container entry and stays
    And SIGTERM reaches the process of the container entry
    Then the container entry ended with 42
    And the client of this scenario sees its connection closed
    And the Unix socket server sees its connection closed

  Scenario: SIGTERM reaches the command and its exit code is the entry's
    Given a free loopback port for the container entry
    When I start the container entry with the command "wait-for-term"
    And I wait until the stdout of the container entry holds "ready"
    And SIGTERM reaches the process of the container entry
    Then the container entry ended with 42
    And no SIGTERM listener of the container entry remains

  Scenario: a command ended by a signal gives 1
    Given a free loopback port for the container entry
    When I run the container entry with the command "kill-itself"
    Then the container entry ended with 1

  Scenario: a command that cannot be started gives 1 and its reason on stderr
    Given a free loopback port for the container entry
    When I run the container entry with the command "missing"
    Then the container entry ended with 1
    And the stderr of the container entry holds "container entry: cannot start"
    And no SIGTERM listener of the container entry remains

  Scenario: the compiled entry file calls the function
    Given a Unix socket server that answers "pong" to what it receives
    And a free loopback port for the container entry
    When I run the compiled container entry file with the command "relay-client"
    Then the container entry ended with 3
    And the stdout of the container entry is "got:pong:ping"
