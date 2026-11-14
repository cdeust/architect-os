# tools/evidence

The evidence desk: the orchestrator asks factual questions, a librarian answers them from the published literature, and the host verifies every answer before it counts. The contract does not say who the librarian is: Claude Science through the folder and the skill (below), or, from step S.2, a headless session under srt. Design, threat model and the steps: [`docs/design/evidence-desk.md`](../../docs/design/evidence-desk.md).

## Commands

```bash
npm run evidence -- ask <ledger> <desk> <id> < question.txt   # prints {"asked":"<id>","question":"<desk>/out/<id>.question.json"}
npm run evidence -- verify <ledger> <desk>                    # prints {"verified":[],"rejected":[],"deferred":[],"pending":[]}
```

`verify` exits with 0 when nothing is rejected or deferred, 1 otherwise. Any refusal (arguments, a folder, an invalid or repeated question, a missing skill file) exits with 2 and one line `architect-os evidence: <reason>` on stderr. An error nobody foresaw exits with 3 and one line `architect-os evidence: unexpected: <error>`, so that a caller reading the code alone tells a crash from a rejection. `verify` calls `doi.org` and nothing else.

## The two folders

Both are outside the repository, of mode 0700, created by the command, and refused if they are not real directories of the current user (a link as the last component is refused).

| Folder     | Who writes what                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ledger>` | The host alone, and it is authoritative: `asked/<id>.json`, `verified/<id>.json`, `sources/<sha256>.txt`.                                                                                                      |
| `<desk>`   | The exchange zone, nothing in it is authoritative. `out/` is written by the host (question copy, `<id>.rejected.json`, `SKILL.md`, `answer.schema.json`); `in/` by Science (`<id>.answer.json`, `<name>.txt`). |

`out` and `in` are flat: the store opens each file without following a link and refuses anything but a plain file with one link.

## The owner's gesture in Claude Science

Once per Science project, grant `<desk>/out` read-only and `<desk>/in` read and write. Then, for each batch of questions, one sentence: "Read `<desk>/out/SKILL.md` and handle the pending questions." The skill (`skill/SKILL.md`, `skill/answer.schema.json`) can also be added in Settings, Skills, to be called as `/evidence-desk` (design note §8).

## What is proved, and what is not

A verified record says `level: quote_in_supplied_text`: the DOI exists and is not retracted, its registry title matches the answer's, the text Science supplied contains that title, and contains the quoted passage. That the supplied text is really the article is not proved: a fabricated text that contains the title passes. Step S.3 closes this with a text fetched by the host (design note §5). The verifier never judges a claim true; whether the passage supports the claim is left to review.
