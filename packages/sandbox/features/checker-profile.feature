Feature: Checker profile template (docs/design/orchestration-fable-5-2.md, §13, O.3c)
  profiles/checker.json is a descriptive file, under the strict schema of the builder profile. A check is a command that
  the step file names and the host plays after the build, without a model: it reads the worktree and cannot write it
  nor the repository's .git, reaches no network, holds no secret and no launcher variable, and denies reading the same
  secrets of the host as the reviewer.

  Scenario: loads the committed file against the strict schema
    When I load the committed checker profile
    Then the profile grants at least one write path

  Scenario: writes its own temporary folder only, reaches no network, and reads no secret of the host
    When I load the committed checker profile
    Then the profile allows writing to exactly:
      | ${tmp} |
    And the profile denies writing to exactly:
      | /tmp/claude |
      | /private/tmp/claude |
      | ${runtime}/cache |
      | ${runtime}/state |
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
      | ${sandboxes}                 |
      | ${home}/.npm |
      | ${runtime}/run |
      | ${runtime}/state |
    And the profile allows reading exactly:
      | ${tmp} |
      | ${worktree} |
    And the profile allows no network domain and denies none
    And the profile allows no pseudo-terminal
    And the profile unsets exactly the variables:
      | NO_PROXY |
      | no_proxy |

  Scenario: passes the environment of the reviewer without the terminal variables, and works offline in its own temporary folder
    When I load the committed checker profile
    Then the profile passes exactly the variables:
      | HOME     |
      | USER     |
      | LOGNAME  |
      | PATH     |
      | SHELL    |
      | LANG     |
      | LC_ALL   |
      | LC_CTYPE |
    And the profile sets exactly the variables:
      | TMPDIR                     | ${tmp}     |
      | npm_config_cache           | ${tmp}/npm |
      | npm_config_offline         | true       |
      | npm_config_update_notifier | false      |
      | CLAUDE_CODE_TMPDIR | ${tmp} |
    And the profile writes no file

  Scenario: resolves with the variables of the adapter only, no launcher variable
    When I load the committed checker profile
    And I resolve the profile with the variables of the adapter only
    Then the resolved profile contains no "${" placeholder
    And the resolved profile reaches no network domain
    And the resolved environment sets "TMPDIR" to "/t/aos/tmp"
    And the resolved environment sets "npm_config_cache" to "/t/aos/tmp/npm"

  Scenario: never makes the worktree, the repository's .git or the user files writable
    When I load the committed checker profile
    And I resolve the profile with the variables of the adapter only
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
      | /h/.npmrc                                    |
      | /t/aos/config/x                              |
      | /t/aos/profile.json                          |
    And all of these paths are writable:
      | /t/aos/tmp/x     |
      | /t/aos/tmp/npm/y |

  Scenario Outline: the committed checker profile, broken with <defect>, is refused
    When I break a copy of the committed checker profile with <defect>
    Then parsing the broken profile fails with "PROFILE_INVALID"

    Examples:
      | defect                  |
      | a weakening option      |
      | a misspelt key [T-01]   |
      | filesystem.disabled     |
      | allowGitConfig          |
      | an API key passed through |
      | NO_PROXY passed through |
