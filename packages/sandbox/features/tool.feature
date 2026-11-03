Feature: code.json, the descriptive file of the 1a.0 tool

  Scenario: loads against the strict schema: builder profile, claude, builder-guard plugin
    When I load the committed code.json
    Then the tool profile is "builder"
    And the tool command is exactly "claude"
    And the tool plugin directories are exactly "plugins/builder-guard"
    And the tool auth proxy upstream is "https://api.anthropic.com"
    And the plugin manifest of the first plugin directory exists in the repository

  Scenario: the auth proxy options are those of code.json, the usage log under the home directory
    When I load the committed code.json
    And I build the auth proxy options with the session token "session-t"
    Then the auth proxy options carry the upstream, routes, betas and policy of code.json
    And the auth proxy options carry the session token "session-t" and the given credential source
    And the auth proxy usage log is ".local/state/architect-os/usage.jsonl" under the home directory

  Scenario: accepts a copy with two routes
    When I change a copy of the committed code.json to have two routes
    Then parsing the changed code.json succeeds

  Scenario Outline: rejects a broken copy with <defect>
    When I break a copy of the committed code.json with <defect>
    Then parsing the broken code.json fails

    Examples:
      | defect                 |
      | a misspelt key         |
      | an empty command       |
      | a plain-http upstream  |
      | an xhttps upstream     |
      | an httpsx upstream     |
      | an unanchored route    |
      | no body field          |
      | a zero body size limit |
      | a fractional body size |
