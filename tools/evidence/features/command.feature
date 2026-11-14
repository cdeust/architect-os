Feature: npm run evidence, the command (fake process, the real file store over a throwaway root)
  `ask` and `verify` are run by `runEvidence` with dependencies the scenario holds; cli.ts only hands it the process.

  Rule: ask records the question and publishes the skill

    Scenario: a question is asked, and the files land where the design note puts them
      Given an evidence command over a throwaway root
      And the evidence command reads "  Does the literature say X?\n" on standard input
      When I run the evidence command with the arguments "ask <ledger> <desk> probe-1"
      Then the evidence command exits with 0
      And the evidence command stderr is empty
      And the evidence command stdout is the line:
        """
        {"asked":"probe-1","question":"<desk>/out/probe-1.question.json"}
        """
      And the evidence command file "ledger/asked/probe-1.json" is the question "probe-1" as "Does the literature say X?" asked at "2026-11-14T12:00:00.000Z"
      And the evidence command file "desk/out/probe-1.question.json" is the question "probe-1" as "Does the literature say X?" asked at "2026-11-14T12:00:00.000Z"
      And the evidence command file "desk/out/SKILL.md" is the committed skill file "SKILL.md"
      And the evidence command file "desk/out/answer.schema.json" is the committed skill file "answer.schema.json"
      And the evidence command made no network call

    Scenario: a folder under a link, as /tmp is on macOS, is made canonical and works
      Given an evidence command over a throwaway root
      And the evidence command root holds a link "short" to a folder "real"
      And the evidence command reads "A question?" on standard input
      When I run the evidence command with the arguments "ask <root>/short/ledger <root>/short/desk q1"
      Then the evidence command exits with 0
      And the evidence command stdout is the line:
        """
        {"asked":"q1","question":"<root>/real/desk/out/q1.question.json"}
        """
      And the evidence command file "real/ledger/asked/q1.json" exists

    Scenario: a relative folder is made absolute from the working directory
      Given an evidence command over a throwaway root
      And the evidence command reads "A question?" on standard input
      When I run the evidence command with the arguments "ask ledger ./desk/../desk q1"
      Then the evidence command exits with 0
      And the evidence command stdout is the line:
        """
        {"asked":"q1","question":"<root>/desk/out/q1.question.json"}
        """

  Rule: refusals exit with 2, one line on stderr and nothing on stdout

    Scenario Outline: the arguments "<arguments>" are refused
      Given an evidence command over a throwaway root
      And the evidence command reads "A question?" on standard input
      When I run the evidence command with the arguments "<arguments>"
      Then the evidence command exits with 2
      And the evidence command stderr is the usage line
      And the evidence command stdout is empty
      And the evidence command root holds no folder "ledger"

      Examples:
        | arguments                      |
        |                                |
        | frobnicate <ledger> <desk>     |
        | ask <ledger> <desk>            |
        | ask <ledger> <desk> a b        |
        | verify <ledger>                |
        | verify <ledger> <desk> a       |

    Scenario: a ledger that is a link is refused
      Given an evidence command over a throwaway root
      And the evidence command root holds a link "ledger" to a folder "real"
      And the evidence command reads "A question?" on standard input
      When I run the evidence command with the arguments "ask <ledger> <desk> a"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: FOLDER_NOT_A_REAL_DIRECTORY <ledger>: a real directory is required: an absolute path whose last component is not a link"
      And the evidence command stdout is empty

    Scenario: a desk of mode 755 is refused by verify
      Given an evidence command over a throwaway root
      And the evidence command root holds a folder "desk" of mode 755
      When I run the evidence command with the arguments "verify <ledger> <desk>"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: FOLDER_MODE_NOT_0700 <desk>: mode is 755"
      And the evidence command stdout is empty

    Scenario: a folder whose parent is missing is refused
      Given an evidence command over a throwaway root
      When I run the evidence command with the arguments "verify <root>/missing/ledger <desk>"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: the parent of <root>/missing/ledger cannot be resolved"
      And the evidence command stdout is empty

    Scenario: a desk whose parent is missing is refused
      Given an evidence command over a throwaway root
      When I run the evidence command with the arguments "verify <ledger> <root>/missing/desk"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: the parent of <root>/missing/desk cannot be resolved"
      And the evidence command root holds no folder "ledger"

    Scenario: a question that is not valid is refused with its issues on one line
      Given an evidence command over a throwaway root
      And the evidence command reads " \n" on standard input
      When I run the evidence command with the arguments "ask <ledger> <desk> Bad_Id"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: QUESTION_INVALID: $.id Invalid string: must match pattern /^[a-z0-9][a-z0-9-]{0,62}$/; $.question Too small: expected string to have >=1 characters"
      And the evidence command stdout is empty

    Scenario: a question asked twice is refused the second time
      Given an evidence command over a throwaway root
      And the evidence command reads "First?" on standard input
      And I run the evidence command with the arguments "ask <ledger> <desk> a"
      And the evidence command reads "Second?" on standard input
      When I run the evidence command with the arguments "ask <ledger> <desk> a"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: QUESTION_EXISTS: a is already in the ledger"
      And the evidence command stdout is empty
      And the evidence command file "ledger/asked/a.json" is the question "a" as "First?" asked at "2026-11-14T12:00:00.000Z"

    Scenario Outline: a skill folder without <missing> is refused before anything is created
      Given an evidence command over a throwaway root
      And the evidence skill folder holds only "<present>"
      And the evidence command reads "A question?" on standard input
      When I run the evidence command with the arguments "ask <ledger> <desk> a"
      Then the evidence command exits with 2
      And the evidence command stderr is "architect-os evidence: the skill file <root>/skill/<missing> cannot be read"
      And the evidence command stdout is empty
      And the evidence command root holds no folder "ledger"

      Examples:
        | present     | missing            |
        | SKILL.md    | answer.schema.json |
        | answer.schema.json | SKILL.md    |

  Rule: verify reports the four lists and exits with 0, or 1 when something is rejected or deferred

    Scenario: nothing answered: the question is pending, no network call, exit 0
      Given an evidence command over a throwaway root
      And the evidence command reads "A question?" on standard input
      And I run the evidence command with the arguments "ask <ledger> <desk> probe-1"
      When I run the evidence command with the arguments "verify <ledger> <desk>"
      Then the evidence command exits with 0
      And the evidence command stderr is empty
      And the evidence command stdout is the line:
        """
        {"verified":[],"rejected":[],"deferred":[],"pending":["probe-1"]}
        """
      And the evidence command made no network call

    Scenario: a full round: ask, an answer and its text dropped in, verify against the recorded registry
      Given an evidence command over a throwaway root
      And the evidence command reads "Do assistants help understanding code?" on standard input
      And I run the evidence command with the arguments "ask <ledger> <desk> probe-1"
      And Science drops the text "paper.txt" holding the title and the passage
      And Science drops the answer "probe-1" citing the recorded article in "paper.txt"
      When I run the evidence command with the arguments "verify <ledger> <desk>"
      Then the evidence command exits with 0
      And the evidence command stderr is empty
      And the evidence command stdout is the line:
        """
        {"verified":["probe-1"],"rejected":[],"deferred":[],"pending":[]}
        """
      And the evidence command asked the registry for "https://doi.org/10.1145/3597503.3639187"
      And the evidence command gave the registry a signal that is not aborted
      And the evidence command ledger holds the verified record "probe-1" of the recorded article asked as "Do assistants help understanding code?"

    Scenario: an answer whose passage is not in the text is rejected: exit 1
      Given an evidence command over a throwaway root
      And the evidence command reads "A question?" on standard input
      And I run the evidence command with the arguments "ask <ledger> <desk> probe-1"
      And Science drops the text "paper.txt" holding only the title
      And Science drops the answer "probe-1" citing the recorded article in "paper.txt"
      When I run the evidence command with the arguments "verify <ledger> <desk>"
      Then the evidence command exits with 1
      And the evidence command stderr is empty
      And the evidence command stdout is the line:
        """
        {"verified":[],"rejected":["probe-1"],"deferred":[],"pending":[]}
        """
      And the evidence command file "desk/out/probe-1.rejected.json" exists

    Scenario: a registry that is down defers the answer: exit 1
      Given an evidence command over a throwaway root
      And the evidence command reads "A question?" on standard input
      And I run the evidence command with the arguments "ask <ledger> <desk> probe-1"
      And Science drops the text "paper.txt" holding the title and the passage
      And Science drops the answer "probe-1" citing the recorded article in "paper.txt"
      And the registry answers 503
      When I run the evidence command with the arguments "verify <ledger> <desk>"
      Then the evidence command exits with 1
      And the evidence command stdout is the line:
        """
        {"verified":[],"rejected":[],"deferred":["probe-1"],"pending":[]}
        """

  Rule: an error nobody foresaw exits with 3, one line on stderr and nothing on stdout

    Scenario: the rejection to remove is a folder: the record is written, the command says what failed
      Given an evidence command over a throwaway root
      And the evidence command reads "A question?" on standard input
      And I run the evidence command with the arguments "ask <ledger> <desk> probe-1"
      And Science drops the text "paper.txt" holding the title and the passage
      And Science drops the answer "probe-1" citing the recorded article in "paper.txt"
      And the evidence command desk holds a folder "out/probe-1.rejected.json"
      When I run the evidence command with the arguments "verify <ledger> <desk>"
      Then the evidence command exits with 3
      And the evidence command stdout is empty
      And the evidence command stderr is one line starting with "architect-os evidence: unexpected: Error: " and naming "<desk>/out/probe-1.rejected.json"
      And the evidence command file "ledger/verified/probe-1.json" exists

  Rule: the real dependencies come from the process and the module

    Scenario: the dependencies of a process
      When I build the evidence dependencies of a fake process with the arguments "node cli.ts verify /a /b"
      Then the evidence dependencies hold the arguments "verify /a /b", the working directory and the user of that process
      And the evidence dependencies read standard input, write to the streams of that process and use the clock, fetch and fs constants of node
      And the evidence dependencies hold the skill folder "tools/evidence/skill/" of this repository
