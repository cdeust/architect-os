Feature: no file of the tree holds the shape of a credential
  The shapes are those of packages/sandbox/src/credential-shapes.ts (`findCredential`), the ones the port StepStore
  refuses to keep and the guard of the comments of the CI review refuses to post. A fixture that needs one composes it
  at run time; the text git tracks, or would track, holds none. The allow-list names a file that must hold one, with
  the reason; it is empty.

  Scenario: no tracked or trackable file of the repository holds a credential shape outside the allow-list
    When I read every file git tracks or would track in the repository
    Then no file holds a credential shape outside the allow-list
    And the allow-list of credential shapes is empty

  Scenario: a file that holds a credential shape is found and named, never quoted
    Given a repository whose file "notes/leak.txt" holds an OAuth token of Anthropic composed at run time
    When I read every file git tracks or would track in that repository
    Then the file "notes/leak.txt" is found to hold the shape "anthropic-oauth-token"
