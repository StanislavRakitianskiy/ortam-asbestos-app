# Handover note

ORTAM asbestos report app, a local prototype for the ORTAM developer exercise (candidate brief version 2). Setup and the
demo are in [README.md](README.md); the submitted files are listed in [docs/SUBMISSION.md](docs/SUBMISSION.md); the
brief's checklist is walked item by item in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

In short: every item of the brief's core completion checklist and every case detail (S02, S03 + S07, S05, S06 and M07,
S04) is implemented and checked. The optional floor plan mapping bonus was not started. The supplied demo data gives
the golden result of [CLAUDE.md](CLAUDE.md): total before tax CAD 32,808.00.

## Actual time spent

TODO — fill in from TIMELOG.md.

## AI tools used

**Claude Code (Anthropic), for development.** Used from the Claude desktop app as a coding agent in phases (phase 0
scaffold to phase 9 handover; see `git log`). It wrote most of the code, tests and documentation from the rules in
`CLAUDE.md` and the brief. I reviewed each phase and made every commit myself. Non-obvious choices it proposed were
recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

**Claude API, inside the application.** `@anthropic-ai/sdk` 0.135.0, model from `ANTHROPIC_MODEL` (default and the one
used: `claude-sonnet-5-5`). The key is read on the server only, from `.env.local`. It is used for exactly two steps:

| Step | Code | Prompt | What the model gets and returns |
|---|---|---|---|
| Lab PDF extraction | `src/server/ai/extractLabReport.ts` | `src/server/ai/prompts/labExtraction.v2.ts` | The text of each PDF page (extracted with pdfjs-dist). Returns the lab report ID and one row per sample layer: sample ID, layer, result label, asbestos type, percentage, page and the quoted source line, as JSON matching a schema. |
| Narrative draft | `src/server/ai/draftNarrative.ts` | `src/server/ai/prompts/narrative.v1.ts` | The computed report facts only (zones, layers, report IDs and pages, categories and their reasons, missing information, limitations), with no money amounts, no names and no PDF text. Returns prose for the executive summary, each zone and the limitations. |

Both go through `src/server/ai/structuredCall.ts`: `messages.create` with a JSON schema output format built by
`z.toJSONSchema`, then parsed with Zod in our code (D-016 explains why not `messages.parse`), effort `medium`,
`max_tokens` 16000, 90 s timeout, one fresh retry when the answer is unusable, and the API's server-side refusal
fallback (D-017). Every call is stored as an `AiRun` (model that answered, tokens, duration, prompt version, raw
answer) and can be opened in the UI with "View raw AI response".

The AI never computes costs, chooses a category, applies a threshold or writes amounts. Its output is a draft: lab rows
are used only after the employee accepts them, and narrative texts are checked by code guardrails and edited by the
employee. The automated tests replay recorded real answers (`tests/fixtures/ai/`), so they need no key.

## What I checked myself

TODO — fill in.

## Incomplete features

- **Floor plan mapping bonus** (brief page 8): not started. The report says "No floor plan is attached"; the Word
  template has an empty `{#hasPlans}` appendix block for it.
- **Automatic extraction of the field notes**: optional in the brief and not done. The employee enters
  `employee_field_notes.pdf` through the forms (or `npm run db:seed` loads it during development).
- **Jurisdiction note**: entered and stored, but not printed in the report. The report prints the fixed "does not claim
  legal compliance …" disclaimer instead.
- **Deleting a project** removes its database rows but leaves its revision files in `storage/reports/<projectId>/`.
  Uploaded PDFs are shared by SHA-256 and stay by design.

## Known limitations

- **PDFs with a text layer only.** Scanned PDFs are out of scope (no OCR); such a file is marked failed with "No
  selectable text found" instead of being sent to the AI, and its results can only be entered by hand.
- **One user, one machine.** No sign-in, roles or locking. Two browser tabs drafting the narrative at the same instant
  can both run; the later answer wins (D-036).
- **Local storage.** Data is a SQLite file (`prisma/dev.db`) and files under `storage/`, with no backup. Deleting them
  resets the app.
