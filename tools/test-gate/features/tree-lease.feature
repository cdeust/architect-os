Feature: The Gate host invokes the installed native lease protocol

  Scenario Outline: Each authority crosses the fixed host adapter with its exact arguments
    Then the native Gate adapter performs "<command>" through the fixed interpreter

    Examples:
      | command |
      | local |
      | hosted |
      | begin |
      | restore |
      | discard |
      | verify |

  Scenario Outline: The Gate adapter refuses a failed native operation
    Then the native Gate adapter refuses "<case>"

    Examples:
      | case |
      | begin |
      | restore |
      | discard |
      | verify |
      | spawn |
      | signal |
      | non-directory |
      | invalid descriptor |

  Scenario Outline: The receipt authorizes only a complete checked job
    Then the receipt publisher exercises "<case>" in a private Git checkout

    Examples:
      | case |
      | linux |
      | mutation off |
      | no linux job |
      | no canary |
      | no replay |
      | no plan |
      | macos plan |
      | missing head |
      | wrong type |
      | no base |
      | no markdown |
      | wrong HEAD |
