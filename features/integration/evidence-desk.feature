Feature: The evidence desk meets a FIFO in the folder Science writes

  A FIFO opened for reading blocks until a writer appears. The store opens without blocking and judges the descriptor,
  so a FIFO reads as absent. No step waits: if the store blocks, the scenario hangs, which is the failure.

  Scenario: a FIFO named as a source text of in reads as absent
    Given an evidence desk store over a throwaway root
    And Science has made the FIFO "in/fifo.txt" in the desk store
    Then the desk store reads no source text "fifo.txt"

  Scenario: a FIFO named as an answer reads as absent, and its identifier is listed
    Given an evidence desk store over a throwaway root
    And Science has made the FIFO "in/fifo.answer.json" in the desk store
    Then the desk store reads no answer "fifo"
    And the desk store lists the answer identifiers "fifo"
