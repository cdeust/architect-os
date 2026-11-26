Feature: .claude descriptive files
  The files Claude Code reads in this repository are checked against the frontmatter schemas of the subagent and
  slash command references. The Examples list the committed files: a new file in .claude/agents or
  .claude/commands adds its row.

  Scenario Outline: subagent <file> has a valid frontmatter and a prompt
    Given the committed file ".claude/agents/<file>"
    Then it has a valid subagent frontmatter and a prompt
    And its subagent name is the name of the file

    Examples:
      | file                       |
      | architecture-reviewer.md   |
      | security-reviewer.md       |
      | test-reviewer.md           |

  Scenario Outline: command <file> has a valid frontmatter, and every subagent it names exists
    Given the committed file ".claude/commands/<file>"
    Then it has a valid command frontmatter and a prompt
    And every subagent it names exists in .claude/agents

    Examples:
      | file         |
      | review-pr.md |

  Scenario: a descriptive file with an invalid frontmatter is rejected
    Then a text without frontmatter is rejected
    And a subagent frontmatter without description is rejected
    And a subagent frontmatter with the misspelt field allowed_tools is rejected

  Scenario: .claude/settings.json stays valid JSON with permission rule lists
    Then the committed .claude/settings.json is valid JSON with permission rule lists

  Scenario: .claude/settings.json enables the security plugins of the official marketplace
    Then the committed .claude/settings.json enables "security-guidance@claude-plugins-official"
    And the committed .claude/settings.json enables "claude-security@claude-plugins-official"
    And a .claude/settings.json that turns "claude-security@claude-plugins-official" off is rejected

  Scenario: .claude/settings.json denies the calls a session is spared
    Friction, not a control (docs/infrastructure.md, "What a session is spared"): what holds `main` is its ruleset.
    Then the committed .claude/settings.json denies every call a session is spared

  Scenario Outline: a .claude/settings.json without the denial <rule> is rejected
    Then a .claude/settings.json without the denial "<rule>" is rejected for it

    Examples:
      | rule                                    |
      | Bash(git merge-base *)                  |
      | Bash(gh pr update-branch *)             |
      | Bash(gh pr merge *)                     |
      | Bash(gh * pr merge*)                    |
      | Bash(gh * --admin*)                     |
      | Bash(gh api */merge)                    |
      | Bash(gh api */merge *)                  |
      | Bash(gh api *mergePullRequest*)         |
      | mcp__github__merge_pull_request         |
      | mcp__github__update_pull_request_branch |
      | Bash(git push * main)                   |
      | Bash(git push * main *)                 |
      | Bash(git push *:main)                   |
      | Bash(git push *:main *)                 |
      | Bash(git push *:refs/heads/main)        |
      | Bash(gh api *rulesets* -X*)             |
      | Bash(gh api *rulesets* --method*)       |
      | Bash(gh api *rulesets* --input*)        |
      | Bash(gh api -X* *rulesets*)             |
      | Bash(gh api --method* *rulesets*)       |
      | Bash(gh api --input* *rulesets*)        |
