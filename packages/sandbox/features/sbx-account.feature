Feature: Host-only subscription account for a Step

  Scenario Outline: Register and renew with the same verified identity
    Then the host subscription fixture completes "<case>" with "<outcome>"

    Examples:
      | case             | outcome |
      | new registration | renewed |
      | returning        | renewed |
      | foreign state    | refused |
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
