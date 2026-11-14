Feature: Reviewer profile template
  profiles/reviewer.json is a descriptive file, under the strict schema of the builder profile. A review session reads the
  worktree and reports; it cannot write the worktree nor the repository's .git, reaches the host auth proxy only, and
  denies reading the same secrets of the host as the builder.

  Scenario: loads the committed file against the strict schema
    When I load the committed reviewer profile
    Then the profile grants at least one write path

  Scenario: writes its own folders only, reaches the host auth proxy only, and reads no secret of the host
    When I load the committed reviewer profile
    Then the profile allows writing to exactly:
      | ${config} |
      | ${tmp}    |
    And the profile denies writing to exactly:
      | ${config}/settings.json |
    And the profile denies reading exactly:
      | ${home}/.ssh                 |
      | ${home}/.aws                 |
      | ${home}/.gnupg               |
      | ${home}/.config/gh           |
      | ${home}/.config/architect-os |
      | ${home}/.npmrc               |
      | ${home}/.netrc               |
      | ${home}/.claude              |
      | ${home}/.claude.json         |
      | ${home}/Library/Keychains    |
      | ${sandboxes}                  |
    And the profile allows reading exactly:
      | ${config} |
      | ${tmp} |
    And the profile allows the network domains exactly:
      | 127.0.0.1:${authProxyPort} |
    And the profile allows no pseudo-terminal
    And the profile unsets exactly the variables:
      | NO_PROXY |
      | no_proxy |

  Scenario: carries the environment of the builder without the npm cache, and a settings file that allows no edit
    When I load the committed reviewer profile
    Then the profile passes exactly the variables:
      | HOME         |
      | USER         |
      | LOGNAME      |
      | PATH         |
      | SHELL        |
      | TERM         |
      | COLORTERM    |
      | TERM_PROGRAM |
      | LANG         |
      | LC_ALL       |
      | LC_CTYPE     |
    And the profile sets exactly the variables:
      | CLAUDE_CODE_TMPDIR               | ${tmp}                            |
      | CLAUDE_CONFIG_DIR                | ${config}                         |
      | ANTHROPIC_BASE_URL               | http://127.0.0.1:${authProxyPort} |
      | ANTHROPIC_API_KEY                | ${sessionToken}                   |
      | CLAUDE_CODE_SUBPROCESS_ENV_SCRUB | 1                                 |
      | TMPPREFIX                        | ${tmp}/zsh                        |
    When I resolve the profile with the test variables
    Then the resolved file "/t/aos/config/settings.json" equals '{"sandbox":{"enabled":false},"permissions":{"allow":["Bash","Read"],"deny":["Bash(git push *)","Bash(git config *)","Bash(security *)","Read(//h/.ssh/**)","Edit(//h/.ssh/**)","Read(//h/.aws/**)","Edit(//h/.aws/**)","Read(//h/.gnupg/**)","Edit(//h/.gnupg/**)","Read(//h/.config/gh/**)","Edit(//h/.config/gh/**)","Read(//h/.npmrc)","Edit(//h/.npmrc)","Read(//h/.netrc)","Edit(//h/.netrc)","Read(//h/.claude/**)","Edit(//h/.claude/**)","Read(//h/.claude.json)","Edit(//h/.claude.json)","Read(//h/Library/Keychains/**)","Edit(//h/Library/Keychains/**)","Edit(//r/.git/hooks/**)","Edit(//r/.git/config)","Edit(//r/.claude/worktrees/w/.claude/**)"]}}'
    And the resolved file "/t/aos/config/.claude.json" contains '{"projects":{"/r":{"hasTrustDialogAccepted":true},"/r/.claude/worktrees/w":{"hasTrustDialogAccepted":true}}}'

  Scenario: never makes the worktree, the repository's .git or the user files writable
    When I load the committed reviewer profile
    And I resolve the profile with the test variables
    Then none of these paths is writable:
      | /r/.claude/worktrees/w/src/x.ts              |
      | /r/.claude/worktrees/w/.claude/settings.json |
      | /r/.git/objects/ab                           |
      | /r/.git/refs/heads/w                         |
      | /r/.git/logs/HEAD                            |
      | /r/.git/worktrees/w/index                    |
      | /r/.git/hooks/pre-commit                     |
      | /r/.git/config                               |
      | /h/.cache/x                                  |
      | /h/.claude/settings.json                     |
      | /h/.claude.json                              |
      | /t/aos/config/settings.json                  |
      | /t/aos/profile.json                          |
    And all of these paths are writable:
      | /t/aos/config/.claude.json |
      | /t/aos/tmp/x               |

  Scenario Outline: the committed reviewer profile, broken with <defect>, is refused
    When I break a copy of the committed reviewer profile with <defect>
    Then parsing the broken profile fails with "PROFILE_INVALID"

    Examples:
      | defect                                |
      | a weakening option                    |
      | a misspelt key [T-01]                 |
      | filesystem.disabled                   |
      | allowGitConfig                        |
      | an API key passed through             |
      | a config dir set                      |
      | NO_PROXY passed through               |
      | a literal token written in the file   |
      | a base URL to another host            |
      | a literal API key written in the file |
