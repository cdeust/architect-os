Feature: The host relays the native Responses protocol

  Scenario: Native tool calls, results and a new notification retain their wire bytes
    Then the host relays two native Responses requests byte for byte

  Scenario Outline: Only an admitted run can dispatch to the upstream
    Then the Responses proxy rejects "<request>" before upstream access

    Examples:
      | request         |
      | wrong method    |
      | wrong route     |
      | wrong token     |
      | other run       |
      | revoked run     |
      | other model     |
      | duplicate model |
      | store true      |
      | stream false    |
      | hosted tool     |
      | hosted input tool |
      | bytes           |

  Scenario Outline: Terminal truth comes from the provider
    Then the host records "<wire>" as "<result>" and refuses another dispatch

    Examples:
      | wire           | result             |
      | failed         | failed             |
      | incomplete     | incomplete         |
      | cut            | RESPONSES_STREAM   |
      | wrong model    | RESPONSES_STREAM   |
      | invalid usage  | RESPONSES_STREAM   |
      | token excess   | RESPONSES_BUDGET   |
      | output excess  | RESPONSES_STREAM   |
      | http error     | RESPONSES_STREAM   |
      | wrong type     | RESPONSES_STREAM   |
