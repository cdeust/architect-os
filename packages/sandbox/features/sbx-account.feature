@sbx-offline
Feature: Host-only subscription account for a Step

  Scenario Outline: Register and renew with the same verified identity
    Then the host subscription fixture completes "<case>" with "<outcome>"

    Examples:
      | case             | outcome |
      | new registration | renewed |
      | returning        | renewed |
      | reauthorization | renewed |
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
      | temporary account transport | 1 |
      | non-error refusal | 1 |
      | sign-in required | 1 |
      | refused builder | 1 |
      | writable launcher | 0 |
      | reordered registry | 1 |
      | missing proxy | 0 |
      | conflicting deny | 0 |
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
      | unregistered identity |
      | unreachable provider |
      | revoked 401 |
      | unrelated grant error |
      | unrelated nested error |
      | revoked without store |
      | no persistence hook |
      | unpersisted renewal |
      | revocation invalid_grant |
      | revocation invalid_refresh_token |
      | revocation token_expired |
      | revocation refresh_token_expired |
      | revocation refresh_token_invalidated |
      | revocation refresh_token_reused |

  Scenario: Host storage selects the account and the OS secrets service
    Then the OS credential entry uses the installation identity and the required Linux service

  Scenario Outline: Explicit account setup and silent access have separate lifetimes
    Then the account boundary refuses "<condition>" before reading or sending a credential

    Examples:
      | condition |
      | installation without consent handler |
      | cancelled installation |
      | lock creation failure |
      | non-file lock |
      | multiply linked lock |
      | lock of another uid |
      | exposed lock |
      | already cancelled |
      | database IO failure |
      | blocked lock cancellation |

  Scenario: Stored bearer and nonce fields are validated before use
    Then only a complete bearer and a nonempty nonce enter the stored grant

  Scenario Outline: Installation is a separate host command
    Then account installation handles "<case>" and releases the host session

    Examples:
      | case |
      | initial setup |
      | refused consent |
      | missing model |
      | extra argument |
      | another model |

  Scenario Outline: The OS item preserves a rotated grant through a verifier interruption
    Then a fresh host consumer verifies the "<identity>" replacement before accessing the catalogue

    Examples:
      | identity |
      | same account |
      | foreign account |
