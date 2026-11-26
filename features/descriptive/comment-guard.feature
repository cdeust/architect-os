Feature: The guard of the comments of the Claude review
  claude-review.yml publishes what Claude writes, through two tools of the action: the tracking comment
  (mcp__github_comment__update_claude_comment) and inline comments (mcp__github_inline_comment__create_inline_comment).
  A prompt injected by the pull request can shape that text. A comment is acted on when it is created: an app such as
  Codex obeys an @mention whoever writes it, and the merge resolver reads a line `Verdict:` of claude[bot]. So the
  refusal happens before the call, in a PreToolUse hook of the managed settings (.github/claude-review/comment-guard.py,
  installed by a trusted step in /etc/claude-code). It reads the body after removing the format characters (Unicode
  category Cf: zero-width, joiners, soft hyphen, direction marks) and folding compatibility forms (NFKC), and refuses
  a mention, a verdict anywhere but the last two lines of the tracking comment, and the shape of a credential.

  Scenario Outline: the guard refuses a comment that <attempt>
    Then the comment guard refuses a call of "<tool>" whose body <attempt>

    Examples:
      | tool                                              | attempt                                            |
      | mcp__github_inline_comment__create_inline_comment | mentions an app                                    |
      | mcp__github_comment__update_claude_comment        | mentions an app                                    |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a zero-width space         |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a zero-width non-joiner    |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a zero-width joiner        |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a word joiner              |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a byte order mark          |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a soft hyphen              |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a right-to-left mark       |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a left-to-right override   |
      | mcp__github_inline_comment__create_inline_comment | mentions an app through a fullwidth at sign        |
      | mcp__github_inline_comment__create_inline_comment | holds a verdict                                    |
      | mcp__github_comment__update_claude_comment        | holds a verdict before its end                     |
      | mcp__github_comment__update_claude_comment        | holds two verdicts                                 |
      | mcp__github_comment__update_claude_comment        | ends with a verdict without the link of the run    |
      | mcp__github_comment__update_claude_comment        | ends with a verdict linked to another run          |
      | mcp__github_comment__update_claude_comment        | ends with a verdict of another word                |
      | mcp__github_inline_comment__create_inline_comment | holds the shape of a key of Anthropic              |
      | mcp__github_inline_comment__create_inline_comment | holds a key of Anthropic cut by a zero-width space |
      | mcp__github_comment__update_claude_comment        | holds the shape of a GitHub token                  |
      | mcp__github_inline_comment__create_inline_comment | ends with the link of the run and a verdict        |
      | mcp__github_inline_comment__create_inline_comment | is not a string                                    |
      | mcp__github_inline_comment__create_inline_comment | is missing                                         |

  Scenario Outline: the guard lets through a comment that <case>
    Then the comment guard lets through a call of "<tool>" whose body <case>

    Examples:
      | tool                                              | case                                         |
      | mcp__github_inline_comment__create_inline_comment | says what is wrong without a mention         |
      | mcp__github_comment__update_claude_comment        | ends with the link of the run and a verdict  |
      | mcp__github_comment__update_claude_comment        | has no verdict yet                           |

  Scenario: the guard, outside a run, has no link to accept a verdict after
    Then the comment guard, outside a run, refuses a tracking comment that ends with a verdict

  Scenario: the guard lets through the calls of the other tools
    Then the comment guard lets through a call of another tool

  Scenario: the guard refuses what it cannot read
    Then the comment guard refuses an input that is not JSON

  Scenario: the guard gives no reason that echoes the comment
    Then the reason of every refusal of the comment guard is one of its fixed reasons
