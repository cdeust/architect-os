Feature: The admission of a run (application: admit, over the in-memory runtime filesystem)
  The order is fixed, so that a refusal is reproducible: the setting, the policy, the root, its marker, the environment
  it names, the home and the two samples, the shared directories as they are found, then the setup of the run, then its
  receipt. Every refusal before the setup writes nothing; a setup that fails dispatches nothing, and removes the run it
  allocated while that run is still the one it made, and nothing else (docs/design/orchestration-fable-5-2.md §14,
  « Un seul lieu d'écriture »).

  Background:
    Given a runtime admission policy for the scenarios
      | environment   | root floor | home floor |
      | workstation   | 1000       | 500        |
      | hosted-runner | 100        | 500        |
      | server        | 2000       | 1000       |
    And a memory runtime filesystem where "/mnt/aos" is a directory on device 7
    And the memory runtime marker of "/mnt/aos" reads "architect-os-runtime-root/v2\nenvironment=workstation\n" on device 7
    And the memory runtime home is "/home/owner", a directory on device 8
    And the memory runtime device 7 has "1001" blocks of "1" bytes free
    And the memory runtime device 8 has "501" blocks of "1" bytes free
    And the runtime clock reads "2026-11-19T10:00:00.000Z"

  Rule: an admitted run is allocated, set up, and its receipt written before anything is dispatched

    Scenario: a marked root with room on both filesystems admits a run, sets up its locations and writes its receipt
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission admits the run "r000001"
      And the memory runtime filesystem made, in this order:
        | /mnt/aos/run                                      |
        | /mnt/aos/cache                                    |
        | /mnt/aos/cache/npm                                |
        | /mnt/aos/cache/xdg                                |
        | /mnt/aos/cache/node                               |
        | /mnt/aos/run/r000001                              |
        | /mnt/aos/run/r000001/tmp                          |
        | /mnt/aos/run/r000001/npm-logs                     |
        | /mnt/aos/run/r000001/config                       |
        | /mnt/aos/run/r000001/config/npm                   |
        | /mnt/aos/run/r000001/data                         |
        | /mnt/aos/run/r000001/state                        |
        | /mnt/aos/run/r000001/config/npm/user.npmrc        |
        | /mnt/aos/run/r000001/config/npm/global.npmrc      |
        | /mnt/aos/run/r000001/admission.json               |
      And the memory runtime file "/mnt/aos/run/r000001/config/npm/user.npmrc" holds ""
      And the memory runtime file "/mnt/aos/run/r000001/config/npm/global.npmrc" holds ""
      And the runtime receipt of the admission, also in "/mnt/aos/run/r000001/admission.json", is:
        """
        {
          "schema": "architect-os-runtime-receipt/v1",
          "run": "r000001",
          "admittedAt": "2026-11-19T10:00:00.000Z",
          "command": "npm",
          "environment": "workstation",
          "policy": {
            "version": 1,
            "status": "provisional"
          },
          "floors": {
            "rootBytes": "1000",
            "homeBytes": "500"
          },
          "observations": {
            "root": {
              "device": "7",
              "inode": "2",
              "availableBytes": "1001"
            },
            "home": {
              "device": "8",
              "availableBytes": "501"
            }
          }
        }

        """

    Scenario: the shared directories found in place are kept, and a second admission allocates another run beside the first
      Given the memory runtime path "/mnt/aos/run/rkept01" is a directory on device 7
      When the runtime admission runs for the setting "/mnt/aos"
      And the runtime admission runs again for the setting "/mnt/aos"
      Then the runtime admission admits the run "r000002"
      And the memory runtime path "/mnt/aos/run/rkept01" remains a directory
      And the memory runtime path "/mnt/aos/run/r000001/admission.json" remains a file

    Scenario: a name of run that something already holds is skipped, and what holds it keeps its identity and contents
      Given the memory runtime path "/mnt/aos/run/r000001" is a directory on device 7
      And the memory runtime path "/mnt/aos/run/r000001/kept" is a regular file on device 7
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission admits the run "r000002"
      And the memory runtime path "/mnt/aos/run/r000001" remains the directory that was there, with "/mnt/aos/run/r000001/kept"

    Scenario Outline: a command of the kind <kind> is admitted with that kind in its receipt, and nothing else of it
      Given the command of the runtime admission is of the kind "<kind>"
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime receipt names the command kind "<kind>"

      Examples:
        | kind  |
        | npm   |
        | npx   |
        | node  |
        | other |

    Scenario Outline: a marker that names <environment> selects its own reserve
      Given the memory runtime marker of "/mnt/aos" reads "architect-os-runtime-root/v2\nenvironment=<environment>\n" on device 7
      And the memory runtime device 7 has "<root>" blocks of "4096" bytes free
      And the memory runtime device 8 has "<home>" blocks of "4096" bytes free
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime receipt names the environment "<environment>", the floors "<root floor>" and "<home floor>", and the observations "<root bytes>" and "<home bytes>"

      Examples:
        | environment   | root | home | root floor | home floor | root bytes | home bytes |
        | workstation   | 1    | 1    | 1000       | 500        | 4096       | 4096       |
        | hosted-runner | 1    | 1    | 100        | 500        | 4096       | 4096       |
        | server        | 3    | 2    | 2000       | 1000       | 12288      | 8192       |

  Rule: the setting and the policy are checked before any disk is inspected

    Scenario Outline: the runtime setting <setting> is refused with <code>
      When the runtime admission runs for the setting "<setting>"
      Then the runtime admission is refused with "<code>"
      And the memory runtime filesystem made nothing

      Examples:
        | setting            | code                  |
        |                    | RUNTIME_ROOT_REQUIRED |
        | mnt/aos            | RUNTIME_ROOT_UNSAFE   |
        | ./mnt/aos          | RUNTIME_ROOT_UNSAFE   |
        | /                  | RUNTIME_ROOT_UNSAFE   |
        | //mnt/aos          | RUNTIME_ROOT_UNSAFE   |
        | /mnt//aos          | RUNTIME_ROOT_UNSAFE   |
        | /mnt/aos/          | RUNTIME_ROOT_UNSAFE   |
        | /mnt/./aos         | RUNTIME_ROOT_UNSAFE   |
        | /mnt/aos/.         | RUNTIME_ROOT_UNSAFE   |
        | /mnt/../mnt/aos    | RUNTIME_ROOT_UNSAFE   |
        | /mnt/aos/..        | RUNTIME_ROOT_UNSAFE   |
        | /mnt/a\u0000os     | RUNTIME_ROOT_UNSAFE   |

    Scenario: an absent runtime setting is required
      When the runtime admission runs with no setting
      Then the runtime admission is refused with "RUNTIME_ROOT_REQUIRED"
      And the memory runtime filesystem made nothing

    Scenario: without a valid policy nothing is admitted, and the setting is still checked first
      Given there is no valid runtime admission policy
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_POLICY_INVALID"
      When the runtime admission runs with no setting
      Then the runtime admission is refused with "RUNTIME_ROOT_REQUIRED"
      When the runtime admission runs for the setting "/mnt/gone"
      Then the runtime admission is refused with "RUNTIME_POLICY_INVALID"
      And the memory runtime filesystem made nothing

  Rule: the root must be a marked directory, reached by its own path

    Scenario: a missing volume suspends the admission without creating its mount path
      When the runtime admission runs for the setting "/mnt/gone/aos"
      Then the runtime admission is refused with "RUNTIME_ROOT_UNAVAILABLE"
      And the memory runtime filesystem made nothing
      And the memory runtime path "/mnt/gone" does not exist

    Scenario: an existing mount stub without the installer marker is refused
      Given the memory runtime path "/mnt/stub" is a directory on device 7
      When the runtime admission runs for the setting "/mnt/stub"
      Then the runtime admission is refused with "RUNTIME_MARKER_MISSING"
      And the memory runtime filesystem made nothing

    Scenario Outline: a root that is <form> is unsafe
      Given the memory runtime path "<path>" is <kind>
      When the runtime admission runs for the setting "<root>"
      Then the runtime admission is refused with "RUNTIME_ROOT_UNSAFE"
      And the memory runtime filesystem made nothing

      Examples:
        | form                          | path         | kind                           | root               |
        | a symbolic link               | /mnt/linked  | a link                         | /mnt/linked        |
        | reached through a link        | /srv         | a link                         | /srv/aos           |
        | a regular file                | /mnt/file    | a regular file on device 7     | /mnt/file          |
        | below a regular file          | /mnt/file    | a regular file on device 7     | /mnt/file/aos      |
        | a special file                | /mnt/fifo    | a special file                 | /mnt/fifo          |

    Scenario Outline: a marker that is <form> is invalid
      Given the memory runtime path "/mnt/aos/.architect-os-runtime-root" is <kind>
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_MARKER_INVALID"
      And the memory runtime filesystem made nothing

      Examples:
        | form                      | kind                        |
        | a symbolic link           | a link                      |
        | a special file            | a special file              |
        | a directory               | a directory on device 7     |
        | a regular file of 257 bytes | a regular file of 257 bytes on device 7 |

    Scenario Outline: a marker that reads "<text>" is refused with <code>
      Given the memory runtime marker of "/mnt/aos" reads "<text>" on device 7
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "<code>"
      And the memory runtime filesystem made nothing

      Examples:
        | text                                                                        | code                        |
        | architect-os-runtime-root/v1\n                                              | RUNTIME_MARKER_INVALID      |
        | architect-os-runtime-root/v2\nenvironment=workstation                       | RUNTIME_MARKER_INVALID      |
        | architect-os-runtime-root/v2\nenvironment=workstation\nenvironment=server\n | RUNTIME_MARKER_INVALID      |
        | architect-os-runtime-root/v2\n                                              | RUNTIME_ENVIRONMENT_UNKNOWN |
        | architect-os-runtime-root/v2\nenvironment=\n                                | RUNTIME_ENVIRONMENT_UNKNOWN |
        | architect-os-runtime-root/v2\nenvironment=laptop\n                          | RUNTIME_ENVIRONMENT_UNKNOWN |
        | architect-os-runtime-root/v2\nenvironment=Workstation\n                     | RUNTIME_ENVIRONMENT_UNKNOWN |
        | architect-os-runtime-root/v2\nenvironment=constructor\n                     | RUNTIME_ENVIRONMENT_UNKNOWN |
        | architect-os-runtime-root/v2\nenvironment=__proto__\n                       | RUNTIME_ENVIRONMENT_UNKNOWN |

    Scenario: a marker on another device than its root is invalid
      Given the memory runtime marker of "/mnt/aos" reads "architect-os-runtime-root/v2\nenvironment=workstation\n" on device 9
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_MARKER_INVALID"
      And the memory runtime filesystem made nothing

  Rule: both filesystems are measured, and each must hold strictly more than its floor

    Scenario Outline: <case> gives no admission
      Given <arrangement>
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_SPACE_UNAVAILABLE"
      And the memory runtime filesystem made nothing

      Examples:
        | case                                                     | arrangement                                                                    |
        | an unknown home                                          | the memory runtime home is unknown                                             |
        | a home that does not exist                               | the memory runtime home is "/home/gone", which does not exist                  |
        | a home on a device that is not measured                  | the memory runtime home is "/home/other", a directory on device 12             |
        | a root sample with no unit                               | the memory runtime device 7 has "1001" blocks of "0" bytes free                |
        | a home sample with a negative count                      | the memory runtime device 8 has "-1" blocks of "1" bytes free                  |
        | an unknown home, whatever a sample of no path would find | the memory runtime home is unknown, though a sample of no path would find room |

    Scenario Outline: a sample of the root that finds another directory (<case>) gives no admission
      Given a sample of the memory runtime path "/mnt/aos" finds the device <device> and the inode <inode>
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_SPACE_UNAVAILABLE"
      And the memory runtime filesystem made nothing

      Examples:
        | case              | device | inode |
        | another device    | 9      | 2     |
        | another inode     | 7      | 99    |

    Scenario: a sample of the root that finds the root itself admits
      Given a sample of the memory runtime path "/mnt/aos" finds the device 7 and the inode 2
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission admits the run "r000001"

    Scenario: a root on a device that is not measured gives no admission
      Given the memory runtime path "/mnt/bare" is a directory on device 9
      And the memory runtime marker of "/mnt/bare" reads "architect-os-runtime-root/v2\nenvironment=workstation\n" on device 9
      When the runtime admission runs for the setting "/mnt/bare"
      Then the runtime admission is refused with "RUNTIME_SPACE_UNAVAILABLE"
      And the memory runtime filesystem made nothing

    Scenario Outline: <root> bytes on the root and <home> on the home are <outcome>
      Given the memory runtime device 7 has "<root>" blocks of "1" bytes free
      And the memory runtime device 8 has "<home>" blocks of "1" bytes free
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission outcome is "<outcome>"

      Examples:
        | root | home | outcome                |
        | 999  | 501  | RUNTIME_ROOT_SPACE_LOW |
        | 1000 | 501  | RUNTIME_ROOT_SPACE_LOW |
        | 1001 | 501  | admitted               |
        | 1001 | 499  | RUNTIME_HOME_SPACE_LOW |
        | 1001 | 500  | RUNTIME_HOME_SPACE_LOW |
        | 999  | 499  | RUNTIME_ROOT_SPACE_LOW |

    Scenario Outline: on one device for the root and the home, <bytes> bytes face both floors of <environment>, never their sum: <outcome>
      Given the memory runtime marker of "/mnt/aos" reads "architect-os-runtime-root/v2\nenvironment=<environment>\n" on device 7
      And the memory runtime home is "/mnt/home", a directory on device 7
      And the memory runtime device 7 has "<bytes>" blocks of "1" bytes free
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission outcome is "<outcome>"

      Examples:
        | environment   | bytes | outcome                |
        | workstation   | 1001  | admitted               |
        | workstation   | 1000  | RUNTIME_ROOT_SPACE_LOW |
        | hosted-runner | 501   | admitted               |
        | hosted-runner | 500   | RUNTIME_HOME_SPACE_LOW |
        | hosted-runner | 101   | RUNTIME_HOME_SPACE_LOW |

  Rule: the shared directories already there are judged before the first write

    Scenario Outline: a shared directory that is <form> is unsafe, and nothing is made
      Given the memory runtime path "<path>" is <kind>
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_ROOT_UNSAFE"
      And the memory runtime filesystem made nothing
      And the runtime admission left the memory runtime path "<path>" as <kind>

      Examples:
        | form                         | path                 | kind                       |
        | a link in place of run       | /mnt/aos/run         | a link                     |
        | a file in place of cache     | /mnt/aos/cache       | a regular file on device 7 |
        | a link in place of cache/npm | /mnt/aos/cache/npm   | a link                     |
        | on another device            | /mnt/aos/cache       | a directory on device 9    |
        | a special file in place of cache/node | /mnt/aos/cache/node | a special file      |

    Scenario Outline: the shared directory <path> found in place is kept, and the ones missing are made
      Given the memory runtime path "<path>" is a directory on device 7
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission admits the run "r000001"
      And the memory runtime filesystem made "/mnt/aos/run/r000001" and did not make "<path>"

      Examples:
        | path                |
        | /mnt/aos/run        |
        | /mnt/aos/cache/node |

    Scenario: a shared directory that cannot be inspected fails the setup before anything is made
      Given the memory runtime path "/mnt/aos/cache" is a directory on device 7
      And the memory runtime directory "/mnt/aos/cache" cannot be searched
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_SETUP_FAILED"
      And the memory runtime filesystem made nothing

  Rule: a shared directory that changes after it was judged and before it is made is judged again as it is made

    Scenario Outline: <path>, absent when judged, that becomes <kind> before it is made, is unsafe: no run is allocated, nothing is dispatched
      Given the memory runtime path "<path>" becomes <kind> between the two passes over the shared directories
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_ROOT_UNSAFE"
      And the memory runtime filesystem made, below "/mnt/aos", only: <made>

      Examples:
        | path                | kind                       | made                      |
        | /mnt/aos/run        | a link                     | nothing                   |
        | /mnt/aos/run        | a regular file on device 7 | nothing                   |
        | /mnt/aos/run        | a directory on device 9    | nothing                   |
        | /mnt/aos/run        | a special file             | nothing                   |
        | /mnt/aos/cache/node | a link                     | run, cache/npm, cache/xdg |

    Scenario Outline: <path>, a directory found in place when judged, that becomes <kind> before it is made, is unsafe: no run is allocated, nothing is dispatched
      Given the memory runtime path "<path>" is a directory on device 7
      And the memory runtime path "<path>" becomes <kind> between the two passes over the shared directories
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_ROOT_UNSAFE"
      And the memory runtime filesystem made, below "/mnt/aos", only: nothing

      Examples:
        | path         | kind                       |
        | /mnt/aos/run | a link                     |
        | /mnt/aos/run | a regular file on device 7 |
        | /mnt/aos/run | a directory on device 9    |

    Scenario Outline: <path>, absent when judged, made meanwhile by another admission as a directory on the device of the root, is kept, and the run is admitted
      Given the memory runtime path "<path>" becomes a directory on device 7 between the two passes over the shared directories
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission admits the run "r000001"
      And the memory runtime filesystem made "/mnt/aos/run/r000001" and did not make "<path>"

      Examples:
        | path                |
        | /mnt/aos/run        |
        | /mnt/aos/cache      |
        | /mnt/aos/cache/node |

  Rule: a setup that fails dispatches nothing, and removes its own run while it is still the one it made

    Scenario Outline: a setup that cannot make <path> fails, and leaves no run of its own
      Given the memory runtime path "<path>" cannot be made
      And the memory runtime path "/mnt/aos/run/rkept01" is a directory on device 7
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_SETUP_FAILED"
      And the memory runtime path "/mnt/aos/run/rkept01" remains a directory
      And the memory runtime path "/mnt/aos/run/r000001" does not exist
      And the memory runtime path "/mnt/aos/cache/npm" remains a directory
      And the memory runtime filesystem removed, in this order: <removed>

      Examples:
        | path                                          | removed                                                                                                   |
        | /mnt/aos/cache/xdg                            | nothing                                                                                                   |
        | /mnt/aos/run/r000001                          | nothing                                                                                                   |
        | /mnt/aos/run/r000001/tmp                      | r000001                                                                                                   |
        | /mnt/aos/run/r000001/state                    | data, config/npm, config, npm-logs, tmp, r000001                                                          |
        | /mnt/aos/run/r000001/config/npm/user.npmrc    | state, data, config/npm, config, npm-logs, tmp, r000001                                                   |
        | /mnt/aos/run/r000001/config/npm/global.npmrc  | config/npm/user.npmrc, state, data, config/npm, config, npm-logs, tmp, r000001                            |
        | /mnt/aos/run/r000001/admission.json           | config/npm/global.npmrc, config/npm/user.npmrc, state, data, config/npm, config, npm-logs, tmp, r000001   |

    Scenario: a run substituted while it is set up is left as it is, with what it holds, and nothing is dispatched
      Given the memory runtime path "/mnt/aos/run/r000001/state" cannot be made, and "/mnt/aos/run/r000001" is replaced by another directory as it is tried
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_SETUP_FAILED"
      And the memory runtime path "/mnt/aos/run/r000001" remains a directory
      And the memory runtime path "/mnt/aos/run/r000001/tmp" remains a directory
      And the memory runtime path "/mnt/aos/run/r000001" has an identity that no other directory the admission made has
      And the memory runtime filesystem removed, in this order: nothing

    Scenario: an error nobody foresaw once the run is allocated reaches the entry, and the run goes
      Given the runtime clock throws "a clock that cannot be read"
      When the runtime admission runs for the setting "/mnt/aos", which throws
      Then the runtime admission threw "a clock that cannot be read"
      And the memory runtime path "/mnt/aos/run/r000001" does not exist
      And the memory runtime path "/mnt/aos/run" remains a directory

    Scenario: a root that refuses a new entry fails the setup
      Given the memory runtime directory "/mnt/aos" refuses new entries
      When the runtime admission runs for the setting "/mnt/aos"
      Then the runtime admission is refused with "RUNTIME_SETUP_FAILED"
      And the memory runtime filesystem made nothing
