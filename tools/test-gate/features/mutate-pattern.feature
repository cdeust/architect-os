Feature: Test gate: the mutate patterns of Stryker, written by plan and read by rules 5 and 6
  A pattern is a path, a glob, or a path with a mutation range `:startLine[:startColumn]-endLine[:endColumn]`.
  plan writes one range per run of consecutive changed lines; rule 6 judges an entry only where the run mutated its
  lines; rule 5 accepts an absent judged file only if a pattern names it.

  Scenario Outline: the changed lines "<lines>" of f.ts are the ranges "<patterns>"
    Then the range patterns of "f.ts" for the lines "<lines>" are "<patterns>"

    Examples:
      | lines       | patterns              |
      | 3           | f.ts:3-3              |
      | 3, 4, 5, 9  | f.ts:3-5, f.ts:9-9    |
      | 9, 3, 4     | f.ts:3-4, f.ts:9-9    |
      | 10, 2       | f.ts:2-2, f.ts:10-10  |

  Scenario Outline: lines <start> to <end> of <file> under "<mutate>" are mutated: <mutated>
    Then the lines <start> to <end> of "<file>" are mutated under "<mutate>": <mutated>

    Examples:
      | file        | start | end | mutate          | mutated |
      | f.ts        | 3     | 4   | f.ts            | yes     |
      | src/f.ts    | 3     | 4   | src/*.ts        | yes     |
      | src/[id].ts | 3     | 4   | src/[id].ts     | yes     |
      | f.ts        | 3     | 4   | other.ts        | no      |
      | f.ts        | 3     | 4   | !f.ts           | no      |
      | f.ts        | 3     | 5   | f.ts:3-5        | yes     |
      | f.ts        | 4     | 4   | f.ts:3-5        | yes     |
      | f.ts        | 2     | 3   | f.ts:3-5        | no      |
      | f.ts        | 5     | 6   | f.ts:3-5        | no      |
      | f.ts        | 3     | 3   | g.ts:3-5        | no      |
      | f.ts        | 12    | 12  | f.ts:12-15      | yes     |
      | f.ts        | 3     | 12  | f.ts:3-15       | yes     |
      | f.ts        | 3     | 5   | f.ts:3:12-5     | yes     |
      | f.ts        | 3     | 5   | f.ts:3-5:12     | yes     |
      | f.ts        | 3     | 3   | f.ts:3-5x       | no      |
      | a:b.ts      | 3     | 3   | a:b.ts:3-5      | yes     |

  Scenario Outline: "<mutate>" names <file>: <named>
    Then "<mutate>" names "<file>": <named>

    Examples:
      | file        | mutate        | named |
      | f.ts        | f.ts:3-5      | yes   |
      | f.ts        | g.ts:3-5      | no    |
      | src/f.ts    | src/*.ts      | yes   |
      | src/[id].ts | src/[id].ts   | yes   |
      | f.ts        | g.ts          | no    |
      | f.ts        | !f.ts         | no    |
