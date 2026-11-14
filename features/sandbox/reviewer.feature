Feature: the reviewer profile on the real srt adapter
  A review session reads the worktree and cannot write it (packages/sandbox/profiles/reviewer.json). Real srt sandbox:
  it runs on Linux and macOS.

  Scenario: srt adapter lets a reviewer process read the worktree, never write it
    Given an srt runner over a throwaway git repository
    And the worktree holds a file "marker" containing "worktree"
    When I start profile "reviewer" with command "node -p require('fs').readFileSync(process.argv[1]+'/marker','utf8') ${worktree}" and read its output to its end
    Then its output is "worktree"
    When I start profile "reviewer" with command "touch ${worktree}/written", close its input, drain its output and wait for it to end
    Then it does not exit with code 0
    And the worktree holds no file "written"
