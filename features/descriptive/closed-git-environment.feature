Feature: git starts with a closed environment (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »)
  This file holds one thing: the suite removes the GIT_ variables of its own environment when it loads, so that no
  helper of a scenario inherits one from the host. The literal check on the production files that start git is in
  features/arch/closed-git-environment-text.feature. What each launch does with its list is proved in the features of
  its own component.

  Rule: the suite removes the GIT_ variables of its environment, once, when it loads

    Scenario: a child that does not load the support file keeps its GIT_ variables
      When a child node with GIT_DIR "/nowhere", GIT_EDITOR "x" and GITHUB_TOKEN "y" in its environment prints its variables that start with GIT
      Then the child printed "GITHUB_TOKEN, GIT_DIR, GIT_EDITOR"

    Scenario: a child that loads the support file keeps no variable that starts with GIT_
      When a child node with GIT_DIR "/nowhere", GIT_EDITOR "x" and GITHUB_TOKEN "y" in its environment imports the support file of the git environment and prints its variables that start with GIT
      Then the child printed "GITHUB_TOKEN"
