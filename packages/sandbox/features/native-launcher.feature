Feature: NativeLauncher, the launcher of the processes the design keeps outside srt
  The broker and data are children of the gateway outside any sandbox (platform-v3-srt.md, §2). The launcher starts
  them from a closed list of names, working directories, argv and environments, with real processes here: node
  with -e, never a shell. Neither the launcher nor a child has the type of a sandbox (steps/native-launcher.ts).

  Rule: a closed list

    Scenario Outline: the name <name> is not a native process, and nothing runs
      Given a native launcher whose process "writer" is node writing the marker file "marker" in its working directory
      When I try to start the native process "<name>"
      Then the native launch is refused as "UNKNOWN_PROCESS" saying "UNKNOWN_PROCESS: no native process is named <name>"
      And the native working directory holds no file "marker"

      Examples:
        | name        |
        | other       |
        | __proto__   |
        | constructor |
        | toString    |

    Scenario Outline: a declared argv whose first element is "<first>" is refused at construction
      When I build a native launcher declaring the process "relative" in its own folder with the argv "<argv>"
      Then the native launch is refused as "PATH_NOT_ABSOLUTE" saying "PATH_NOT_ABSOLUTE: relative: argv[0] must be an absolute path"

      Examples:
        | first    | argv      |
        | relative | node -e 0 |
        | missing  |           |

    Scenario: a declared working directory that is relative is refused at construction
      When I build a native launcher declaring the process "relative" in the folder "work/here" with node
      Then the native launch is refused as "PATH_NOT_ABSOLUTE" saying "PATH_NOT_ABSOLUTE: relative: its working directory must be absolute"

    Scenario: the list is closed at construction: changing the declaration afterwards changes nothing
      Given a native launcher whose process "printer" is node printing "first" and the names of its environment, its declaration changed afterwards to print "second", to hold the variable "LATE", to run elsewhere, and to declare a process "added"
      When I start the native process "printer" and read its output
      Then the native output is the line "first:" followed by the folder declared at construction
      When I try to start the native process "added"
      Then the native launch is refused as "UNKNOWN_PROCESS" saying "UNKNOWN_PROCESS: no native process is named added"

  Rule: the declared process, its environment and nothing else

    Scenario: the child sees exactly the declared variables
      Given the host environment holds PATH and HOME
      And a native launcher whose process "env" is node printing the sorted names of its environment, declared with "ALPHA" and "BETA"
      When I start the native process "env" and read its output
      Then the native output is the line "ALPHA,BETA"

    Scenario: the working directory is the declared one
      Given a native launcher whose process "cwd" is node printing its working directory
      When I start the native process "cwd" and read its output
      Then the native output is the line of the declared working directory

    Scenario: closing a child resolves once its streams are closed: the log holds what was still being written
      Given a native launcher of grace 1500 ms whose process "leaver" is node ending on the close of its input, and leaving a grandchild that writes "late" on the same stderr afterwards
      When I start the native process "leaver"
      And I close the native process
      Then the exit of the native close is code 0 and no signal
      And the log held "late" when the close of the native process resolved

    Scenario: the launcher reads the stderr of a child: its logs reach the log with its name, and a child that writes more than a pipe holds still ends on the close of its input
      Given a native launcher of grace 1500 ms whose process "talker" is node writing 204800 characters on its stderr, then reading its stdin to the end
      When I start the native process "talker"
      And I close the native process
      Then the exit of the native close is code 0 and no signal
      And the log received 204800 characters, all under the name "talker"
      And one kill was scheduled after 1500 ms, never fired, and cancelled

    Scenario: an executable that does not exist is a failure to spawn, named
      Given a native launcher whose process "ghost" is the executable "/nonexistent/aos-no-such-binary"
      When I try to start the native process "ghost"
      Then the native launch is refused as "SPAWN_FAILED" saying "SPAWN_FAILED: ghost: spawn /nonexistent/aos-no-such-binary ENOENT"

  Rule: the end of a child

    Scenario: the exit code of a child that ends by itself
      Given a native launcher whose process "code" is node exiting with code 3
      When I start the native process "code" and wait for its exit
      Then the native exit is code 3 and no signal

    Scenario: the signal of a child that ends by itself
      Given a native launcher whose process "signal" is node killing itself with SIGTERM
      When I start the native process "signal" and wait for its exit
      Then the native exit is no code and the signal "SIGTERM"

    Scenario: close ends a child that ends when its input closes: no kill, and the scheduled one is cancelled
      Given a native launcher of grace 1500 ms whose process "reader" is node reading its stdin to the end
      When I start the native process "reader"
      And I close the native process
      Then the exit of the native close is code 0 and no signal
      And one kill was scheduled after 1500 ms, never fired, and cancelled

    Scenario: close kills the whole group of a child that does not end when its input closes
      Given a native launcher of grace 1500 ms whose process "stubborn" is node starting a grandchild, printing both pids, and ignoring the end of its input
      When I start the native process "stubborn" and read the two pids
      And I ask the native process to close and fire the scheduled kill
      Then the exit of the native close is no code and the signal "SIGKILL"
      And neither the native child nor its grandchild is alive

    Scenario: a write the child no longer reads does not end the parent
      Given a native launcher whose process "deaf" is node closing its own input, saying so, then staying alive
      When I start the native process "deaf" and wait for the line it says
      Then the input of the native process has one listener for its errors
      And a line written to its input fails with "EPIPE" and raises nothing in this process
