Feature: no file the rule reads holds docker or colima outside a closed list (docs/design/platform-v3-srt.md, decisions 21 and 22)
  Claude uses SRT. The SBX adapter checks the pinned VM policy. The program that measured the cost of containers was removed with
  its script, because it started a virtual machine and pruned the whole daemon. The question is not which files can
  start a process (that has no closed answer in text), it is which files hold the words:

  - the words docker and colima, in any case and anywhere in a text (docker-compose and DOCKER_HOST hold one), appear in
    no file the rule reads outside the closed list below;
  - the files read are the regular files and the symbolic links git tracks or would track (not ignored), of any
    extension, shell scripts included; the text of a symbolic link is its target, read and not followed, which is what
    git stores for it;
  - left out, because nothing in the repository runs them (no script of the two package.json files and no workflow
    gives one to a shell or an interpreter): the Markdown files, the files under a results directory, and under steps/
    the texts given to a session (brief.md, scout.<name>.md) and the records (record.json); every step.json is read,
    because it is the input the step tool runs (its checks[].command): its copy under steps/ is never run in place,
    since a published name is refused, but it can be run again from a copy;
  - the list is closed in both directions: a file outside it that holds a word is refused, and a listed file that is not
    in the tree or no longer holds a word is refused; each entry says why the word is there;
  - no script value of the package.json of the root nor of bench holds a word: package.json is not in the list, so the
    first rule already says it, and one scenario names it because it is the surface a reader runs.

  What a rule over text cannot see: a word assembled at run time, and a file of an excluded kind given to an interpreter.

  It is under features/arch, which the mutation profile leaves out; why is written in cucumber.mjs.

  Rule: no script holds a container tool

    Scenario Outline: the committed <file> holds none in a script
      Given the text of the committed file "<file>"
      Then no script value of the text holds docker or colima

      Examples:
        | file              |
        | package.json      |
        | bench/package.json |

    Scenario Outline: a copy of <file> with <form> in a script is refused
      Given the text of the committed file "<file>"
      When the text "<anchor>" is replaced by "<command>"
      Then the only script of the text that holds docker or colima is "<script>"

      Examples:
        | form                           | file               | script           | anchor                                | command                                 |
        | a command alone                | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | docker system prune -af                 |
        | an assignment before it        | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | VM=1 docker run --rm node              |
        | a timer before it              | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | time docker build .                     |
        | a runner before it             | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | npx colima start                        |
        | a compound name                | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | docker-compose up                       |
        | an argv array in a program     | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | node -e spawn(['docker','info'])        |
        | the name in capitals           | package.json       | baseline:analyze | node --import tsx baseline/analyze.ts | DOCKER_HOST=x node y.js                 |
        | a script of bench              | bench/package.json | bench:bare | node src/bare-launch.mjs              | colima stop && node src/bare-launch.mjs |

  Rule: a symbolic link is read on a real tree

    Scenario: a real link whose target holds a word is read, not followed
      Given a temporary git tree, not committed, holding
        | bench/src/clean.ts | file | export {}; |
        | bench/src/link.ts  | link | ../docker/run.ts |
        | steps/new/record.json | link | colima |
        | docs/notes.md      | file | a note on Docker |
      Then the only file of that tree that the rule reads and that holds docker or colima is "bench/src/link.ts"

  Rule: no file outside the closed list holds docker or colima

    Background:
      Given the closed list of the files that may hold docker or colima
        | docs/diagrams/architecture.svg                  | passive README illustration: names Docker SBX in visible and accessible labels; the architecture diagram validator restricts it to static shapes and local marker references |
        | packages/sandbox/sbx/isolation.json             | pinned SBX policy loaded by the host |
        | packages/sandbox/src/sbx-vm.ts                  | validates the repository of the kit, template and the forbidden socket in the policy |
        | bench/sbx/isolation.json                         | offline SBX qualification data: only the immutable shell kit, base template and forbidden guest socket specified in the scenario below |
        | baseline/overhead-analyze.ts                     | labels the kept results of the measure of the overhead (docker configurations); it reads and writes files and starts nothing |
        | docs/design/platform-v3.html                     | the vision of 29 October 2026, before decisions 21 and 22, a dated record of the container design (Dockerfile trees, a Docker exposure), still cited by invariant A of platform-v3-srt.md (figure 1); it opens with a dated line (19 November 2026): since decisions 21 and 22 the platform has one means of isolation, srt, and no container, and what the page says of containers is history |
        | features/descriptive/doc-paths.feature           | prose: it says that two commits removed the first realisation and Docker |
        | features/steps/doc-paths.ts                      | a comment of the step file of that feature, the same prose |
        | features/arch/no-container-command.feature      | this guard: it names the words it forbids and the poisoned copies |
        | features/steps/no-container-command.ts           | the step file of this guard: the pattern of the two words |
      And the files of the tree that the rule reads

    Scenario: the offline SBX policy is data with exactly three pinned literals
      Then the isolation data in "bench/sbx/isolation.json" equals
        """
        {
          "shellKit": "docker.io/sbx/shell@sha256:036c56158d78d741238079a4db9e36f072e6d047eb89debffab700b8cb0c3a96",
          "shellTemplate": "docker.io/library/sandbox-kit-assembled@sha256:036c56158d78d741238079a4db9e36f072e6d047eb89debffab700b8cb0c3a96",
          "forbiddenHostSocket": "/var/run/docker.sock"
        }
        """

    Scenario: the files of the tree hold a word only inside the list
      Then no file outside the closed list holds docker or colima

    Scenario: every file of the list is in the tree
      Then every file of the closed list is in the tree

    Scenario: every file of the list holds a word
      Then every file of the closed list holds docker or colima

    Scenario Outline: a new file with <form> is refused for its own path
      When the file "<path>" is added holding "<text>"
      Then the only file outside the closed list that holds docker or colima is "<path>"

      Examples:
        | form                      | path                | text                                  |
        | a word in an argv array   | bench/src/new.ts    | run('docker', ['info']);              |
        | a shell script            | scripts/new.sh      | docker system prune -af               |
        | the word in upper case    | baseline/new.ts     | const vm = 'COLIMA';                  |
        | a word in a data file     | deploy/new.json     | runner=docker                         |
        | another illustration      | docs/other.svg      | <text>Docker</text>                   |

    Scenario Outline: a new <kind> that holds a word is not read
      When the file "<path>" is added holding "docker run"
      Then no file outside the closed list holds docker or colima

      Examples:
        | kind                        | path                          |
        | Markdown file               | docs/new.md                   |
        | file under a results folder | bench/results/new.jsonl       |
        | record of a step            | steps/new/record.json         |
        | text given to a session     | steps/new/scout.q.md          |

    Scenario Outline: a step.json that holds a word is refused for its own path
      When the file "<path>" is added holding "{\"checks\":[{\"command\":[\"docker\",\"info\"]}]}"
      Then the only file outside the closed list that holds docker or colima is "<path>"

      Examples:
        | path                 |
        | steps/new/step.json  |

    Scenario: an entry added to the list that is not in the tree is refused
      When the entry "bench/src/gone.ts" is added to the closed list
      Then the only entry of the closed list that is not in the tree is "bench/src/gone.ts"

    Scenario: a listed file that is removed is refused
      When the file "baseline/overhead-analyze.ts" is removed
      Then the only entry of the closed list that is not in the tree is "baseline/overhead-analyze.ts"

    Scenario: a listed file emptied of the word is refused
      When the file "features/steps/doc-paths.ts" is rewritten to hold "export {};"
      Then the only entry of the closed list that holds neither docker nor colima is "features/steps/doc-paths.ts"
