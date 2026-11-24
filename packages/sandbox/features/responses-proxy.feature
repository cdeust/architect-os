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

  Scenario Outline: The observer meters only the documented terminal
    Then the proxy observes the "<stream>" fixture as "<status>"

    Examples:
      | stream                 | status      |
      | named completed        | completed   |
      | both terminal events   | interrupted |
      | label mismatch         | interrupted |
      | payload mismatch       | interrupted |
      | named malformed        | interrupted |
      | failed without usage   | failed      |
      | incomplete without usage | incomplete |
      | completed without usage | interrupted |
      | invalid UTF8           | interrupted |
      | interrupted body       | interrupted |
      | orphan terminal bytes  | interrupted |
      | unknown extension      | completed   |
      | trailing invalid UTF8  | interrupted |

  Scenario Outline: A run reserves and meters each resource independently
    Then the proxy enforces the "<boundary>" limit with an upstream witness

    Examples:
      | boundary |
      | requests |
      | tokens |
      | request bytes |
      | total bytes |
      | concurrent |
      | revoke during access |
      | revoke during fetch |
      | revoke during stream |
      | revoke at EOF |
      | invalid budget |
      | deadline |

  Scenario: The native namespace and custom tool are preserved with quoted input
    Then the host forwards namespaced custom tools and escaped JSON input

  Scenario: Malformed UTF-8 in a native request cannot dispatch
    Then the host refuses an invalid UTF-8 request before retrieving the account token

  Scenario Outline: Only an SSE response with a body can begin delivery
    Then a response with "<envelope>" is refused and its source is disposed

    Examples:
      | envelope |
      | missing content type |
      | empty body |
