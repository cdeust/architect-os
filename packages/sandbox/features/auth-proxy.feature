Feature: Auth proxy (host side, fake upstream, fake credential)
  The proxy holds the host credential, relays two routes and gives the sandbox only a session token.

  Background:
    Given a fake upstream answering with a server-sent-events stream that carries a usage
    And an auth proxy over that upstream with the session token "session-token-for-tests" and the host credential "host-credential"

  Scenario: relays POST /v1/messages with the host credential in place of the session token
    When I POST through the proxy "/v1/messages?beta=true" with the body '{"model":"m"}' and the headers:
      | anthropic-beta | x-1  |
      | x-api-key      | leak |
    Then the proxy response status is 200
    And the proxy response body is the upstream stream
    And the upstream received 1 request
    And the upstream request 0 has the method "POST"
    And the upstream request 0 has the url "/v1/messages?beta=true"
    And the upstream request 0 has the body '{"model":"m"}'
    And the upstream request 0 has the header "authorization" "Bearer host-credential"
    And the upstream request 0 has no header "x-api-key"
    And the upstream request 0 has the header "anthropic-beta" "x-1,oauth-2025-04-20"

  Scenario: logs one usage line per response: model, tokens, time, never content nor credential
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the usage log holds one record matching:
      """
      {"status":200,"route":"/v1/messages","model":"claude-test","input_tokens":12,"cache_read_input_tokens":3,"cache_creation_input_tokens":2,"output_tokens":7}
      """
    And the usage record has a string "at"
    And the usage log does not contain "SECRET-CONTENT"
    And the usage log does not contain "host-credential"
    And the usage log does not contain "session-token-for-tests"

  Scenario: refuses without the session token (401), and forwards nothing
    When I POST through the proxy "/v1/messages" with the body '{}' and the session token "wrong"
    Then the proxy response status is 401
    When I POST through the proxy "/v1/messages" with the body '{}' and no authorization
    Then the proxy response status is 401
    And the upstream received no request

  Scenario Outline: refuses <method> <path> (403), and forwards nothing
    When I send "<method>" to "<path>" through the proxy
    Then the proxy response status is 403
    And the proxy response is a "permission_error" whose message contains "route refused by the auth proxy"
    And the upstream received no request

    Examples:
      | method | path                                  |
      | GET    | /v1/messages                          |
      | POST   | /v1/models                            |
      | POST   | /api/oauth/profile                    |
      | POST   | /v1/messages/batches                  |
      | POST   | //evil.example/v1/messages            |
      | POST   | /v1/messages/../../api/oauth/token    |

  Scenario: refuses the session token once revoked (401)
    When the session token is revoked
    And I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 401
    And the upstream received no request

  Scenario: answers 503 without detail when the host credential cannot be read
    Given the proxy is restarted with a host credential that fails with "detail that must not leak"
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 503
    And the proxy response body is exactly:
      """
      {"type":"error","error":{"type":"api_error","message":"host credential unavailable: sign in with claude on the host"}}
      """

  Scenario Outline: refuses the capability <case> in the body (403), and forwards nothing
    When I POST through the proxy "/v1/messages" with the body '<body>'
    Then the proxy response status is 403
    And the proxy response is a "permission_error" whose message contains "<reason>"
    And the upstream received no request
    And the usage log holds one record matching:
      """
      {"status":403,"route":"/v1/messages","error_type":"refused_by_policy"}
      """

    Examples:
      | case                | body                                                                                                                | reason                         |
      | mcp_servers         | {"mcp_servers":[{"url":"https://evil.example"}]}                                                                    | field refused: mcp_servers     |
      | an unknown field    | {"model":"m","x":1}                                                                                                 | field refused: x               |
      | server web_fetch    | {"tools":[{"name":"a"},{"type":"web_fetch_20250910","name":"f"}]}                                                   | tool type refused: web_fetch   |
      | an image by URL     | {"messages":[{"content":[{"type":"text"},{"type":"image","source":{"type":"url","url":"https://evil.example"}}]}]}  | source type refused: url       |
      | a document by file  | {"messages":[{"content":[{"type":"document","source":{"type":"file","file_id":"f"}}]}]}                             | source type refused: file      |
      | a source-less image | {"messages":[{"content":[{"type":"image"}]}]}                                                                       | source type refused: undefined |
      | a nested image      | {"messages":[{"content":[{"type":"tool_result","content":[{"type":"image","source":{"type":"url"}}]}]}]}            | source type refused: url       |
      | a system document   | {"system":[{"type":"document","source":{"type":"url"}}]}                                                            | source type refused: url       |
      | a body not JSON     | not json                                                                                                            | body is not JSON               |
      | a JSON array        | []                                                                                                                  | body is not a JSON object      |
      | JSON null           | null                                                                                                                | body is not a JSON object      |

  Scenario Outline: relays <case>
    When I POST through the proxy "/v1/messages" with the body '<body>'
    Then the proxy response status is 200
    And the upstream request 0 has the body '<body>'

    Examples:
      | case                         | body                                                                                                    |
      | a tool without type          | {"tools":[{"name":"a"}]}                                                                                |
      | a custom tool                | {"tools":[{"type":"custom","name":"a"}]}                                                                |
      | a tool that is not an object | {"tools":["a"]}                                                                                         |
      | tools that are not a list    | {"tools":1,"messages":1}                                                                                |
      | an inline image              | {"messages":[{"content":[{"type":"image","source":{"type":"base64"}}]}]}                                |
      | an inline text document      | {"messages":[{"content":[{"type":"document","source":{"type":"text"}}]}]}                               |
      | a nested content document    | {"messages":[{"content":[{"type":"tool_result","content":[{"type":"document","source":{"type":"content"}}]}]}]} |
      | a URL inside a tool input    | {"messages":[{"content":[{"type":"tool_use","input":{"source":{"type":"url"}}}]}]}                      |
      | blocks that are not objects  | {"messages":["a",{"content":"text"},{"content":[1]}]}                                                   |
      | a null block                 | {"messages":[{"content":[null]}],"system":[null]}                                                       |

  Scenario Outline: the size limit of the body: <size> bytes gives <status>
    When I POST a body of <size> bytes through the proxy
    Then the proxy response status is <status>
    And the proxy response body does contain "<text>"

    Examples:
      | size | status | text           |
      | 256  | 200    | claude-test    |
      | 257  | 403    | body too large |

  Scenario: relays count_tokens as well, and logs the route without the query
    When I POST through the proxy "/v1/messages/count_tokens" with the body '{}'
    Then the proxy response status is 200
    And the upstream request 0 has the url "/v1/messages/count_tokens"

  Scenario: a required beta already present is not sent twice, and values are trimmed
    When I POST through the proxy "/v1/messages" with the body '{}' and the headers:
      | anthropic-beta | oauth-2025-04-20 , x-1, |
    Then the upstream request 0 has the header "anthropic-beta" "oauth-2025-04-20,x-1"

  Scenario: no beta at all sends no beta header; without a usage log the session goes on
    Given the proxy is restarted without required betas
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the upstream request 0 has no header "anthropic-beta"
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 200

  Scenario: a JSON answer gives its model and tokens to the usage log
    When I POST through the proxy "/v1/messages?json=1" with the body '{}'
    Then the usage log holds one record matching:
      """
      {"status":200,"route":"/v1/messages","model":"claude-json","input_tokens":4,"output_tokens":2}
      """

  Scenario: the query of a route stays out of the usage log
    When I POST through the proxy "/v1/messages?beta=true" with the body '{}'
    Then the usage log holds one record matching:
      """
      {"status":200,"route":"/v1/messages"}
      """

  Scenario: hop-by-hop request headers do not reach the upstream, the host is the upstream's
    When I POST through the proxy with the raw headers:
      | proxy-authorization | a        |
      | proxy-connection    | b        |
      | te                  | trailers |
      | trailer             | x-t      |
      | keep-alive          | timeout=1 |
      | accept-encoding     | gzip     |
      | transfer-encoding   | chunked  |
      | upgrade             | h2c      |
      | x-kept              | yes      |
    Then the upstream request 0 has no header "proxy-authorization"
    And the upstream request 0 has no header "proxy-connection"
    And the upstream request 0 has no header "te"
    And the upstream request 0 has no header "trailer"
    And the upstream request 0 has no header "keep-alive"
    And the upstream request 0 has no header "transfer-encoding"
    And the upstream request 0 has no header "upgrade"
    And the upstream request 0 has the header "accept-encoding" "identity"
    And the upstream request 0 has the header "x-kept" "yes"
    And the upstream request 0 has the upstream's host

  Scenario: hop-by-hop response headers do not reach the client, the others do
    When I POST through the proxy with the raw headers:
      | x-kept | yes |
    Then the proxy response has the header "x-request-id" "r1"
    And the proxy response has the header "content-type" "text/event-stream"
    And the proxy response has the header "connection" "keep-alive"
    And the proxy response has no header "te"
    And the proxy response has no header "proxy-connection"
    And the proxy response has no header "upgrade"
    And the proxy response has no header "authorization"
    And the proxy response has no header "accept-encoding"

  Scenario: a refused route, and a refused session token, answer a typed error
    When I send "POST" to "/v1/models" through the proxy
    Then the proxy response body is exactly:
      """
      {"type":"error","error":{"type":"permission_error","message":"route refused by the auth proxy"}}
      """
    And the proxy response has the header "content-type" "application/json"
    When I POST through the proxy "/v1/messages" with the body '{}' and the session token "wrong"
    Then the proxy response body is exactly:
      """
      {"type":"error","error":{"type":"authentication_error","message":"session token required"}}
      """

  Scenario: an upstream that cannot be reached gives a typed 502
    Given the proxy is restarted over an upstream that refuses connections
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 502
    And the proxy response body is exactly:
      """
      {"type":"error","error":{"type":"api_error","message":"upstream unreachable"}}
      """


  Scenario: an https upstream is reached over TLS only: a plain HTTP server behind an https URL gives 502
    Given the proxy is restarted over the upstream addressed as https
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 502
    And the upstream received no request

  Scenario: the usage log is private: its folder 700, the file 600
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the usage log has the mode 600 and its folder the mode 700

  Scenario: the proxy listens on 127.0.0.1 only
    Then the proxy refuses a connection on ::1

  Scenario: an answer the upstream breaks is broken for the client too
    When I POST through the proxy "/v1/messages?break=1" with the body '{}' and the answer breaks
    Then the proxy answer was cut

  Scenario: closing the proxy cuts a request in flight and refuses new connections
    When I POST through the proxy "/v1/messages?hold=1" with the body '{}' without waiting
    And the upstream received 1 request
    Then the proxy closes within 1000 ms
    And the request in flight was cut
    And the proxy refuses a connection on 127.0.0.1

  Scenario: a usage log that cannot be created refuses to start the proxy
    Then starting a proxy whose usage log is under a file fails

  Scenario: a usage log that can no longer be written stops the proxy, which says so
    Given the usage log can no longer be written
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 200
    When I POST through the proxy "/v1/messages" with the body '{}'
    Then the proxy response status is 503
    And the proxy response body is exactly:
      """
      {"type":"error","error":{"type":"api_error","message":"usage log unwritable: the auth proxy refuses every request until it restarts"}}
      """
    And the upstream received 1 request
    When I POST through the proxy "/v1/messages" with the body '{}' and the session token "wrong"
    Then the proxy response status is 401
