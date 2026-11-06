Feature: module and worker profiles of the platform (docs/design/platform-v3-srt.md, §5, brick 1b.5)
  profiles/module.json and profiles/worker.json are descriptive files, under the strict schema of the builder profile. A
  module reaches the gateway only, on its callback channel; a worker reaches the broker only, with the token of its task
  as its API key. Neither writes outside its disposable cwd, its own folders and the files it is given, and neither reads
  the secrets of the host.

  Scenario Outline: the committed <name> profile denies the secrets of the host and writes only its own folders
    When I load the committed <name> profile
    Then the profile denies reading exactly:
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
    And the profile denies writing to exactly:
      | ${worktree}/.mcp.json |
      | ${worktree}/.claude   |
    And the profile unsets exactly the variables:
      | NO_PROXY |
      | no_proxy |
    And the profile sets the variable "TMPDIR" to "${tmp}"

    Examples:
      | name   |
      | module |
      | worker |

  Scenario: a module reaches the gateway only, on its callback channel, and carries no secret
    When I load the committed module profile
    Then the profile allows the network domains exactly:
      | 127.0.0.1:${callbackPort} |
    And the profile allows writing to exactly:
      | ${worktree} |
      | ${tmp}  |
    And the profile passes exactly the variables:
      | HOME     |
      | PATH     |
      | LANG     |
      | LC_ALL   |
      | LC_CTYPE |
    And the profile sets exactly the variables:
      | TMPDIR | ${tmp} |
    When I resolve the profile with the variables of a platform process
    Then the resolved network domains are exactly "127.0.0.1:8080"
    And the resolved profile contains no "${" placeholder

  Scenario: a worker reaches the broker only, with the token of its task as its API key, in its own config folder
    When I load the committed worker profile
    Then the profile allows the network domains exactly:
      | 127.0.0.1:${brokerPort} |
    And the profile allows writing to exactly:
      | ${worktree}   |
      | ${config} |
      | ${tmp}    |
    And the profile passes exactly the variables:
      | HOME     |
      | PATH     |
      | LANG     |
      | LC_ALL   |
      | LC_CTYPE |
    And the profile sets exactly the variables:
      | TMPDIR                                   | ${tmp}                         |
      | CLAUDE_CODE_TMPDIR                       | ${tmp}                         |
      | CLAUDE_CONFIG_DIR                        | ${config}                      |
      | ANTHROPIC_BASE_URL                       | http://127.0.0.1:${brokerPort} |
      | ANTHROPIC_API_KEY                        | ${taskToken}                   |
      | CLAUDE_CODE_SUBPROCESS_ENV_SCRUB         | 1                              |
      | CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC | 1                              |
      | DISABLE_AUTOUPDATER                      | 1                              |
      | DISABLE_TELEMETRY                        | 1                              |
    When I resolve the profile with the variables of a platform process
    Then the resolved network domains are exactly "127.0.0.1:8084"
    And the resolved environment sets "ANTHROPIC_API_KEY" to "task-token"
    And the resolved environment sets "ANTHROPIC_BASE_URL" to "http://127.0.0.1:8084"
    And the resolved profile contains no "${" placeholder

  Scenario Outline: the committed <name> profile, broken with <defect>, is refused
    When I break a copy of the committed <name> profile with <defect>
    Then parsing the broken profile fails with "PROFILE_INVALID"

    Examples:
      | name   | defect                                |
      | module | a weakening option                    |
      | module | a misspelt key [T-01]                 |
      | module | an API key passed through             |
      | module | NO_PROXY passed through               |
      | module | a literal token written in the file   |
      | worker | a weakening option                    |
      | worker | a misspelt key [T-01]                 |
      | worker | an API key passed through             |
      | worker | a config dir set                      |
      | worker | NO_PROXY passed through               |
      | worker | a literal token written in the file   |
      | worker | a base URL to another host            |
      | worker | a literal API key written in the file |
