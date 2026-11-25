Feature: A physical checkout has one live Gate and restores only its own interrupted mutation

  Scenario Outline: The native Gate checkout lease handles <case>
    Then the native Gate proves "<case>" in disposable Git checkouts

    Examples:
      | case                  |
      | concurrent aliases    |
      | independent checkouts |
      | candidate capability  |
      | unowned descriptor    |
      | restore before start  |
      | operator edit         |
      | replacement inode     |
      | different marked root |
      | trusted issuer        |
      | unchecked source      |
      | incomplete journal    |
      | admission lost        |
      | interrupted validator |
      | nested repository     |
      | rewritten bytes       |
      | linked nested worktree |
      | staged addition |
      | index mode differs |
      | index unresolved |
      | untouched converted checkout |
      | interrupted mutation with nested repository |
