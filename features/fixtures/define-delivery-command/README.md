# Define delivery-command fixture

The positive prd-gen stdio pilot at `22b7a886bf5e2664cd705a1d3cce5cbd8b879520` emitted these two Markdown files.
The capture copied the bytes from the run directory at the implementation gate while the decision was pending.
`observation.json` records the ordered artifact names, the pending MCP action and the run outcome.

The replay used built MCP server code and design-derived answers and local synthetic drafts. The verification report
shows how the canned judge responses were distributed. The saved outcome is `needs_attention`. The pilot supplied no
answer to the implementation gate. The original design is at architect-os `be492ac325aad604f073c7cb9613cda67b7952ce`.
The fixture test is based on architect-os `721b1861`.

| Captured Markdown           | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `01-prd.md`                 | `5a9eb1c6a3e8727eeba19b5f58cfe5893cbcb332b08776ab95c18204d7f0aeb4` |
| `10-verification-report.md` | `14b89322987ca9e1693e910c7fcb09e27561970d22ea950ea0a9fe0af44df574` |

The scenarios check fixture integrity before a production Define reader exists. They leave the delivery command and
the post-Plan step reader untouched.
