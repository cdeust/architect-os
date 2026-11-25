Feature: the configuration of the mutation tool loads the way the gate starts it

  The mutation tool imports `stryker.config.mjs` with plain Node. A source file that imports another by its `.js`
  name does not resolve there: on 24 November 2026 the sixteen hosted lanes stopped at this import while the whole
  suite was green, because no scenario loaded the file.

  Scenario: plain Node imports the configuration of the mutation tool
    Then plain Node imports the configuration of the mutation tool and names its test runner "cucumber"
