Feature: where the broker sends its credential upstream (docs/design/platform-v3-srt.md, §2, Broker)
  The credential of the broker's 0600 file is an API key, sent in x-api-key, or a short-lived access token obtained by
  identity federation, which the upstream accepts as a bearer only. `scheme` of broker.json says which; a worker still
  presents its task token in x-api-key, and nothing of the worker's reaches the upstream as a credential.

  Scenario: a broker configured for a bearer relays the credential of its file as a bearer, and no x-api-key
    Given a fake upstream answering a JSON message
    And a broker over that upstream that sends the credential "sk-ant-oat01-token-of-the-scenario" as a bearer
    And the gateway grants the token "tok_ssssssssssssssssssssssssssssssssssss" to the task "task-s" called by "call-s"
    When the worker posts '{"model":"m","max_tokens":1}' to "/v1/messages" with the token "tok_ssssssssssssssssssssssssssssssssssss"
    Then the broker answers 200 with the body of the upstream
    And the upstream received one POST to "/v1/messages" with the body '{"model":"m","max_tokens":1}'
    And the upstream request carried the bearer "sk-ant-oat01-token-of-the-scenario" and no x-api-key

  Scenario: a worker that presents an authorization of its own does not replace the bearer of the broker
    Given a fake upstream answering a JSON message
    And a broker over that upstream that sends the credential "sk-ant-oat01-token-of-the-scenario" as a bearer
    And the gateway grants the token "tok_tttttttttttttttttttttttttttttttttttt" to the task "task-t" called by "call-t"
    When the worker posts '{"model":"m","max_tokens":1}' to "/v1/messages" with the headers "x-api-key=tok_tttttttttttttttttttttttttttttttttttt, authorization=Bearer-of-the-worker"
    Then the broker answers 200 with the body of the upstream
    And the upstream request carried the bearer "sk-ant-oat01-token-of-the-scenario" and no x-api-key
