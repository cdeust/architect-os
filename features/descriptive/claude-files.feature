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

  Scenario: .claude/settings.json denies the merge and the administrator bypass, and registers the session guard
    Then the committed .claude/settings.json denies the merge and the bypass, and registers the session guard

  Scenario Outline: a .claude/settings.json that lets a session merge or bypass is rejected: <defect>
    Then a .claude/settings.json with <defect> is rejected

    Examples:
      | defect                            |
      | no denial of gh pr merge          |
      | no denial of --admin              |
      | no denial of the MCP merge tool   |
      | no denial of the merge by the API |
      | no denial Bash(gh *pr merge*) |
      | no denial Bash(curl */merge*) |
      | no denial Bash(gh *owner-approved*) |
      | no denial Bash(curl *owner-approved*) |
      | no denial Bash(gh *addLabelsToLabelable*) |
      | no denial Bash(gh *labelIds*) |
      | no denial Bash(env *gh *) |
      | no denial Bash(gh pr update-branch *) |
      | no denial mcp__github__update_pull_request_branch |
      | no hook                           |
      | a hook on another command         |
      | a hook of another type            |
      | a matcher of Bash alone           |
      | a matcher of MCP alone            |

  Scenario Outline: the session guard, started by the command of the hook, <case>
    Then the session guard started as Claude Code starts it exits with <code> for the command "<command>"

    Examples:
      | case                               | code | command                    |
      | blocks a merge under sh -c         | 2    | sh -c 'gh pr merge 12'     |
      | blocks an administrator bypass     | 2    | gh pr merge 12 --admin     |
      | blocks the approval label with -R  | 2    | gh -R o/r pr edit 1 --add-label owner-approved |
      | blocks a merge by an absolute path | 2    | /usr/local/bin/gh pr merge 1 |
      | lets a pull request be opened      | 0    | gh pr create --title t     |