- **The AI can be wrong, so the employee review is mandatory.** The code checks the structure of every answer, that
  each quote exists on the cited page and that the values appear in it, and it flags problems instead of fixing them.
  These checks catch a merged layer, a wrong page or an invented quote, but not every possible misreading; a row
  counts only after the employee accepts it, and every correction is logged with its reason next to the AI original.
  The narrative guardrails do not check numbers written as words.
- **PDF layout can differ slightly from Word.** The PDF is made by LibreOffice inside Gotenberg, which replaces the
  master's Arial with the metrically compatible Liberation Sans. Line and page breaks can therefore differ a little
  from the same DOCX opened in Microsoft Word; the content is the same (D-042).
- **"Anthropic key: Configured"** on the home page is a format check (`sk-ant-…`). A wrong key shows up at the first AI
  call as an HTTP 401 message with Retry (D-007).
- **Fixed exercise rules.** The rate card, allowances, contingency and categories A–D are the fictional exercise rules,
  in `src/domain/rates.ts`, `costs.ts` and `categories.ts`; currency is CAD only.
- **Prototype, not a production deployment.** It runs with `npm run dev` locally; Gotenberg has no authentication and is
  therefore bound to `127.0.0.1` (D-006).

## Design decisions

All non-obvious choices are short records in [docs/DECISIONS.md](docs/DECISIONS.md) (D-001 to D-044). The main ones:

- D-001: one Next.js app with SQLite and Gotenberg, no n8n or separate backend.
- D-009: money in integer cents, each amount rounded to the cent.
- D-016, D-017, D-018: how the AI call is made, validated and retried.
- D-020, D-022, D-023: read-only uploads by SHA-256; re-upload and re-extraction never duplicate or overwrite reviewed
  rows.
- D-021, D-024, D-025: evidence checks flag rather than fix; corrections keep the AI original.
- D-027, D-032: analysis and report model are computed on every read, from one deterministic source.
- D-028, D-030: blocking issues must be resolved or kept flagged; "Similar ID" is a text hint, never a match.
- D-033, D-034, D-040: what the narrative AI sees, the guardrails, and which claims block generation.
- D-038: the Word template is built from the supplied master by a script, so the report follows its structure.
- D-039: one report revision = one snapshot hash; preview and both downloads come from it, and a changed hash marks it
  outdated.
- D-043: `npm run verify` checks the golden results with the app's own modules.

## Test fixture LAB-X

`fixtures/test/LAB-X_edge_cases.pdf` is a lab report I made for testing; it is not an ORTAM file and says so on the page
("TEST FIXTURE created by the candidate — not an ORTAM file"). The supplied LAB-A, LAB-B and LAB-C contain no unknown
sample ID and no contradictory result, but the brief requires both to be shown for review. LAB-X adds exactly those two
cases, in the same one-table layout as the supplied reports:

- `S7` (textured coating, detected): an ID that is not in the register. It stays unmatched, with the text hint "Similar
  ID in register: S07"; it is never linked automatically.
- `S04` (plaster, detected): contradicts LAB-B's not-detected S04, so it becomes a conflict the employee must resolve or
  keep flagged.

It is printed for project `ORTAM-DEMO-001-EDGE`, which the seed creates as a copy of the register, so it is never mixed
into the main demo and the golden results stay unchanged. `npm run fixture:edge` regenerates it byte for byte
(`scripts/make-edge-fixture.ts`). The integration test uses a hand-written AI answer for it, labelled as such in
`tests/fixtures/ai/lab-x.handwritten.json` (D-031).

## Next steps

1. Floor plan mapping bonus: upload a plan PDF, place and move markers per sample ID, show the matched status with a
   label or symbol as well as colour, store file, page and position, and add the plan appendix to the report.
2. Print the jurisdiction note in the report's project information.
3. Remove a project's revision files when the project is deleted.
4. Extract the employee field notes with AI into the forms as a draft, with the same review as lab results.
5. For more than one employee: sign-in, an audit trail per user and a server database instead of the SQLite file.
6. OCR for scanned lab reports, with a lower-confidence flag on such rows.
7. A short end-to-end browser test of the demo walk-through.
