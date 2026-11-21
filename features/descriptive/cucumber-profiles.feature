Feature: Cucumber profiles
  cucumber.mjs has the default profile, which `npm test` and the gate count, and the `mutation` profile, which only
  Stryker uses (docs/design/platform-v3-srt.md §7). The mutation profile leaves out features/repository and
  features/arch and nothing else: this feature checks that no area is forgotten by the profiles. Why those two areas
  are outside is written in cucumber.mjs, at the profile.

  Scenario: the default profile is a plain scope that covers every feature of the gate
    Given the committed cucumber configuration
    Then its default profile has no tags, no name, retry 0 and strict
    And its default profile covers every feature file of the gate

  Scenario: the mutation profile differs from the default only by excluding features/repository and features/arch
    Given the committed cucumber configuration
    Then its mutation profile differs from the default profile only by its paths
    And its mutation profile covers every feature file of the default profile except those of features/repository and features/arch

  Scenario: component priority only permutes the mutation profile
    Given the committed cucumber configuration
    Then prioritizing mutated components preserves every scenario of the independent catalogue

  Scenario: a mutation profile that brings features/arch back is rejected
    Given the committed cucumber configuration
    Then a mutation profile that brings features/arch back is rejected

  Scenario: Stryker uses the mutation profile
    Given the committed Stryker configuration
    Then its cucumber runner profile is "mutation"

  Scenario: Stryker gives its first run an explicit bound
    Given the committed Stryker configuration
    Then its first run has an explicit bound of 20 minutes

  Scenario: a default profile with tags is rejected
    Given the committed cucumber configuration
    Then a default profile with tags is rejected

  Scenario: a default profile with a name filter is rejected
    Given the committed cucumber configuration
    Then a default profile with a name filter is rejected

  Scenario: a mutation profile that also drops features/integration is rejected
    Given the committed cucumber configuration
    Then a mutation profile that also drops features/integration is rejected
