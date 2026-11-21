Feature: Record local planning usage
  Scenario: An unsuccessful Plan attempt has one terminal receipt and no attributed generation cost
    Then a measured Plan refusal records its exit and preserves its journal on retry

  Scenario: A consumer process cannot start
    Then a planning measurement records its launch failure without a cost
