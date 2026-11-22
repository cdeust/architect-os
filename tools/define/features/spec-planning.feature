Feature: Host the Spec planning profile before implementation
  Scenario Outline: Decide on the full batch before spending any quota
    Then Spec planning handles "<case>" without an unapproved model call

    Examples:
      | case             |
      | quota            |
      | denied account   |
      | unknown route    |
      | changed page     |
      | foreign action   |
      | wrong receipt    |
      | interrupted turn |

  Scenario: Recover a recorded turn without spending twice
    Then Spec planning reuses the saved model result before submission

  Scenario: Refuse a second writer and preserve immutable artifacts
    Then the Spec run directory admits a single writer

  Scenario: Refuse a producer checkpoint that reissues a previously acknowledged batch
    Then Spec planning refuses a batch reissued after acknowledgment

  Scenario: Allow the operator to answer the producer's structured clarification
    Then Spec planning surfaces a clarification with label-only choices

  Scenario: Allow a producer to correct a rejected section under the same identifier
    Then Spec planning allows a new prompt on the same batch identifier

  Scenario: Require an independent panel reviewer for the approved routes
    Then Spec planning distinguishes an independent panel from a conflicting route

  Scenario Outline: Write producer artifacts only inside this run
    Then Spec planning processes artifact path "<path>" as "<outcome>"

    Examples:
      | path                                | outcome |
      | prd-output/run_test/Part-2.v1_md    | written |
      | outside/run_test/Part-2.v1_md       | refused |
      | prd-output/run_othe/Part-2.v1_md    | refused |
      | prd-output/run_test/nested/file     | refused |
      | prd-output/run_test/.hidden         | refused |
      | prd-output/run_test/a?b             | refused |
