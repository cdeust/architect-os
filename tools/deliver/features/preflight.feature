Feature: A delivery admits one reviewed edge before creating any trial ref

  Scenario Outline: an ancestor alone does not identify the entire edge
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And <history>
    When I run the delivery command with "step --until ci"
    Then the delivery preflight refused "la tête distante n'est pas le parent unique du commit" without a trial

    Examples:
      | history                                       |
      | the delivery has a second unpublished commit  |
      | the delivery candidate merges a second parent |

  Scenario Outline: an object change to an input of the released judge needs owner approval
    Given the delivery preflight fixture applies "<change>" to "<path>"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    When I run the delivery command with "step --until ci"
    Then the delivery preflight refused "modification du juge sans approbation de maintenance" without a trial

    Examples:
      | change     | path                                   |
      | add        | CLAUDE.md                              |
      | add        | .claude/agents/security-reviewer.md    |
      | add        | .github/CODEOWNERS                     |
      | add        | .github                                |
      | add        | .github/workflows/new.yml              |
      | rename out | .github/workflows/old.yml              |
      | rename in  | .github/actions/review/action.yml      |
      | mode       | tools/test-gate/gate.sh                |
      | delete     | tools/test-gate/mutation-debt.json     |
      | add        | tools/test-gate/canary/.hidden         |
      | add        | tools/deliver/deliver.json             |
      | add        | tools/deliver                          |
      | add        | tools/deliver/src/main.ts              |
      | add        | aos                                    |
      | add        | tools/runtime/node-locations           |
      | add        | packages/sandbox/profiles/builder.json |
      | add        | packages/contracts/src/index.ts        |
      | add        | scripts/require-run.mjs                |
      | add        | features/steps/runtime-entry.ts        |
      | add        | features/support/world.ts              |
      | add        | features/arch/guard.feature            |
      | add        | features/sandbox/canary.feature        |
      | add        | package.json                           |
      | add        | .hidden/package.json                   |
      | add        | bench/package-lock.json                |
      | add        | cucumber-paths.mjs                     |
      | add        | cucumber.json                          |
      | add        | stryker.config.mjs                     |
      | add        | .dependency-cruiser.cjs                |
      | add        | .npmrc                                 |
      | add        | features/tsconfig.json                 |
      | add        | .nvmrc                                 |
      | add        | .gitattributes                         |
      | add        | .GITHUB/workflows/variant.yml          |

  Scenario Outline: maintenance authority names the repository, exact commit and intended change
    Given the delivery preflight fixture applies "mode" to "tools/test-gate/gate.sh"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the delivery owner approves the maintenance of "<commit>" in "<repository>" with intent "Install the reviewed mode"
    When I run the delivery command with "step --until ci"
    Then the delivery preflight refused "approbation de maintenance d'un autre commit" without a trial
    Given the delivery owner approves the maintenance of "h1" in "cdeust/architect-os" with intent "Install the reviewed Gate entry mode"
    When I run the delivery command with "step --until ci"
    Then the delivery command exited 0
    And the remote of the delivery command holds "sentinel/gate-1a-step" at the commit "h1"

    Examples:
      | commit | repository          |
      | p0     | cdeust/architect-os |
      | h1     | another/repository  |

  Scenario Outline: a maintenance record that the owner's command did not write as it writes carries no authority
    Given the delivery preflight fixture applies "mode" to "tools/test-gate/gate.sh"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the delivery owner approves the maintenance of "h1" in "cdeust/architect-os" with intent "Install the reviewed mode"
    And the delivery owner record of maintenance has "<field>" set to '<value>'
    When I run the delivery command with "step --until ci"
    Then the delivery preflight refused "approbation de maintenance non recevable" without a trial

    Examples:
      | field     | value         |
      | intent    | "  "          |
      | expiresAt | NOW+90000     |
      | kind      | "publication" |

  Scenario: an expired maintenance record is refused by name
    Given the delivery preflight fixture applies "mode" to "tools/test-gate/gate.sh"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the delivery owner approves the maintenance of "h1" in "cdeust/architect-os" with intent "Install the reviewed mode"
    And the delivery owner record of maintenance was given 7200 seconds ago for 3600 seconds
    When I run the delivery command with "step --until ci"
    Then the delivery preflight refused "approbation de maintenance périmée" without a trial

  Scenario: a maintenance approval does not stand for the publication, which the owner approves on its own
    Given the delivery preflight fixture applies "mode" to "tools/test-gate/gate.sh"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the delivery owner approves the maintenance of "h1" in "cdeust/architect-os" with intent "Install the reviewed mode"
    And the delivery owner withdraws the publication approval
    When I run the delivery command with "step"
    Then the delivery preflight refused "publication sans approbation du propriétaire" without a trial
    Given the delivery owner approves the publication of "h1" in "cdeust/architect-os"
    When I run the delivery command with "step"
    Then the delivery command exited 0
    And the remote of the delivery command holds "main" at the commit "h1"

  Scenario: an ordinary product change reaches trial with npm-style candidate names first on PATH
    Given the delivery preflight fixture applies "add" to "tools/test-gate-notes/ordinary.ts"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the installed delivery policy is in a sibling sharing the worktree name prefix
    And the candidate puts harmless program names first on the delivery PATH
    When I run the delivery command with "step --until ci"
    Then the candidate program names recorded zero delivery calls
    And the scripted Gate and forge received their installed helper paths
    And the delivery command exited 0
    And the remote of the delivery command holds "sentinel/gate-1a-step" at the commit "h1"

  Scenario: the installed launcher enters its own delivery program from the candidate
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the candidate puts harmless program names first on the delivery PATH
    And the delivery has a second unpublished commit
    When the owner launcher delivers the candidate with a misleading INIT_CWD
    Then the delivery preflight refused "la tête distante n'est pas le parent unique du commit" without a trial
    And the candidate program names recorded zero delivery calls

  Scenario: the candidate cannot supply the loaded delivery configuration
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And the delivery configuration itself is inside the candidate tree
    When I run the delivery command with "step"
    Then the delivery command exited 2
    And the delivery command wrote on its standard error:
      """
      architect-os deliver: DELIVERY_LAUNCHER_IN_SUBJECT
      """
    And the remote of the delivery command has no branch "sentinel/gate-1a-step"

  Scenario: delivery must start at a Git worktree root
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    When the owner runs delivery from a directory outside a Git worktree
    Then the remote of the delivery command has no branch "sentinel/gate-1a-step"

  Scenario: the launcher refuses its own directory before starting the delivery CLI
    Given a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    When the installed launcher is itself the delivery subject
    Then the remote of the delivery command has no branch "sentinel/gate-1a-step"

  Scenario: a record supplied from the worktree, or named by the environment, grants no maintenance authority
    Given the delivery preflight fixture applies "add" to ".github/workflows/proposed.yml"
    And a delivery command over a throwaway repository, the commit "h1" ahead of both branches at "p0"
    And only the candidate holds exact maintenance records
    When I run the delivery command with "step --until ci"
    Then the delivery preflight refused "modification du juge sans approbation de maintenance" without a trial
