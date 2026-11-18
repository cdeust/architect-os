Feature: The one file of the delivery command that starts processes (programs every machine has: node)
  A program is an argv started without a shell, in a directory of the scenario.

  Rule: Run to its end

    Scenario: a program that exits 0 gives its code and its standard output
      When I run the script "process.stdout.write('hello')" to its end
      Then the program ended with 0 and printed "hello"

    Scenario: a program that exits non-zero gives its code and what it printed
      When I run the script "process.stdout.write('partial'); process.exit(3)" to its end
      Then the program ended with 3 and printed "partial"

    Scenario: the standard error is not part of the output
      When I run the script "const fs = require('node:fs'); fs.writeSync(1, 'out'); fs.writeSync(2, 'err')" to its end
      Then the program ended with 0 and printed "out"

    Scenario: a program that reads its input finds it ended at once
      When I run the script "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('end of input'))" to its end
      Then the program ended with 0 and printed "end of input"

    Scenario: a program that does not exist did not run to its end
      When I run a program that does not exist to its end
      Then the program did not run to its end

    Scenario: a program that a signal ended did not run to its end
      When I run the script "process.kill(process.pid, 'SIGKILL')" to its end
      Then the program did not run to its end

    Scenario: an argument with a space, a quote and a dollar reaches the program as it is
      When I run the script "process.stdout.write(process.argv[1])" with the argument "a b\"c'd $HOME" to its end
      Then the program ended with 0 and printed "a b\"c'd $HOME"

    Scenario: the program is given the environment it is passed, complete
      When I run the script "process.stdout.write(process.env.HOST_PROCESS_SEEN)" with only the variable "HOST_PROCESS_SEEN" set to "seen" to its end
      Then the program ended with 0 and printed "seen"

    Scenario: the program is given nothing of the environment of this process
      Given this process has the variable "HOST_PROCESS_INHERITED" set to "inherited" until the scenario ends
      When I run the script "process.stdout.write(String(process.env.HOST_PROCESS_INHERITED))" with only the variable "HOST_PROCESS_SEEN" set to "seen" to its end
      Then the program ended with 0 and printed "undefined"

    Scenario: the environment of this process, passed whole, is the one the program sees
      Given the process has the variable "HOST_PROCESS_WHOLE" set to "whole"
      When I run the script "process.stdout.write(process.env.HOST_PROCESS_WHOLE)" with the environment of this process to its end
      Then the program ended with 0 and printed "whole"

    Scenario: the program runs in the directory it is given
      When I run the script "process.stdout.write(process.cwd())" to its end
      Then the program printed the directory it ran in

  Rule: The closed environment of a program

    Scenario Outline: the names that the host sets are taken, then what the caller adds, which wins
      When I close the environment of the names "<names>" over a host that sets "<host>" with "<added>" added
      Then the closed environment is "<closed>"

      Examples:
        | names     | host             | added      | closed      |
        | A,B       | A=1,B=2,C=3      |            | A=1,B=2     |
        | A,B       | A=1              |            | A=1         |
        | A         | A=1              | G=0        | A=1,G=0     |
        | A         | A=1              | A=2        | A=2         |
        |           | A=1              | G=0        | G=0         |
        | A         |                  |            |             |

    Scenario: a name that the host leaves undefined is not given
      When I close the environment of the name "A" over a host that leaves it undefined
      Then the closed environment is ""

  Rule: Run with both outputs in a file

    Scenario: both outputs land in the file, in the order they were written
      When I run the script "const fs = require('node:fs'); fs.writeSync(1, 'out'); fs.writeSync(2, 'err')" to a file
      Then the program exited 0
      And the file holds "outerr"

    Scenario: a non-zero exit code is given
      When I run the script "process.exit(3)" to a file
      Then the program exited 3

    Scenario: the file is closed once the program has ended
      When I run the script "process.exit(0)" to a file
      Then the run left no descriptor open

    Scenario: the file is closed when the program could not be started
      When I run a program whose name holds a NUL to a file
      Then the run left no descriptor open

    Scenario: the file of a previous run is emptied
      Given the file already holds "a previous run"
      When I run the script "process.exit(0)" to a file
      Then the file holds ""

    Scenario: a program that a signal ended exits 1
      When I run the script "process.kill(process.pid, 'SIGKILL')" to a file
      Then the program exited 1

    Scenario: a program that does not exist exits 1
      When I run a program that does not exist to a file
      Then the program exited 1

    Scenario: a program spawn refuses to start exits 1
      When I run a program whose name holds a NUL to a file
      Then the program exited 1

    Scenario: the program is given no input: reading it ends at once
      When I run the script "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('end of input'))" to a file
      Then the program exited 0
      And the file holds "end of input"

    Scenario: the program runs in the directory it is given
      When I run the script "process.stdout.write(process.cwd())" to a file
      Then the file holds the directory it ran in

    Scenario: the program inherits the environment of this process: it is the gate command, a whole suite
      Given this process has the variable "HOST_PROCESS_INHERITED" set to "inherited" until the scenario ends
      When I run the script "process.stdout.write(process.env.HOST_PROCESS_INHERITED)" to a file
      Then the file holds "inherited"
