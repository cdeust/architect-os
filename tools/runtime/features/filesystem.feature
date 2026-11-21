Feature: The RuntimeFilesystem port (contract: the host adapter on real directories, the in-memory adapter in memory)
  Every path below a root is given as components. A link is never followed: in place of a root, a marker, a shared
  directory or a run, it is refused. Nothing is created where something already is.

  Scenario Outline: runtime filesystem <adapter> tells an absent root, a link, a file and a directory apart
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "target" is a directory
    And the scratch entry "linked" is a link to "target"
    And the scratch entry "plain" is a file holding "x"
    And the scratch entry "target/inner" is a directory
    Then the runtime filesystem finds the scratch root a directory, with the device and the inode of its samples
    And the runtime filesystem finds the root "absent" absent
    And the runtime filesystem finds the root "absent/below" absent
    And the runtime filesystem finds the root "linked" unsafe
    And the runtime filesystem finds the root "linked/inner" unsafe
    And the runtime filesystem finds the root "plain" unsafe
    And the runtime filesystem finds the root "plain/below" unsafe
    And the runtime filesystem finds the root "target" a directory with another inode than the scratch root

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> opens a regular marker and refuses any other
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "absent" is a directory
    And the scratch entry "plain" is a directory
    And the scratch entry "plain/.architect-os-runtime-root" is a file holding "architect-os-runtime-root/v2\nenvironment=server\n"
    And the scratch entry "big" is a directory
    And the scratch entry "big/.architect-os-runtime-root" is a file of 257 bytes
    And the scratch entry "edge" is a directory
    And the scratch entry "edge/.architect-os-runtime-root" is a file of 256 bytes
    And the scratch entry "folder" is a directory
    And the scratch entry "folder/.architect-os-runtime-root" is a directory
    And the scratch entry "linked" is a directory
    And the scratch entry "linked/.architect-os-runtime-root" is a link to "plain/.architect-os-runtime-root"
    Then the runtime filesystem finds no marker in "absent"
    And the runtime filesystem reads the marker of "plain" as "architect-os-runtime-root/v2\nenvironment=server\n", on the device of the scratch root
    And the runtime filesystem reads a marker of 256 bytes in "edge"
    And the runtime filesystem cannot read the marker of "big"
    And the runtime filesystem cannot read the marker of "folder"
    And the runtime filesystem cannot read the marker of "linked"

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> samples the free space of a directory, and of nothing else
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    Then the runtime filesystem samples the scratch root with a positive unit and a count of available blocks
    And the runtime filesystem gives no sample of "absent"
    And the runtime filesystem names a home directory and samples it

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> finds or makes a shared directory one component at a time
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "target" is a directory
    And the scratch entry "plain" is a file holding "x"
    And the scratch entry "linked" is a link to "target"
    Then the runtime filesystem ensures "cache/npm" below the scratch root: "ok"
    And the scratch entries "cache" and "cache/npm" are directories
    And the runtime filesystem ensures "cache/npm" below the scratch root: "ok"
    And the runtime filesystem ensures "linked/npm" below the scratch root: "unsafe"
    And the runtime filesystem ensures "plain" below the scratch root: "unsafe"
    And the runtime filesystem ensures "plain/npm" below the scratch root: "unsafe"
    And the runtime filesystem ensures "fresh" below the scratch root on another device: "unsafe"
    And the scratch entry "target/npm" does not exist

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> finds a shared directory without making anything
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "target" is a directory
    And the scratch entry "plain" is a file holding "x"
    And the scratch entry "linked" is a link to "target"
    Then the runtime filesystem finds "cache/npm" below the scratch root: "absent"
    And the scratch entry "cache" does not exist
    Given the scratch entry "cache" is a directory
    Then the runtime filesystem finds "cache/npm" below the scratch root: "absent"
    Given the scratch entry "cache/npm" is a directory
    Then the runtime filesystem finds "cache/npm" below the scratch root: "found"
    And the runtime filesystem finds "linked/npm" below the scratch root: "unsafe"
    And the runtime filesystem finds "linked" below the scratch root: "unsafe"
    And the runtime filesystem finds "plain" below the scratch root: "unsafe"
    And the runtime filesystem finds "plain/npm" below the scratch root: "unsafe"
    And the runtime filesystem finds "cache" below the scratch root on another device: "unsafe"
    And the runtime filesystem finds no component below the scratch root: "unsafe"
    And the runtime filesystem made nothing below the scratch root but what the scenario arranged

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> fails a shared directory it cannot inspect
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "cache" is a directory that cannot be searched
    Then the runtime filesystem finds "cache/npm" below the scratch root: "failed"
    And the runtime filesystem finds "cache" below the scratch root: "found"

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> refuses a path below the root whose component is "<component>"
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "a" is a directory
    And the scratch entry "run/rfixed1/a" is a directory
    Then the runtime filesystem refuses to find or make a shared directory, and to make a directory and a file in the run, with the component "<component>"

    Examples:
      | adapter | component |
      | memory  |           |
      | memory  | .         |
      | memory  | ..        |
      | memory  | a/b       |
      | memory  | a\u0000b  |
      | node    |           |
      | node    | .         |
      | node    | ..        |
      | node    | a/b       |
      | node    | a\u0000b  |

  Scenario Outline: runtime filesystem <adapter> refuses an empty path below the root
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    Then the runtime filesystem ensures no component below the scratch root: "unsafe"

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> allocates a distinct direct child of run each time
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run" is a directory
    When the runtime filesystem allocates 3 runs
    Then the 3 runs are distinct directories directly in "run", each named r and six letters or digits
    And each run allocated has the device and the inode of its directory

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> gives each directory it makes an identity that no other directory has
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    Then the runtime filesystem ensures "run" below the scratch root: "ok"
    And the runtime filesystem ensures "cache/npm" below the scratch root: "ok"
    When the runtime filesystem allocates 1 runs
    Then the runtime filesystem makes the directory "tmp" in the run: true
    And the runtime filesystem makes the directory "config" in the run: true
    And the scratch root, "run", "cache", "cache/npm", the run, its "tmp" and its "config" are directories of seven distinct identities

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> allocates a name that nothing holds, and leaves what holds another as it was
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run/r000001" is a directory
    And the scratch entry "run/r000001/kept" is a file holding "kept"
    When the runtime filesystem allocates 1 runs
    Then the run allocated is not "r000001"
    And the scratch entry "run/r000001" is the directory it was, still holding "kept"

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> allocates no run when run is <form>
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "target" is a directory
    And <arrangement>
    When the runtime filesystem allocates 1 runs
    Then the runtime filesystem allocated none
    And the scratch entry "target" is empty

    Examples:
      | adapter | form              | arrangement                                       |
      | memory  | absent            | the scratch entry "other" is a directory           |
      | memory  | a link            | the scratch entry "run" is a link to "target"      |
      | memory  | a file            | the scratch entry "run" is a file holding "x"      |
      | memory  | closed to entries | the scratch entry "run" is a closed directory      |
      | node    | absent            | the scratch entry "other" is a directory           |
      | node    | a link            | the scratch entry "run" is a link to "target"      |
      | node    | a file            | the scratch entry "run" is a file holding "x"      |
      | node    | closed to entries | the scratch entry "run" is a closed directory      |

  Scenario Outline: runtime filesystem <adapter> fails a shared directory it cannot make
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "cache" is a closed directory
    Then the runtime filesystem ensures "cache/npm" below the scratch root: "failed"
    And the runtime filesystem ensures "cache" below the scratch root: "ok"

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> makes directories and files only inside an allocated run, and only where nothing is
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run" is a directory
    And the scratch entry "target" is a directory
    And the scratch entry "cache/npm" is a directory
    When the runtime filesystem allocates 1 runs
    Then the runtime filesystem makes the directory "tmp" in the run: true
    And the runtime filesystem makes the directory "tmp" in the run: false
    And the runtime filesystem makes the directory "absent/tmp" in the run: false
    And the runtime filesystem makes the file "admission.json" holding "first" in the run: true
    And the runtime filesystem makes the file "admission.json" holding "second" in the run: false
    And the run file "admission.json" holds "first"
    And the runtime filesystem makes the file "tmp/empty" holding "" in the run: true
    And the run file "tmp/empty" holds ""
    And the runtime filesystem makes no file nor directory directly in "run", in "cache/npm" or at the root
    Given the run entry "linked" is a link to "target"
    Then the runtime filesystem makes the file "linked/x" holding "x" in the run: false
    And the runtime filesystem makes the directory "linked/y" in the run: false
    And the runtime filesystem makes the file "linked" holding "x" in the run: false
    And the scratch entry "target" is empty
    Given the run entry "closed" is a closed directory
    Then the runtime filesystem makes the directory "closed/x" in the run: false
    And the runtime filesystem makes the file "closed/x" holding "x" in the run: false

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> discards a run it made and could not finish, and nothing beside it
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run/rkept01/kept" is a file holding "kept"
    When the runtime filesystem allocates 1 runs
    And the runtime filesystem makes in the run the directories "tmp", "config" and "config/npm" and the file "config/npm/user.npmrc"
    Then the runtime filesystem discards the run with what it made: true
    And the run allocated does not exist
    And the scratch entry "run/rkept01/kept" holds "kept"

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario Outline: runtime filesystem <adapter> leaves a run that is no longer what it made: <case>
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run" is a directory
    And the scratch entry "target" is a directory
    When the runtime filesystem allocates 1 runs
    And the runtime filesystem makes in the run the directories "tmp", "config" and "config/npm" and the file "config/npm/user.npmrc"
    And <change>
    Then the runtime filesystem discards the run with what it made: false
    And <left>
    And the scratch entry "target" is empty

    Examples:
      | adapter | case                                               | change                                                | left                                                     |
      | memory  | it holds an entry it did not make                  | the run entry "foreign" is a file holding "x"         | the run entry "foreign" holds "x"                        |
      | memory  | a directory it made holds an entry it did not make | the run entry "tmp/foreign" is a file holding "x"     | the run entry "tmp" is a directory                       |
      | memory  | an entry it made is now a link                     | the run entry "tmp" is replaced by a link to "target" | the run entry "tmp" is a link                            |
      | memory  | the run was replaced                               | the run is replaced by another directory              | the run directory is not the one allocated               |
      | memory  | run became a link                                  | the directory "run" is replaced by a link to its copy | the run entry "config/npm/user.npmrc" holds ""           |
      | memory  | an entry it made is gone                           | the run entry "tmp" is removed                        | the run entry "" is a directory                          |
      | memory  | the run is gone                                    | the run entry "" is removed                           | the run allocated does not exist, nor what it made in it |
      | memory  | run is gone                                        | the scratch entry "run" is removed                    | the scratch entry "run" does not exist                   |
      | node    | it holds an entry it did not make                  | the run entry "foreign" is a file holding "x"         | the run entry "foreign" holds "x"                        |
      | node    | a directory it made holds an entry it did not make | the run entry "tmp/foreign" is a file holding "x"     | the run entry "tmp" is a directory                       |
      | node    | an entry it made is now a link                     | the run entry "tmp" is replaced by a link to "target" | the run entry "tmp" is a link                            |
      | node    | the run was replaced                               | the run is replaced by another directory              | the run directory is not the one allocated               |
      | node    | run became a link                                  | the directory "run" is replaced by a link to its copy | the run entry "config/npm/user.npmrc" holds ""           |
      | node    | an entry it made is gone                           | the run entry "tmp" is removed                        | the run entry "" is a directory                          |
      | node    | the run is gone                                    | the run entry "" is removed                           | the run allocated does not exist, nor what it made in it |
      | node    | run is gone                                        | the scratch entry "run" is removed                    | the scratch entry "run" does not exist                   |

  Scenario Outline: runtime filesystem <adapter> discards nothing for a root or a run of another identity: <case>
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run" is a directory
    When the runtime filesystem allocates 1 runs
    And the runtime filesystem makes in the run the directories "tmp", "config" and "config/npm" and the file "config/npm/user.npmrc"
    Then the runtime filesystem discards the run, told <case>: false
    And the run entry "tmp" is a directory
    And the run entry "config/npm/user.npmrc" holds ""

    Examples:
      | adapter | case                      |
      | memory  | another device for root   |
      | memory  | another inode for root    |
      | memory  | another device for run    |
      | memory  | another inode for run     |
      | node    | another device for root   |
      | node    | another inode for root    |
      | node    | another device for run    |
      | node    | another inode for run     |

  Scenario Outline: runtime filesystem <adapter> removes nothing when a path it is told leaves the run or is empty: <made>
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    And the scratch entry "run/rkept01" is a directory
    When the runtime filesystem allocates 1 runs
    And the runtime filesystem makes in the run the directories "tmp", "config" and "config/npm" and the file "config/npm/user.npmrc"
    Then the runtime filesystem discards the run with the paths <made>: false
    And the run entry "tmp" is a directory
    And the scratch entry "run/rkept01" is a directory

    Examples:
      | adapter | made                  |
      | memory  | "../rkept01", "tmp"   |
      | memory  | "", "tmp"             |
      | node    | "../rkept01", "tmp"   |
      | node    | "", "tmp"             |

  Scenario: the host runtime filesystem makes runs and their files private to the account
    Given a runtime filesystem of the node adapter over a scratch root
    And the scratch entry "run" is a directory
    When the runtime filesystem allocates 1 runs
    Then the runtime filesystem makes the directory "tmp" in the run: true
    And the runtime filesystem makes the file "admission.json" holding "x" in the run: true
    And the runtime filesystem ensures "cache/npm" below the scratch root: "ok"
    And on the host the run and "tmp" have the mode 700, "admission.json" the mode 600 and "cache/npm" the mode 700

  Scenario: the host runtime filesystem leaves no descriptor open after reading a marker and making a file
    Given a runtime filesystem of the node adapter over a scratch root
    And the scratch entry "run" is a directory
    And the scratch entry ".architect-os-runtime-root" is a file holding "architect-os-runtime-root/v2\n"
    And the scratch entry "folder" is a directory
    And the scratch entry "folder/.architect-os-runtime-root" is a directory
    When the runtime filesystem allocates 1 runs
    Then reading the marker of the scratch root and of "folder", then making two files in the run, leaves as many descriptors open as before

  Scenario: the host runtime filesystem takes the home from the account record, not from the variable HOME
    Given a runtime filesystem of the node adapter over a scratch root
    Then the host runtime filesystem names the home of the account record even when HOME names another directory

  Rule: what a real disk does not do on demand, staged on the calls the host adapter makes

    Scenario Outline: the host runtime filesystem reads a marker <case>
      Given a runtime filesystem of the node adapter over a scratch root, whose calls <calls>
      And the scratch entry ".architect-os-runtime-root" is a file holding "architect-os-runtime-root/v2\nenvironment=server\n"
      Then the runtime filesystem reads the marker of the scratch root as <reading>
      And the host runtime filesystem has closed every descriptor it opened

      Examples:
        | case                                                     | calls                                    | reading                  |
        | given seven bytes at a time, whole                       | read seven bytes at most                 | its bytes                |
        | whose read ends before its size, as unreadable           | read seven bytes, then the end           | unreadable               |
        | whose stat gives a smaller size, as unreadable           | stat the descriptor one byte smaller     | unreadable               |
        | whose descriptor is not a regular file, as unreadable    | stat the descriptor as a pipe            | unreadable               |
        | whose read fails once open, as unreadable                | fail to read                             | unreadable               |
        | whose stat fails once open, as unreadable                | fail to stat the descriptor              | unreadable               |
        | whose close fails, as unreadable                         | fail to close, then close                | unreadable               |

    Scenario Outline: the host runtime filesystem makes no file when <case>
      Given a runtime filesystem of the node adapter over a scratch root, whose calls <calls>
      And the scratch entry "run" is a directory
      When the runtime filesystem allocates 1 runs
      Then the runtime filesystem makes the file "admission.json" holding "x" in the run: false
      And the run entry "admission.json" does not exist
      And the host runtime filesystem has closed every descriptor it opened

      Examples:
        | case                    | calls                       |
        | its write fails         | fail to write               |
        | its close fails         | fail to close, then close   |

    Scenario: the host runtime filesystem finds unsafe a shared directory removed as soon as it is made
      Given a runtime filesystem of the node adapter over a scratch root, whose calls remove what is at a path before they look at it
      Then the runtime filesystem ensures "cache" below the scratch root: "unsafe"
      And the scratch entry "cache" does not exist

    Scenario Outline: the host runtime filesystem gives no sample of a directory replaced while it is measured: <case>
      Given a runtime filesystem of the node adapter over a scratch root, whose calls <calls>
      Then the runtime filesystem gives no sample of the scratch root

      Examples:
        | case            | calls                                            |
        | another inode   | stat the directory with another inode the second time |
        | another device  | stat the directory with another device the second time |

  Scenario Outline: The retained state requires the owner and private mode on <adapter>
    Given a runtime filesystem of the <adapter> adapter over a scratch root
    Then the runtime filesystem refuses an unprotected state on both passes while accepting its private state

    Examples:
      | adapter |
      | memory  |
      | node    |

  Scenario: The host binds persistent state to the same account
    Given a runtime filesystem of the node adapter over a scratch root
    Then the host runtime filesystem refuses state owned by another account before and during allocation
