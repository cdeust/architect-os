Feature: The native composition of the gateway listens last, and closes what it listens on
  composeNative composes everything before it listens for the callbacks of the modules, and touches the broker client
  of its caller only once it listens: a composition that fails has nothing left to close and has changed nothing. The whole composition, under real sandboxes, is
  proved by features/sandbox/gateway-native.feature.

  Scenario: a topology that is refused is refused before anything listens
    Given a native composition whose topology has no catalogue, and a callback port another listener already holds
    When the native gateway is composed
    Then the native composition is refused for its topology, not for the port
    And the refused composition left the usage handler of the broker client untouched

  Scenario: a profile the topology does not hold is refused with the topology, before anything listens
    Given a native composition over the committed topology for the profile "root", on any free callback port
    When the native gateway is composed
    Then the native composition is refused with "UNKNOWN_PROFILE" saying "no profile root"

  Scenario: any profile the topology holds is accepted, not only when it is the single one
    Given a native composition over the committed topology and a second client profile "reader", for that profile, on any free callback port
    When the native gateway is composed
    Then the callback host of the composition listens on "127.0.0.1" and accepts a connection

  Scenario: a callback port that cannot be listened on refuses the composition
    Given a native composition over the committed topology, and a callback port another listener already holds
    When the native gateway is composed
    Then the native composition is refused with the code "EADDRINUSE"
    And the refused composition left the usage handler of the broker client untouched

  Scenario: the composed gateway listens for the callbacks on the loopback, and close ends it
    Given a native composition over the committed topology on any free callback port
    When the native gateway is composed
    Then the callback host of the composition listens on "127.0.0.1" and accepts a connection
    And the composition set the usage handler of the broker client once
    When the native composition is closed
    Then nothing listens on the callback port any more
