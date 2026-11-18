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

    Scenario: an added variable is seen by the program
      When I run the script "process.stdout.write(process.env.HOST_PROCESS_ADDED)" with the variable "HOST_PROCESS_ADDED" added as "seen" to its end
      Then the program ended with 0 and printed "seen"

    Scenario: the variables of this process are inherited
      When I run the script "process.stdout.write(process.env.PATH)" to its end
      Then the program printed the PATH of this process

    Scenario: the program runs in the directory it is given
      When I run the script "process.stdout.write(process.cwd())" to its end
      Then the program printed the directory it ran in

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
