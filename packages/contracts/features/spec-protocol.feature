Feature: Spec planning host wire protocol

  Scenario Outline: Preserve each supported batch purpose and effort on a multi-invocation page
    Then a Spec action page preserves two "<effort>" invocations for "<purpose>"

    Examples:
      | purpose | effort |
      | draft   | low    |
      | judge   | medium |
      | review  | high   |
      | probe   | low    |

  Scenario: A clarification defaults to one selection and preserves explicit multiple selection
    Then a Spec clarification defaults to single selection
    And the Spec host action round-trips the wire document
      """
      {"kind":"ask_user","question_id":"scope","header":"Scope","description":"Which teams?","options":[{"label":"one","description":"First team"},{"label":"two"}],"multi_select":true}
      """

  Scenario Outline: Preserve producer action fields
    Then the Spec host action round-trips the wire document
      """
      <document>
      """

    Examples:
      | document                                                                                 |
      | {"kind":"write_file","path":"part.md","content":"é"}                                      |
      | {"kind":"failed","reason":"source missing","step":"review"}                               |
      | {"kind":"done","summary":"complete","outcome":{"status":"passed","reasons":[]}}            |
      | {"kind":"done","summary":"review","outcome":{"status":"needs_attention","reasons":["x"]}} |

  Scenario Outline: Preserve operator answers and file write acknowledgments
    Then the Spec host result round-trips the wire document
      """
      <document>
      """

    Examples:
      | document                                                                                 |
      | {"kind":"user_answer","question_id":"scope","selected":["one"],"freeform":"why"}         |
      | {"kind":"file_written","path":"part.md","bytes":2}                                       |

  Scenario: Preserve each model receipt or reported failure when submitting a batch
    Then the Spec host result round-trips the wire document
      """
      {
        "kind": "subagent_batch_result",
        "batch_id": "drafts",
        "responses": [
          {"invocation_id":"first","raw_text":"é","model_receipt":{"provider":"google","model":"gemini-1.5"}},
          {"invocation_id":"second","error":"refused"}
        ]
      }
      """

  Scenario Outline: Reject malformed pagination on an otherwise valid action
    Then a Spec action page rejects "<field>" set to <value>

    Examples:
      | field       | value |
      | offset      | -1    |
      | count       | 0.5   |
      | total       | null  |
      | next_offset | -1    |

  Scenario: Retain the operator's answer and its binding to the exact action
    Then the Spec host answer round-trips its run, digest, selections and freeform

  Scenario Outline: Reject ambiguous or malformed operator answers
    Then the Spec host answer rejects "<change>"

    Examples:
      | change               |
      | prefixed run         |
      | suffixed run         |
      | prefixed digest      |
      | suffixed digest      |
      | unrecognized field   |

  Scenario Outline: Restore each durable journal phase with its receipts and published digests
    Then the saved Spec journal preserves phase "<phase>" and its full record

    Examples:
      | phase        |
      | pending      |
      | dispatching  |
      | submitting   |
      | acknowledged |

  Scenario Outline: Reject a malformed model route on a stored receipt
    Then a Spec journal receipt rejects model "<model>"

    Examples:
      | model  |
      | !draft |
      | draft! |

  Scenario Outline: Keep the producer's PRD context and request size while normalizing its description
    Then a Spec request preserves "<context>" and "<size>" and trims its description

    Examples:
      | context  | size     |
      | proposal | tiny     |
      | feature  | standard |
      | bug      | tiny     |
      | incident | standard |
      | poc      | tiny     |
      | mvp      | standard |
      | release  | tiny     |
      | cicd     | standard |

  Scenario Outline: Reject malformed request parameters before planning
    Then a Spec request rejects field "<field>" with value "<value>"

    Examples:
      | field               | value       |
      | feature_description |             |
      | plan_step           | !draft      |
      | plan_step           | draft!      |
      | prd_context         | unknown     |
      | request_size        | unbounded   |

  Scenario Outline: Decode the same exclusive native outcome in a journal and a submitted response
    Then the Spec wire result and persisted receipts both reject the "<case>" native outcome

    Examples:
      | case              |
      | missing outcome   |
      | missing route     |
      | missing text      |
      | blank text        |
      | blank error       |
      | success and error |
      | error with route  |
      | error with text   |
      | empty identity    |
