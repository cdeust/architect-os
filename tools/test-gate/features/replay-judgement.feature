Feature: Test gate, rule 7: how one replay is judged against the status the tool gave
  A run is written `timeout`, `unreadable`, `hook <STATUS>`, or its pickles separated by ` | `, each one its step
  statuses, prefixed by `2 attempts: ` when run twice; pickles are p1, p2... `none`: no control (a survivor needs
  none). A clean pass: every expected scenario ran once, every step and run hook PASSED, before the limit. A detection
  (Killed, Timeout, RuntimeError) needs a clean control and anything but a clean pass on the mutant; a survivor
  (Survived, Ignored) needs a clean pass on the mutant. Retry: the named killers passed, the covering scenarios decide.
  Recheck: the detection rests on a broken run (no report, a limit, a hook, a missing scenario, a step neither PASSED
  nor FAILED), which a broken environment also gives: a fresh control after it must pass cleanly.

  Scenario Outline: <status> over <n>, control "<control>", mutant "<mutant>": <divergence>
    When the gate judges the replay of a <status> mutant over <n> scenarios, control "<control>", mutant "<mutant>"
    Then the replay divergence is "<divergence>", retry <retry>, recheck <recheck>

    Examples: detections
      | status       | n | control          | mutant                   | divergence                                                | retry | recheck |
      | Killed       | 2 | PASSED \| PASSED | FAILED SKIPPED \| PASSED | none                                                      | no    | no |
      | Killed       | 2 | PASSED \| PASSED | PASSED \| PASSED         | Killed selon l'outil, les scénarios passent sur le mutant | yes   | no |
      | Killed       | 2 | PASSED \| PASSED | FAILED                   | none                                                      | no    | yes |
      | Killed       | 1 | PASSED           | UNDEFINED SKIPPED        | none                                                      | no    | yes |
      | Killed       | 1 | PASSED           | 2 attempts: PASSED       | none                                                      | no    | yes |
      | Killed       | 1 | PASSED           | hook FAILED              | none                                                      | no    | yes |
      | Killed       | 1 | PASSED           | unreadable               | none                                                      | no    | yes |
      | Killed       | 1 | PASSED           | timeout                  | none                                                      | no    | yes |
      | Timeout      | 1 | PASSED           | timeout                  | none                                                      | no    | yes |
      | Timeout      | 1 | PASSED           | PASSED                   | Timeout selon l'outil, les scénarios passent sur le mutant | yes  | no |
      | RuntimeError | 1 | PASSED           | FAILED                   | none                                                      | no    | no |
      | Killed       | 2 | PASSED \| PASSED | FAILED \| UNDEFINED     | none                                                      | no    | yes |
      | Killed       | 2 | PASSED \| PASSED | UNDEFINED \| FAILED     | none                                                      | no    | yes |

    Examples: controls
      | status | n | control          | mutant | divergence                                         | retry | recheck |
      | Killed | 2 | PASSED \| FAILED | FAILED | témoin : p2 : FAILED                               | no    | no |
      | Killed | 2 | FAILED \| PENDING | FAILED | témoin : p1 : FAILED, p2 : PENDING                | no    | no |
      | Killed | 2 | timeout          | FAILED | témoin : délai dépassé                             | no    | no |
      | Killed | 2 | PASSED           | FAILED | témoin : 1 scénario(s) exécuté(s) sur 2            | no    | no |
      | Killed | 1 | SKIPPED PASSED   | FAILED | témoin : p1 : SKIPPED                              | no    | no |
      | Killed | 1 | unreadable       | FAILED | témoin : illisible                                 | no    | no |
      | Killed | 1 | hook FAILED      | FAILED | témoin : hook h : FAILED                           | no    | no |
      | Killed | 1 | 2 attempts: PASSED | FAILED | témoin : p1 : 2 tentatives                       | no    | no |

    Examples: survivors
      | status   | n | control | mutant                 | divergence                                                            | retry | recheck |
      | Survived | 2 | none    | PASSED \| PASSED       | none                                                                  | no    | no |
      | Survived | 2 | none    | PASSED \| FAILED SKIPPED | Survived selon l'outil, mais sur le mutant : p2 : FAILED            | no    | no |
      | Survived | 2 | none    | FAILED \| UNDEFINED    | Survived selon l'outil, mais sur le mutant : p1 : FAILED, p2 : UNDEFINED | no | no |
      | Survived | 1 | none    | timeout                | Survived selon l'outil, mais sur le mutant : délai dépassé            | no    | no |
      | Survived | 3 | none    | PASSED \| PASSED       | Survived selon l'outil, mais sur le mutant : 2 scénario(s) exécuté(s) sur 3 | no | no |
      | Ignored  | 1 | none    | FAILED                 | Ignored selon l'outil, mais sur le mutant : p1 : FAILED               | no    | no |

  Scenario Outline: a fresh control after a broken detection, "<run>": <divergence>
    When a fresh control after a broken detection over <n> scenarios is "<run>"
    Then the recheck divergence is "<divergence>"

    Examples:
      | n | run              | divergence                                       |
      | 2 | PASSED \| PASSED | none                                             |
      | 2 | PASSED \| FAILED | témoin après coup : p2 : FAILED                  |
      | 1 | unreadable       | témoin après coup : illisible                    |
