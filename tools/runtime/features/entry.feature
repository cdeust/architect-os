Feature: The admission as a command (main.ts: what the shell entry aos reads of it)
  The command takes two operands, the root and the kind of the command (npm, npx, node or other, as the shell entry
  classifies it); it prints the identifier of the run alone on stdout and exits 0, or prints
  `aos: <CODE>` on stderr and exits 2, or exits 3 with `aos: RUNTIME_UNEXPECTED` when something nobody foresaw fails.
  The policy is the committed file of the launcher checkout.

  Scenario: an admitted run prints its identifier alone and exits 0
    Given a runtime command over a memory root marked "workstation" with room, and the policy text with floors of "1" byte
    When the runtime command runs with the operands "/mnt/aos npm"
    Then the runtime command exits 0, printing "r000001\n" on stdout and "" on stderr

  Scenario Outline: the runtime command with <operands> is refused with <code>
    Given a runtime command over a memory root marked "<environment>" with room, and the policy text with floors of "1" byte
    When the runtime command runs with the operands "<operands>"
    Then the runtime command exits 2, printing "" on stdout and "aos: <code>\n" on stderr

    Examples:
      | environment | operands               | code                        |
      | workstation |                        | USAGE                       |
      | workstation | /mnt/aos               | USAGE                       |
      | workstation | /mnt/aos npm npm       | USAGE                       |
      | workstation | /mnt/aos NPM           | USAGE                       |
      | workstation | /mnt/aos /usr/bin/npm  | USAGE                       |
      | workstation | /mnt/aos gate          | USAGE                       |
      | workstation | /mnt/gone npm          | RUNTIME_ROOT_UNAVAILABLE    |
      | workstation | mnt/aos npm            | RUNTIME_ROOT_UNSAFE         |
      | laptop      | /mnt/aos npm           | RUNTIME_ENVIRONMENT_UNKNOWN |

  Scenario Outline: the runtime command admits a command of the kind <kind>
    Given a runtime command over a memory root marked "workstation" with room, and the policy text with floors of "1" byte
    When the runtime command runs with the operands "/mnt/aos <kind>"
    Then the runtime command exits 0, printing "r000001\n" on stdout and "" on stderr

    Examples:
      | kind  |
      | npm   |
      | npx   |
      | node  |
      | other |

  Scenario: a shared directory that becomes a link after it was judged is refused, and no run is printed for the shell entry to dispatch
    Given a runtime command over a memory root marked "workstation" with room, and the policy text with floors of "1" byte
    And the shared directory "/mnt/aos/run" of the memory root of the runtime command becomes a link between the two passes
    When the runtime command runs with the operands "/mnt/aos npm"
    Then the runtime command exits 2, printing "" on stdout and "aos: RUNTIME_ROOT_UNSAFE\n" on stderr

  Scenario: an empty operand is the setting required
    Given a runtime command over a memory root marked "workstation" with room, and the policy text with floors of "1" byte
    When the runtime command runs with an empty root and the kind "npm"
    Then the runtime command exits 2, printing "" on stdout and "aos: RUNTIME_ROOT_REQUIRED\n" on stderr

  Scenario Outline: a policy text that is <form> refuses every run
    Given a runtime command over a memory root marked "workstation" with room, and the policy text <text>
    When the runtime command runs with the operands "/mnt/aos npm"
    Then the runtime command exits 2, printing "" on stdout and "aos: RUNTIME_POLICY_INVALID\n" on stderr

    Examples:
      | form              | text                            |
      | unreadable        | unreadable                      |
      | not JSON          | "{"                             |
      | with a zero floor | with floors of "0" byte         |

  Scenario: a failure nobody foresaw exits 3
    Given a runtime command whose filesystem throws when it inspects a root
    When the runtime command runs with the operands "/mnt/aos npm"
    Then the runtime command exits 3, printing "" on stdout and "aos: RUNTIME_UNEXPECTED\n" on stderr

  Scenario: the runtime command admits a marked root on the host and writes its receipt there
    Given a runtime command over a scratch root on the host marked "hosted-runner", and the policy text with floors of "1" byte
    When the runtime command runs with the scratch root and the kind "npx" as its operands
    Then the runtime command exits 0, and the receipt of the run it prints names "hosted-runner", the kind "npx" and the device of the scratch root

  Scenario: the dependencies of the runtime command are those of its process and of the launcher checkout
    When I build the runtime command dependencies of a fake process with the arguments "node cli.ts /mnt/aos npm"
    Then the runtime command dependencies hold the operands "/mnt/aos npm" and write to the streams of that process
    And the runtime command dependencies read the committed policy file of tools/runtime, with the host filesystem and the clock of the host

  Scenario: the listing of npm names prints, one per line, the names of its environment that npm reads as a controlled setting
    When the npm names of an environment with the names "PATH,NPM_CONFIG_CACHE,npm_config_registry,npm_config_logs-dir,Npm_Config_Node_Options" are listed
    Then the npm names listing exits 0, printing "NPM_CONFIG_CACHE\nnpm_config_logs-dir\nNpm_Config_Node_Options\n"

  Scenario: the listing of npm names of an environment with none of them prints nothing
    When the npm names of an environment with the names "PATH,HOME,npm_config_registry" are listed
    Then the npm names listing exits 0, printing ""

  Scenario: the dependencies of the npm names listing are the names of the environment of its process and its stdout
    When I build the npm names dependencies of a fake process whose environment has the names "PATH,npm_config_cache"
    Then the npm names dependencies hold the names "PATH,npm_config_cache" and write to the stdout of that process

  Scenario: the refusals of the admission are a closed list, and the shell entry refuses with no other
    Then the refusal codes of the admission are, in their order of checking:
      | USAGE                       |
      | RUNTIME_ROOT_REQUIRED       |
      | RUNTIME_NODE_MISSING        |
      | RUNTIME_NODE_UNSUPPORTED    |
      | RUNTIME_POLICY_INVALID      |
      | RUNTIME_ROOT_UNAVAILABLE    |
      | RUNTIME_ROOT_UNSAFE         |
      | RUNTIME_MARKER_MISSING      |
      | RUNTIME_MARKER_INVALID      |
      | RUNTIME_ENVIRONMENT_UNKNOWN |
      | RUNTIME_SPACE_UNAVAILABLE   |
      | RUNTIME_ROOT_SPACE_LOW      |
      | RUNTIME_HOME_SPACE_LOW      |
      | RUNTIME_SETUP_FAILED        |
    And the shell entry aos refuses with "USAGE", "RUNTIME_ROOT_REQUIRED", "RUNTIME_NODE_MISSING" and "RUNTIME_NODE_UNSUPPORTED", the first four of that list, in its order

  Scenario: the bootstrap obtains a physical binding and receipt
    Given a runtime command over a scratch root on the host marked "hosted-runner", and the policy text with floors of "1" byte
    When the runtime bootstrap requests a binding with the internal flag "1"
    Then the output carries the physical run identity and all issued receipt bytes

  Scenario: any other internal flag preserves the public output
    Given a runtime command over a scratch root on the host marked "hosted-runner", and the policy text with floors of "1" byte
    When the runtime bootstrap requests a binding with the internal flag "0"
    Then the runtime command exits 0, and the receipt of the run it prints names "hosted-runner", the kind "npm" and the device of the scratch root
