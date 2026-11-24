Feature: The Step builder

  Scenario Outline: A builder reports the native outcome and bounds its event sink
    Given the "<adapter>" builder receives a "<session>" native session
    Then the Builder port returns the native outcome and usage
    And the Builder port refuses a stream one byte over its limit

    Examples:
      | adapter | session   |
      | Claude  | completed |
      | memory  | completed |
      | Claude  | stopped   |
      | memory  | stopped   |
      | Codex   | completed |
      | Codex   | stopped   |

  Scenario: A request for the other provider never enters SRT
    Then a Claude Builder rejects a Codex session before launch

  Scenario Outline: The pipe protocol and native completion have independent witnesses
    Given the "Codex" builder receives a "<fixture>" native session
    Then the native pipe run finishes with "<result>"

    Examples:
      | fixture | result |
      | nonzero | refused |
      | no completion | refused |
      | no requests | refused |
      | bad token | refused |
      | abort during run | stopped |
      | bad request | SBX_FRAME_INVALID |
      | invalid JSON | SBX_FRAME_INVALID |
      | oversize | SBX_FRAME_LIMIT |
      | cut frame | SBX_FRAME_INCOMPLETE |
      | extra field | SBX_RESULT_INVALID |
      | extra frame | SBX_EXTRA_FRAME |
      | root | SBX_RESULT_INVALID |
      | version | SBX_CLIENT_FAILED |
      | empty | SBX_CLIENT_FAILED |
      | bad child exit | SBX_CLIENT_FAILED |
      | failed terminal | refused |
      | frame boundary | accepted |
      | invalid UTF8 | SBX_FRAME_INVALID |
      | null frame | SBX_FRAME_INVALID |
      | hardlink | SBX_WORKTREE_ENTRY |
      | wrong digest | SBX_ARCHIVE_DIGEST |
      | archive inside | SBX_HOST_ASSET_IN_WORKTREE |
      | archive symlink | SBX_ARCHIVE_REQUIRED |
      | other provider | BUILDER_PROVIDER |
      | long report | BUILDER_OUTPUT_LIMIT |
      | boundary report | accepted |
      | mixed terminals | refused |
      | broken pipe | SBX_PIPE_WRITE |
      | elapsed | elapsed |
