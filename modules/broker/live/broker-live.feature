Feature: the broker against the real upstream, with a test key (T-04R, docs/design/platform-v3-srt.md, §2, Broker)
  The one scenario that reaches api.anthropic.com. It is a command of the owner, never the gate nor `npm test`:
  gate.yml holds no secret (§7), since the gate runs the code of every branch. The key is a test key of the owner, with
  a low spending limit, in a file only its owner reads (0600), named by ANTHROPIC_TEST_KEY_FILE; without it the
  scenario fails. Each request asks for one token of the smallest model.

      ANTHROPIC_TEST_KEY_FILE=<file 0600> npm run broker:live

  Background:
    Given a broker over api.anthropic.com with the test key of ANTHROPIC_TEST_KEY_FILE
    And the gateway grants a live token to the task "live-task" called by "live-call"

  Scenario: a valid request, then invalid ones, each answered by the upstream and recorded for its task
    When the worker sends the live request "one token of the smallest model"
    Then the live answer is 200 and the usage record has the model and input tokens
    When the worker sends the live request "one token as a stream"
    Then the live answer is 200 and the usage record has the model and input tokens
    When the worker sends the live request "an unknown model"
    Then the live answer is 404 and the usage record has the error type "not_found_error"
    When the worker sends the live request "no max_tokens"
    Then the live answer is 400 and the usage record has the error type "invalid_request_error"
    And the gateway got 4 live usage records, all for the task "live-task" called by "live-call"
    And no live answer, header or body, reflects the key or the token
