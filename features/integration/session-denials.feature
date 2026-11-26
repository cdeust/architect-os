Feature: The denials of .claude/settings.json before a real Claude Code
  The project settings deny a session the calls that the ruleset of `main` refuses (a push to `main`, a bypass) or
  that the rules of the repository leave to the merge resolver and to the owner (a merge, an edit of a ruleset):
  docs/infrastructure.md, "What a session is spared". They are friction, not a control: a rule matches the text of
  a command, and the last two rows are the same calls written another way, which run. What holds `main` is the
  ruleset. A real Claude Code, the binary of the pinned Agent SDK, runs before a scripted model that asks for each
  call; `gh`, `git` and the GitHub MCP server are stand-ins that record what reaches them.

  Scenario: a real Claude Code refuses the calls the settings deny, and runs the same calls written another way
    When a real Claude Code under the denials of .claude/settings.json is asked by a scripted model for these calls
      | call                                                                    | outcome |
      | gh pr merge 12                                                          | refused |
      | gh pr merge                                                             | refused |
      | gh -R owner/repo pr merge 12 --squash                                   | refused |
      | gh pr review 12 --approve --admin                                       | refused |
      | gh api -X PUT repos/owner/repo/pulls/12/merge                           | refused |
      | gh api repos/owner/repo/pulls/12/merge -X PUT                           | refused |
      | gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }' | refused |
      | mcp__github__merge_pull_request                                         | refused |
      | mcp__github__update_pull_request_branch                                 | refused |
      | gh pr update-branch 12                                                  | refused |
      | git merge-base main HEAD                                                | refused |
      | git push origin main                                                    | refused |
      | git push origin main --force-with-lease                                 | refused |
      | git push origin main:main                                               | refused |
      | git push origin HEAD:main                                               | refused |
      | git push origin HEAD:main --force                                       | refused |
      | git push origin HEAD:refs/heads/main                                    | refused |
      | gh api repos/owner/repo/rulesets/1 -X DELETE                            | refused |
      | gh api repos/owner/repo/rulesets/1 --method DELETE                      | refused |
      | gh api repos/owner/repo/rulesets --input ruleset.json                   | refused |
      | gh api -X DELETE repos/owner/repo/rulesets/1                            | refused |
      | gh api --method DELETE repos/owner/repo/rulesets/1                      | refused |
      | gh api --input ruleset.json repos/owner/repo/rulesets                   | refused |
      | gh api repos/owner/repo/rulesets/1                                      | ran     |
      | gh api repos/owner/repo/pulls/12 --jq .mergeable_state                  | ran     |
      | gh pr create --title t --body b                                         | ran     |
      | gh pr view 12 --json mergeable                                          | ran     |
      | git push -u origin fix/a-branch                                         | ran     |
      | git push origin main-lock                                               | ran     |
      | git push origin main:a-copy-of-main                                     | ran     |
      | mcp__github__get_me                                                     | ran     |
      | git -C . push origin main                                               | ran     |
      | sh -c 'gh pr merge 12'                                                  | ran     |
    Then Claude Code refused each call marked refused and ran each call marked ran
    And the stand-ins of gh, git and the GitHub server received the calls marked ran alone
