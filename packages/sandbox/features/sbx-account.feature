Feature: Host-only subscription account for a Step

  Scenario Outline: Register and renew with the same verified identity
    Then the host subscription fixture completes "<case>" with "<outcome>"

    Examples:
      | case             | outcome |
      | new registration | renewed |
      | returning        | renewed |
      | foreign state    | refused |
      | missing state | refused |
      | missing callback client | refused |
      | no initial scope | refused |
      | missing expiry | refused |
      | renewal with omitted claims | renewed |
      | same issue time | renewed |
      | cancelled waiter | renewed |
      | cancelled catalogue | refused |
      | wrong issuer     | refused |
      | wrong audience   | refused |
      | wrong nonce      | refused |
      | wrong subject    | refused |
      | absent scope     | refused |
      | rotated subject  | refused |
      | reused refresh   | refused |
      | hidden model     | refused |
      | refused callback | refused |
      | substituted client | refused |
      | duplicate code | refused |
      | unavailable issuer | refused |
      | invalid JSON | refused |
      | large response | refused |
      | extra audience | refused |
      | single audience | renewed |
      | foreign azp | refused |
      | invalid auth time | refused |
      | changed auth time | refused |
      | rotated nonce | refused |
      | old identity | refused |
      | no identity | refused |
      | renewal without ID token | renewed |
      | unsafe expiry | refused |
      | expanded scope | refused |
      | body boundary | renewed |
      | oversized valid grant | refused |
      | invalid UTF8 grant | refused |
      | HTTP failure with grant | refused |
      | invalid signature | refused |
      | invalid token type prefix | refused |
      | invalid token type suffix | refused |
      | invalid bearer prefix | refused |
      | invalid bearer suffix | refused |
      | partial grant | refused |
      | lost scope | refused |
      | other model | refused |

  Scenario Outline: The host loads private settings before offering the account session
    Then the SBX Step host uses "<settings>" and opens the fixture account <sessions> times

    Examples:
      | settings | sessions |
      | new installation | 1 |
      | existing registration | 1 |
      | concurrent different client | 1 |
      | concurrent different subject | 1 |
      | refused builder | 1 |
      | writable launcher | 0 |
      | no registry | 1 |
      | unrecognized route | 0 |
      | missing limits | 0 |
      | public limits | 0 |
      | hardlinked limits | 0 |
      | linked limits | 0 |
      | large limits | 0 |
      | invalid limits | 0 |
      | zero tokens | 0 |
      | invalid host id | 0 |
      | invalid registration | 0 |
      | broken pin | 0 |
      | sibling launcher | 1 |
      | padded host | 1 |
      | failed publication | 1 |
      | default builder | 1 |
      | public registration | 0 |
      | invalid host prefix | 0 |
      | invalid host suffix | 0 |
      | invalid stored client prefix | 0 |
      | invalid stored client suffix | 0 |
      | invalid stored subject prefix | 0 |
      | invalid stored subject suffix | 0 |

  Scenario Outline: The callback listener is private, single-use and revoked on exit
    Then the consent listener releases its bind, callbacks and connections after "<case>"

    Examples:
      | case |
      | duplicate callback |
      | foreign bind |

  Scenario Outline: Independent consumers use the installed grant under a lock
    Then the host credential store handles "<case>" without a consent or token disclosure

    Examples:
      | case |
      | concurrent refresh |
      | closed waiter |
      | missing grant |
      | locked store |
      | corrupt secret |
      | revoked session |
      | temporary failure |
      | catalogue interruption |
      | other identity |
      | other client |
      | next model |
      | unsafe lock |
