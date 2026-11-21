Feature: Record local planning usage
  Scenario: An unsuccessful Plan attempt has one terminal receipt and no attributed generation cost
    Then a measured Plan refusal records its exit and preserves its journal on retry

  Scenario: A consumer process cannot start
    Then a planning measurement records its launch failure without a cost

  Scenario Outline: One native draft receipt binds the proposal to the prepared preview
    Then a measured "<provider>" draft supplies one receipt that binds the prepared Plan

    Examples:
      | provider |
      | gpt      |
      | gemini   |

  Scenario: A missing native provider installation produces a single refusal
    Then a measured draft without a provider installation publishes only a refusal receipt

  Scenario: A measured Antigravity import feeds the same approval gate
    Then a measured Antigravity import supplies one receipt that binds the prepared Plan

  Scenario: A rejected native Gemini response preserves the separate process and decision codes
    Then both Plan entrypoints return one when a successful native Gemini process supplies a refused response
