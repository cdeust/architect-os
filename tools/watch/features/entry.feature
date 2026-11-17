Feature: npm run watch, the entry point (cli.ts only hands the process to main.ts)

  Scenario: the dependencies of a process
    When I build the watch dependencies of a fake process with the arguments "node cli.ts check"
    Then the watch dependencies hold the arguments "check" and the working directory of that process
    And the watch dependencies write to the streams of that process and use the clock and the fetch of node, with the limits of the design
    And the watch dependencies hold the root of this repository
