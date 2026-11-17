Feature: the checker profile and the check of a step on the real srt adapter
  A check of a step (docs/design/orchestration-fable-5-2.md, §13, O.3c) is a command the host runs after the build, in
  the worktree the build wrote: it reads the worktree and cannot write it, and it writes its temporary folder only
  (packages/sandbox/profiles/checker.json). The check itself (`sandboxCheck`, packages/sandbox/src/step-tool.ts) gives
  the exit code and the end of the output of a real command, and its limit ends it even when a descendant that left the
  process group keeps its outputs open. Real srt sandbox: it runs on Linux and macOS.

  Scenario: srt adapter lets a checker process read the worktree, never write it
    Given an srt runner over a throwaway git repository
    And the worktree holds a file "marker" containing "worktree"
    When I start profile "checker" with command "node -p require('fs').readFileSync(process.argv[1]+'/marker','utf8') ${worktree}" and read its output to its end
    Then its output is "worktree"
    When I start profile "checker" with command "touch ${worktree}/written", close its input, drain its output and wait for it to end
    Then it does not exit with code 0
    And the worktree holds no file "written"

  Scenario: the check of a step gives the exit code and the output of a real command that reads the worktree
    Given an srt runner over a throwaway git repository
    And the worktree holds a file "marker" containing "worktree"
    When the check of a step runs "node -e process.stdout.write(require('fs').readFileSync('marker','utf8'));process.exit(3)" in the worktree
    Then the check of the step gave the output "worktree", the exit code 3, stopped "false"

  Scenario: the check of a step keeps what a real command writes on its error output
    Given an srt runner over a throwaway git repository
    When the check of a step runs "node -e process.stderr.write('refused');process.exit(1)" in the worktree
    Then the check of the step gave the output "refused", the exit code 1, stopped "false"

  Scenario: a real command of a check cannot write the worktree
    Given an srt runner over a throwaway git repository
    When the check of a step runs "touch written" in the worktree
    Then the check of the step did not exit with code 0
    And the worktree holds no file "written"

  Scenario: a real command that does not end is stopped at the limit of its check
    Given an srt runner over a throwaway git repository
    When the check of a step runs "node -e console.log('started');setInterval(()=>{},1000)" in the worktree, its limit fired once it printed "started"
    Then the check of the step was stopped, with the output "started"

  Scenario: a descendant that left the process group and keeps the outputs open does not hold a check past its limit
    Given an srt runner over a throwaway git repository
    When the check of a step runs a command that exits with code 0 and leaves a detached descendant holding its outputs, its limit fired once the command has exited
    Then the check of the step gave the output "started", the exit code 0, stopped "true"
