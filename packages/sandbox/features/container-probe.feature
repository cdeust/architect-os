Feature: the probe of the canary container
  The function the canary container runs (container-probe.ts) is called here in the scenario's own process, with a real
  loopback listener, real folders and files; the compiled file that calls it is run once by node. It decides nothing:
  it reports.

  Scenario: it reports what it read from the port, its uid, its interfaces, the failure outside, each write and each cgroup file
    Given a probe listener that answers "hello" and ends
    And a port of the probe that nothing listens on is the address outside
    And a probe folder that can be written
    And a probe folder that cannot be written
    And a probe cgroup folder holding "memory.max" as "268435456[newline]", "memory.swap.max" as "0[newline]" and no "pids.max"
    When I run the probe with the bound of 5000 ms
    Then the probe printed one line of JSON
    And the probe read "hello" from the port
    And the probe reports the uid of its process
    And the probe reports the names of the network interfaces of its host
    And the probe reports the connection outside as the error "ECONNREFUSED"
    And the probe reports the write in the folder it can write as written, and leaves nothing in it
    And the probe reports the write in the folder it cannot write as the error "ENOTDIR"
    And the probe reports the cgroup file "memory.max" as "268435456"
    And the probe reports the cgroup file "memory.swap.max" as "0"
    And the probe reports the cgroup file "pids.max" as the error "ENOENT"

  Scenario: a connection outside that is accepted is reported as connected
    Given a probe listener that answers "hello" and ends
    And a probe listener that accepts and says nothing is the address outside
    And a probe folder that can be written
    And a probe cgroup folder holding "memory.max" as "max[newline]", "memory.swap.max" as "max[newline]" and no "pids.max"
    When I run the probe with the bound of 5000 ms
    Then the probe reports the connection outside as "connected"
    And the probe reports the cgroup file "memory.max" as "max"
    And the listeners of the probe accepted 2 connections, and saw all of them closed

  Scenario: a port that answers nothing within the bound is reported as no answer, and the probe goes on
    Given a probe listener that accepts and says nothing is the port
    And a port of the probe that nothing listens on is the address outside
    And a probe folder that can be written
    And a probe cgroup folder holding "memory.max" as "1[newline]", "memory.swap.max" as "2[newline]" and no "pids.max"
    When I run the probe with the bound of 200 ms
    Then the probe reports the read as the error "no answer"
    And the probe reports the connection outside as the error "ECONNREFUSED"
    And the listeners of the probe accepted 1 connection, and saw all of them closed

  Scenario: a port that nothing listens on is reported by its error
    Given a port of the probe that nothing listens on is the port
    And a port of the probe that nothing listens on is the address outside
    And a probe folder that can be written
    And a probe cgroup folder holding "memory.max" as "1[newline]", "memory.swap.max" as "2[newline]" and no "pids.max"
    When I run the probe with the bound of 5000 ms
    Then the probe reports the read as the error "ECONNREFUSED"

  Scenario: a file of the probe that is already there is neither written nor removed
    Given a probe listener that answers "hello" and ends
    And a port of the probe that nothing listens on is the address outside
    And a probe folder that can be written
    And the probe folder that can be written already holds the file of the probe, with "kept"
    And a probe cgroup folder holding "memory.max" as "1[newline]", "memory.swap.max" as "2[newline]" and no "pids.max"
    When I run the probe with the bound of 5000 ms
    Then the probe reports the write in the folder it can write as the error "EEXIST", and the file still holds "kept"

  Scenario Outline: an argument that is not the JSON of its targets makes the probe throw, and it prints nothing: <argument>
    When I try to run the probe with the argument '<argument>'
    Then the probe throws a <error> and prints nothing

    Examples:
      | argument | error       |
      | not json | SyntaxError |
      | null     | TypeError   |

  Scenario: the compiled probe file calls the function with the targets it is given
    Given a probe listener that answers "hello" and ends
    And a port of the probe that nothing listens on is the address outside
    And a probe folder that can be written
    And a probe folder that cannot be written
    And a probe cgroup folder holding "memory.max" as "268435456[newline]", "memory.swap.max" as "0[newline]" and no "pids.max"
    When I run the compiled probe file with the bound of 5000 ms
    Then the probe printed one line of JSON
    And the probe read "hello" from the port
    And the probe reports the connection outside as the error "ECONNREFUSED"
    And the probe reports the write in the folder it can write as written, and leaves nothing in it
    And the probe reports the write in the folder it cannot write as the error "ENOTDIR"
    And the probe reports the cgroup file "memory.max" as "268435456"
