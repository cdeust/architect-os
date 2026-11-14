Feature: Verifying the answers of the desk

  Background:
    Given the evidence use cases over an empty desk, the clock reading "2026-11-14T12:00:00.000Z"

  Scenario: an answer that holds is verified, with the registry's title and year and the text kept by its hash
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the answer "a" citing "10.1234/a" titled "title a" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "a", rejected "", deferred "" and pending ""
    And the registry was asked for "10.1234/a"
    And the evidence ledger holds the verified record of "a":
      """
      {
        "id": "a",
        "question": "What is a?",
        "verified_at": "2026-11-14T12:00:00.000Z",
        "level": "quote_in_supplied_text",
        "claims": [
          {
            "statement": "A statement.",
            "sources": [
              {
                "doi": "10.1234/a",
                "title": "Title A",
                "year": 2020,
                "quote": "participants answered more comprehension questions correctly",
                "text_sha256": "64827af2c674036f45632fcea70e0a9284f55d025545b4161bcacea48209425d"
              }
            ]
          }
        ],
        "not_found": []
      }
      """
    And the evidence ledger keeps the text "Title A. Results: participants answered more comprehension questions correctly. End." of the source of "a"
    And the evidence desk holds no rejection of "a"

  Scenario: a year the registry does not give is kept as null
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of an unknown year
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "a", rejected "", deferred "" and pending ""

  Scenario: a question answered with not_found alone is verified without a call to the registry
    Given the question "a" is in the ledger
    And the desk holds the answer "a" that finds nothing
    When the evidence verification runs
    Then the verification reports verified "a", rejected "", deferred "" and pending ""
    And the registry was asked for ""
    And the evidence ledger holds the verified record of "a":
      """
      {
        "id": "a",
        "question": "What is a?",
        "verified_at": "2026-11-14T12:00:00.000Z",
        "level": "quote_in_supplied_text",
        "claims": [],
        "not_found": ["no trial found"]
      }
      """

  Scenario: two sources with one DOI, in one answer or in two, cost one lookup, and lookups are made one after the other
    Given the question "a" is in the ledger
    And the question "b" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the registry knows "10.1234/b" as "Title B" of 2021
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds a text "b.txt" that names "Title B" and quotes the passage
    And the desk holds the answer "a":
      """
      {"id":"a","not_found":[],"claims":[
        {"statement":"s1","sources":[
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"},
          {"doi":"10.1234/b","title":"Title B","quote":"participants answered more comprehension questions correctly","text":"b.txt"}]},
        {"statement":"s2","sources":[
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"}]}]}
      """
    And the desk holds the answer "b" citing "10.1234/a" titled "Title A" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "a,b", rejected "", deferred "" and pending ""
    And the registry was asked for "10.1234/a,10.1234/b"
    And the registry never had two lookups in flight

  Scenario: the answers are taken in the order of the identifiers
    Given the question "c" is in the ledger
    And the question "a" is in the ledger
    And the question "b" is in the ledger
    And the desk holds the answer "c" that finds nothing
    And the desk holds the answer "a" that finds nothing
    And the desk holds the answer "b" that finds nothing
    When the evidence verification runs
    Then the verification reports verified "a,b,c", rejected "", deferred "" and pending ""

  Scenario: an answer for another identifier is rejected for that alone, its question being known
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the answer "a":
      """
      {"id":"b","not_found":[],"claims":[
        {"statement":"s1","sources":[
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"}]}]}
      """
    When the evidence verification runs
    Then the verification reports verified "", rejected "a", deferred "" and pending ""
    And the evidence rejection of "a" has the reasons:
      | ANSWER_ID_MISMATCH | null | null | the answer is for b |
    And the registry was asked for ""
    And the evidence ledger holds no verified record of "a"

  Scenario: a sound answer to a question never asked is rejected for that alone
    Given the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the answer "z" citing "10.1234/a" titled "Title A" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "", rejected "z", deferred "" and pending ""
    And the evidence rejection of "z" has the reasons:
      | QUESTION_UNKNOWN | null | null | z was never asked |
    And the registry was asked for ""
    And the evidence ledger holds no verified record of "z"

  Scenario: an answer is rejected for every whole-answer reason at once, and the registry is not called
    Given the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds the answer "z":
      """
      {"id":"y","not_found":["x"],"claims":[]}
      """
    When the evidence verification runs
    Then the verification reports verified "", rejected "z", deferred "" and pending ""
    And the evidence rejection of "z" has the reasons:
      | ANSWER_ID_MISMATCH | null | null | the answer is for y |
      | QUESTION_UNKNOWN   | null | null | z was never asked   |
    And the registry was asked for ""

  Scenario: an answer that is not JSON for a question never asked is rejected for both
    Given the desk holds the answer "z" as the text "not json"
    When the evidence verification runs
    Then the evidence rejection of "z" has the reasons:
      | ANSWER_INVALID   | null | null | $ is not JSON     |
      | QUESTION_UNKNOWN | null | null | z was never asked |
    And the evidence rejection of "z" is rejected_at "2026-11-14T12:00:00.000Z" for the answer "not json"

  Scenario: an answer that is off contract is rejected with the issues
    Given the question "a" is in the ledger
    And the desk holds the answer "a" as the text "{\"id\":\"a\",\"claims\":[],\"not_found\":[]}"
    When the evidence verification runs
    Then the verification reports verified "", rejected "a", deferred "" and pending ""
    And the evidence rejection of "a" has the reasons:
      | ANSWER_INVALID | null | null | $ claims and not_found are both empty |

  Scenario: an answer file that is not a plain file is rejected, and the fingerprint is that of the empty text
    Given the question "a" is in the ledger
    And the answer file of "a" is not a plain file
    When the evidence verification runs
    Then the verification reports verified "", rejected "a", deferred "" and pending ""
    And the evidence rejection of "a" has the reasons:
      | ANSWER_INVALID | null | null | not a plain file of 1 MiB at most |
    And the evidence rejection of "a" is rejected_at "2026-11-14T12:00:00.000Z" for the answer ""

  Scenario: the reasons of each source carry the ranks of its claim and of itself, and are all given
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the registry knows "10.1234/r" as "Title R" of 2019, retracted
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the text "wrong.txt" as "Something else entirely."
    And the desk holds the answer "a":
      """
      {"id":"a","not_found":[],"claims":[
        {"statement":"s1","sources":[
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"}]},
        {"statement":"s2","sources":[
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"},
          {"doi":"10.1234/r","title":"Title R","quote":"participants answered more comprehension questions correctly","text":"missing.txt"},
          {"doi":"10.1234/nope","title":"Title N","quote":"participants answered more comprehension questions correctly","text":"wrong.txt"}]}]}
      """
    When the evidence verification runs
    Then the verification reports verified "", rejected "a", deferred "" and pending ""
    And the registry was asked for "10.1234/a,10.1234/r,10.1234/nope"
    And the evidence rejection of "a" has the reasons:
      | RETRACTED           | 1 | 1 | the registry lists a retraction                    |
      | SOURCE_TEXT_MISSING | 1 | 1 | missing.txt is absent, not a regular file or too large |
      | DOI_UNKNOWN         | 1 | 2 | 10.1234/nope is not registered                        |
      | QUOTE_ABSENT        | 1 | 2 | the quote is not in wrong.txt                      |
    And the evidence ledger holds no verified record of "a"

  Scenario: an unavailable registry defers the answer and writes nothing for it, the others go on
    Given the question "a" is in the ledger
    And the question "b" is in the ledger
    And the registry is unreachable for "10.1234/a"
    And the registry knows "10.1234/b" as "Title B" of 2021
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds a text "b.txt" that names "Title B" and quotes the passage
    And the desk holds the answer "a":
      """
      {"id":"a","not_found":[],"claims":[
        {"statement":"s1","sources":[
          {"doi":"10.1234/b","title":"Title B","quote":"participants answered more comprehension questions correctly","text":"missing.txt"},
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"}]}]}
      """
    And the desk holds the answer "b" citing "10.1234/b" titled "Title B" in the text "b.txt"
    When the evidence verification runs
    Then the verification reports verified "b", rejected "", deferred "a" and pending ""
    And the evidence desk holds no rejection of "a"
    And the evidence ledger holds no verified record of "a"

  Scenario: an unavailable DOI is looked up once for the run, whoever cites it
    Given the question "a" is in the ledger
    And the question "b" is in the ledger
    And the registry is unreachable for "10.1234/a"
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "a.txt"
    And the desk holds the answer "b" citing "10.1234/a" titled "Title A" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "", rejected "", deferred "a,b" and pending ""
    And the registry was asked for "10.1234/a"

  Scenario: a deferred answer that was rejected before keeps its rejection
    Given the question "a" is in the ledger
    And the registry is unreachable for "10.1234/a"
    And the desk holds the answer "a" as the text "not json"
    And the evidence verification runs
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "", rejected "", deferred "a" and pending ""
    And the evidence rejection of "a" has the reasons:
      | ANSWER_INVALID | null | null | $ is not JSON |

  Scenario: an unchanged rejection is reported again without a call to the registry nor a new write
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "gone.txt"
    And the evidence verification runs
    And the evidence clock now reads "2026-11-14T13:00:00.000Z"
    When the evidence verification runs
    Then the verification reports verified "", rejected "a", deferred "" and pending ""
    And the registry was asked for "10.1234/a"
    And the evidence rejection of "a" is rejected_at "2026-11-14T12:00:00.000Z", with the fingerprint of its answer and of an absent text

  Scenario: a rejected answer that changes is looked at again, and once corrected it is verified and its rejection is gone
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "gone.txt"
    And the evidence verification runs
    And the evidence clock now reads "2026-11-14T13:00:00.000Z"
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "a.txt"
    When the evidence verification runs
    Then the verification reports verified "a", rejected "", deferred "" and pending ""
    And the evidence desk holds no rejection of "a"
    And the registry was asked for "10.1234/a,10.1234/a"

  Scenario: a verified answer is never looked at again
    Given the question "a" is in the ledger
    And the desk holds the answer "a" that finds nothing
    And the evidence verification runs
    And the desk holds the answer "a" as the text "not json"
    When the evidence verification runs
    Then the verification reports verified "", rejected "", deferred "" and pending ""
    And the evidence desk holds no rejection of "a"
    And the evidence ledger holds the verified record of "a":
      """
      {
        "id": "a",
        "question": "What is a?",
        "verified_at": "2026-11-14T12:00:00.000Z",
        "level": "quote_in_supplied_text",
        "claims": [],
        "not_found": ["no trial found"]
      }
      """

  Scenario: the questions without an answer are pending, those verified or answered are not
    Given the question "p2" is in the ledger
    And the question "p1" is in the ledger
    And the question "done" is in the ledger
    And the question "waiting" is in the ledger
    And the desk holds the answer "done" that finds nothing
    And the evidence verification runs
    And the desk holds the answer "waiting" as the text "not json"
    And the desk holds the answer "stray" as the text "not json"
    When the evidence verification runs
    Then the verification reports verified "", rejected "stray,waiting", deferred "" and pending "p1,p2"

  Scenario: the fingerprint of a rejection covers the answer and each text it cites, an absent text counting as empty
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    And the desk holds the answer "a":
      """
      {"id":"a","not_found":[],"claims":[
        {"statement":"s1","sources":[
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"a.txt"},
          {"doi":"10.1234/a","title":"Title A","quote":"participants answered more comprehension questions correctly","text":"missing.txt"}]}]}
      """
    When the evidence verification runs
    Then the verification reports verified "", rejected "a", deferred "" and pending ""
    And the evidence rejection of "a" carries the fingerprint of its answer, of the text "Title A. Results: participants answered more comprehension questions correctly. End." and of an absent text

  Scenario: a rejection repaired by adding the missing text alone, the answer untouched, is looked at again
    Given the question "a" is in the ledger
    And the registry knows "10.1234/a" as "Title A" of 2020
    And the desk holds the answer "a" citing "10.1234/a" titled "Title A" in the text "a.txt"
    And the evidence verification runs
    And the verification reports verified "", rejected "a", deferred "" and pending ""
    And the desk holds a text "a.txt" that names "Title A" and quotes the passage
    When the evidence verification runs
    Then the verification reports verified "a", rejected "", deferred "" and pending ""
    And the evidence desk holds no rejection of "a"

