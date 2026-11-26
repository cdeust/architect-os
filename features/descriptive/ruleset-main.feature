Feature: The committed description of the ruleset of main
  docs/design/ruleset-main.json is the body that recreates the ruleset GitHub applies to `main`
  (docs/infrastructure.md, "How a pull request reaches main"): a pull request is required, both jobs of the gate are
  required, the branch is neither deleted nor rewritten, and no actor bypasses. The scenarios read the committed
  file, not the setting of the repository: a copy that weakens it is refused here, and a change of the setting
  itself is seen by whoever compares the two (same section).

  Scenario: the committed ruleset of main has no bypass and requires a pull request and the gate
    Given the committed description of the ruleset of main
    Then it describes a ruleset that no actor bypasses and that requires a pull request and the gate

  Scenario Outline: a ruleset of main <kind> is refused
    Given the committed description of the ruleset of main
    Then a description of the ruleset of main <kind> is refused with "<words>"

    Examples:
      | kind                                                     | words                                                   |
      | that the administrator role always bypasses              | an actor may bypass the ruleset                         |
      | that an app bypasses for pull requests                   | an actor may bypass the ruleset                         |
      | without the pull request rule                            | no rule pull_request                                    |
      | without the required checks                              | no rule required_status_checks                          |
      | that does not require gate-linux                         | gate-linux is not a required check                      |
      | that does not require gate-macos                         | gate-macos is not a required check                      |
      | that is disabled                                         | the ruleset is not enforced: disabled                   |
      | that only evaluates                                      | the ruleset is not enforced: evaluate                   |
      | that includes another branch only                        | refs/heads/main is not among the included refs          |
      | that excludes main                                       | a ref is excluded from the ruleset                      |
      | that excludes a pattern                                  | a ref is excluded from the ruleset                      |
      | that lets main be deleted                                | no rule deletion                                        |
      | that lets main be rewritten                              | no rule non_fast_forward                                |
      | with an unknown key                                      | Unrecognized key: \"current_user_can_bypass\"           |
      | with an unknown key in the pull request rule             | Unrecognized key: \"automatic\"                         |
      | with a rule of an unknown type                           | rules.4.type: Invalid discriminator value               |
      | without its bypass list                                  | bypass_actors: Invalid input: expected array            |
      | that includes a pattern beside main                      | a ref other than refs/heads/main is included            |
      | with a second rule of required checks that names none    | the rule required_status_checks is written 2 times      |
      | with the deletion rule twice                             | the rule deletion is written 2 times                    |
      | that requires a third check                              | a check other than the two jobs of the gate is required |
      | that takes a check from one app only                     | Unrecognized key: \"integration_id\"                    |
      | that does not require the checks when the ref is created | the checks are not required when the ref is created     |
