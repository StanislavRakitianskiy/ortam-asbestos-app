# Decisions

Short records of non-obvious choices. Newest at the bottom.

## D-001 · Next.js + SQLite + Gotenberg, no n8n (2026-10-18)

**Decision.** One Next.js (App Router) app holds the UI and the server logic as route handlers. Data lives in a
SQLite file through Prisma. DOCX → PDF conversion runs in Gotenberg 8 from `docker-compose.yml`.

**Why.**
- A reviewer starts everything with two commands: `docker compose up -d` and `npm run setup && npm run dev`.
  No database server, no message queue, no extra accounts.
- One TypeScript codebase means the domain rules (matching, categories A–D, costs in integer cents) are plain
  functions with unit tests, shared by the UI and the server.
- SQLite is a single gitignored file: enough for one employee on one machine, and trivial to reset.
- Gotenberg converts the generated DOCX with LibreOffice, so the preview PDF and the Word download come from the
  same document instead of two separate renderers.

**Why not n8n.** n8n would add a second runtime, its own database and credentials, and workflows stored outside
the repository, where tests and code review cannot reach them. Each step here (extract, validate, match, price,
render) is a function call that needs strict typing and tests, not a visual workflow.

## D-002 · Prisma 6.19.3, not 7.x (2026-10-18)

Prisma 7 requires a driver adapter for SQLite (`@prisma/adapter-better-sqlite3` plus the native `better-sqlite3`
build). CLAUDE.md asks for approval before adding dependencies, and a native build is one more thing that can fail
on a reviewer's machine. Prisma 6 needs neither. `npm audit` flags `deepmerge-ts` inside the Prisma 6 CLI config
loader (stack exhaustion on recursive objects): dev-time CLI only, never in the app runtime. Revisit if we upgrade.

Prisma does not read `.env.local`, so `prisma.config.ts` loads it with Node's `process.loadEnvFile`.
`DATABASE_URL="file:./dev.db"` resolves relative to `prisma/schema.prisma`, so the file is `prisma/dev.db`.

## D-003 · Vitest 4.1.12, Node ≥ 22.18 (2026-10-18)

Vitest 5 declares `node: ^22.12 || ^24 || >=26`, which excludes Node 25 (the development machine). Vitest 4
supports 20, 22 and ≥ 24. `engines.node` is `>=22.18.0` because the seed (`prisma/seed.mts`) runs on Node's
built-in TypeScript support. Recommended runtime: Node 24 LTS.

## D-004 · pdfjs-dist pinned to react-pdf's version (2026-10-18)

`react-pdf@11.0.0` depends on exactly `pdfjs-dist@6.3.289`. The top-level `pdfjs-dist` (server-side text
extraction) uses the same version, so there is one copy and the browser worker matches the viewer API.

## D-005 · Exact dependency versions (2026-10-18)

`.npmrc` sets `save-exact=true`; `package.json` has no `^` or `~`, and `package-lock.json` is committed.
`npm audit` also flags `braces` via `eslint-config-next` (lint tooling only).

## D-006 · Gotenberg bound to 127.0.0.1 (2026-10-18)

Gotenberg has no authentication and can render arbitrary HTML and URLs, so the compose file publishes it as
`127.0.0.1:3001:3000` rather than on every network interface. The app reaches it at `http://localhost:3001`.

## D-007 · "Anthropic key configured" is a format check (2026-10-18)

`/api/health` reports `configured: true` only when `ANTHROPIC_API_KEY` is set and shaped like `sk-ant-…`. It
does not call the API (no cost, works offline) and never returns the value. A placeholder or comment in
`.env.local` shows as "Not configured" with a hint.

## D-008 · `typecheck` runs `next typegen` first (2026-10-18)

Next.js 16 generates global route types such as `LayoutProps` into `.next/types`. On a fresh clone that folder
does not exist, so `npm run typecheck` is `next typegen && tsc --noEmit`.

## D-009 · Money rounding: each amount to the cent, integer arithmetic (2026-10-19)

Rates and allowances are integer cents. A zone quantity has at most two decimals (`materialZoneSchema`), so it is
converted to hundredths of a unit and multiplied by the rate in cents with exact integer arithmetic. The removal amount
and the replacement amount are each rounded half-up to whole cents, and `lineTotal = removal + replacement`. This way
the removal subtotal plus the replacement subtotal always equals the zone subtotal printed in the report. Contingency is
`round(direct × 20 / 100)`. `formatCad` formats from integer cents, never from a float.

## D-010 · Review issue severity (2026-10-19)

- **blocking**: an ID or data problem the employee must resolve or explicitly flag: unmatched lab sample, a sample ID in
  two zones, conflicting results, a registered sample with no lab result (often a typo such as `S7`), and an unknown or
  unit-mismatched rate on a zone that would be priced.
- **warning**: a legitimate limitation that the report carries as-is: inconclusive layer, unsampled or inaccessible
  zone, detected zone with unknown quantity or no rate reference, a bad rate on a zone that is not priced anyway, and
  the same lab report ID in two uploaded files (identical rows are already counted once).

Issue keys are `TYPE:id[:id…]` built from the zone ID, normalized sample ID, layer key or lab report ID, so they stay
stable when the match is recomputed and an employee's resolution can be stored against them.

A sample ID listed in two zones keeps its lab results under both zones until the employee fixes the register. Hiding
them would make the sample look "awaiting result", which is false; the blocking issue keeps the report from looking
final.

## D-011 · Layer comparison (2026-10-19)

Layers of one sample are compared after trimming, collapsing whitespace and lower-casing ("Black adhesive" equals
"black  adhesive"). Different wording stays two separate layers; nothing is merged by similarity. The same sample and
layer with different labels is a CONFLICT layer: it does not count as detected, and the zone is DETECTED only if
another layer is detected without conflict.

## D-012 · One `init` migration instead of the phase 0 one (2026-10-19)

Phase 0 shipped a placeholder migration with only `Project(id, code)`; the only data was the seeded `DEMO` row. Phase 2
replaces it with a single `init` migration for the full model (`docs/DATA_MODEL.md`), so a fresh clone applies one
migration. A development database created in phase 0 must be recreated: `rm prisma/dev.db && npx prisma migrate dev`.
A running `next dev` must also be restarted after `prisma generate`, because it keeps the old client in memory.

## D-013 · Project dates are `YYYY-MM-DD` text (2026-10-19)

Inspection and report dates are calendar days. A `DateTime` would store UTC midnight and could show the previous day in
a time zone west of UTC. They are stored as text, validated with `z.iso.date()`, and compared as strings (ISO dates
sort correctly). The report date may not be before the inspection date.

## D-014 · Material zone input rules (2026-10-19)

- One zod schema set (`src/domain/projectInput.ts`) is used by the forms and by the route handlers. Objects are strict:
  an unknown key is a 400, not silently dropped.
- Quantity must be sent explicitly on create: a number > 0 with at most two decimals, or `null` for Unknown. A missing
  quantity is an error, never 0 or null by default.
- Material IDs are trimmed and uppercased like sample IDs and are unique within a project.
- Sample IDs are normalized (trim + uppercase) on input. One ID per entry: spaces, commas, `;` and `|` are rejected so
  `S03|S07` cannot become one ID; the chips input splits them instead. The same ID twice in one zone is rejected. The
  same ID in two zones is allowed and shown as a warning, because matching reports it as a blocking issue (D-010).
- A rate reference must be on the rate card or `null`. A rate whose unit differs from the zone unit is accepted and
  warned about ("… it will not be priced"); the cost code never applies it.
- In the form, unit, condition and planned disturbance start unselected so nothing is silently defaulted.
  Accessible starts at Yes.

## D-015 · Service tests use a throwaway SQLite file (2026-10-19)

`tests/helpers/testDb.ts` creates a database in the OS temp folder and applies the real migrations with
`prisma migrate deploy` (about a second per test file). Each test file has its own file, so files can run in
parallel, the tests exercise the same SQL as the app, and `prisma/dev.db` is never touched.

## D-016 · Structured output via `messages.create` and `z.toJSONSchema`, not `messages.parse` (2026-10-19)

The extraction asks for JSON with `output_config.format = { type: "json_schema", schema }` and parses the answer itself
with zod (`parseExtraction`, check a). Two findings in SDK 0.135 ruled out the `messages.parse` + `zodOutputFormat`
helper:

- `parse` throws an `AnthropicError` when the answer fails zod validation, and the thrown error does not carry the
  message. The raw answer, response ID and token counts of that call would be lost, so the AiRun could not record
  them and the retry could not tell the model what was wrong.
- `zodOutputFormat` runs the schema through a transform that moves `enum` into the description. The result label would
  then be a free string instead of being constrained to `DETECTED | NOT_DETECTED | INCONCLUSIVE`.

`labExtractionJsonSchema()` uses `z.toJSONSchema` (enums kept, every property required, `additionalProperties: false`)
and drops only the safe-integer bounds zod adds to `z.int()`; a test checks that only supported keywords remain.

## D-017 · Server-side refusal fallback (2026-10-19)

Requests go through `client.beta.messages.create` with `betas: ["server-side-fallback-2026-07-01"]` and
`fallbacks: "default"`: if the requested model declines for policy reasons, the API re-runs the request on its default
fallback model inside the same call. The answer is read from the text after the last `fallback` block, and
`AiRun.model` stores `response.model`, i.e. the model that actually answered. A refusal of the whole chain is
`FAILED` (`REFUSED`) with Retry; it is never retried automatically.

## D-018 · Extraction call settings (2026-10-19)

- Model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `effort: "medium"`, thinking left at the model default
  (adaptive; Sonnet 5.5 rejects `disabled`), no temperature (rejected by the model), `max_tokens` 16000, non-streaming.
- Client timeout 90 s; the SDK itself retries 408/409/429/5xx and connection errors twice. Those retries belong to one
  AiRun.
- An unusable answer (not JSON, wrong shape, cut off at `max_tokens`) gets one automatic retry as a fresh request with
  the problems appended to the prompt. The earlier answer is not replayed as conversation history, so no thinking blocks
  have to be echoed back. Each attempt is its own AiRun.
- Prompt settings live in the versioned prompt file. `labExtraction.v1` often returned `labReportId: null` although the
  report title prints it (LAB-B, LAB-C), so `labExtraction.v2` says where the ID usually is. v1 stays in the repository
  because stored AiRuns reference it. A missing report ID is also a deterministic warning (`LAB_REPORT_ID_MISSING`).

## D-019 · Extraction runs after the upload response (2026-10-19)

The upload route stores the file, reads its text and answers at once; the AI call runs in `after()` from
`next/server`. The Lab reports tab polls every 2 s while a document is `UPLOADED` or `EXTRACTING`. Moving to
`EXTRACTING` is a conditional update, so two clicks cannot start two extractions. A document still `EXTRACTING` after
10 minutes (longer than the 90 s timeout with SDK retries and our one retry) was cut off by a server restart: the next
read marks it `FAILED` (`INTERRUPTED`) with Retry and closes its `RUNNING` AiRun.

## D-020 · Content-addressed, read-only uploads (2026-10-19)

A PDF is stored as `storage/uploads/<sha256>.pdf` (`LabDocument.storagePath` is relative to `STORAGE_DIR`). It is
written under a temporary name, made read-only (`0444`) and hard-linked into place, which fails instead of
overwriting. Same hash means same bytes, so an existing file is left as is and two projects uploading the same PDF share
it; deleting a project therefore never deletes upload files. De-duplication is per project
(`@@unique([projectId, sha256])`): a re-upload returns the existing document with `duplicate` and never calls the AI or
creates results. Files are accepted only with type `application/pdf`, content starting with `%PDF-`, and at most 10 MB.
A PDF without a text layer is stored as `FAILED` / `NO_TEXT` without Retry (OCR is out of scope).

## D-021 · Verification flags instead of silent fixes (2026-10-19)

`verifyExtraction` never changes a label, applies a threshold or drops a row. Failed checks become flags on the row
(`LabResult.verificationJson`) or warnings on the document (`LabDocument.warningsJson`) for the review step:

- The quote must match exactly one line of the cited page after normalizing whitespace, Unicode compatibility forms and
  typographic quotes/dashes. A quote matching several lines is `EVIDENCE_AMBIGUOUS`, not verified.
- On the cited line the sample ID (as a whole token), the layer, the printed result, the type and the content must
  appear; "Not detected" next to a `DETECTED` label is `LABEL_CONTRADICTS_LINE`.
- Check (h): every line that looks like a result row (three or more cells separated by two or more spaces, one cell
  exactly "Detected", "Not detected" or "Inconclusive") must be cited by some result. This catches merged or skipped
  layers and relies on `extractPages` rendering column gaps as two spaces.
- Any flag lowers the stored confidence to `LOW`; the model's own value stays in `aiJson`. A percentage outside 0–100
  is stored as `null` with a flag; the original stays in `aiJson`.

## D-022 · Re-extraction replaces drafts, not reviewed rows (2026-10-19)

Retry and "Extract again" delete the document's earlier `AI` rows and insert the new ones in one transaction, so rows
are replaced, never added. Rows the employee accepted or corrected (a `Correction` exists) are kept unless the request
says `replaceReviewed: true`; without it the API answers 409 `REVIEWED_RESULTS` and the UI asks for confirmation.
`MANUAL` rows are never touched. While a document is `EXTRACTING` or `FAILED`, its results are not returned at all, so a
failed step never shows stale rows as current.

**Changed in phase 4 (D-023):** the 409 `REVIEWED_RESULTS` confirmation is gone.

## D-023 · Re-extraction keeps reviewed rows without asking (2026-10-19)

Supersedes the confirmation step of D-022. "Extract again" (`replaceReviewed: false`) now always runs: AI rows the
employee accepted or corrected and every `MANUAL` row stay as they are, and only untouched AI drafts are replaced. A new
draft for the same sample and layer as a kept, non-rejected row is not inserted, so nothing is doubled. A rejected,
uncorrected row is a discarded draft and is replaced like the others. `replaceReviewed: true` still replaces reviewed AI
rows; the Lab reports card offers it as a secondary, destructive choice when reviewed rows exist. Reason: the phase 4
requirement that re-extraction never erases accepted rows, and the earlier dialog only offered "cancel" or "replace
everything".

## D-024 · Review: corrections, decisions and what leaves review (2026-10-19)

- Editable fields: sample ID, layer, result, asbestos type, content % and lab note. Page and quote are evidence: when
  they are wrong the row is rejected and the right row is added by hand with its own page and quote.
- Every correction needs a reason (`reasonSchema`, max 300 characters); the route handler and the service both parse
  with the same zod schema, so a missing reason is HTTP 400 either way. Each changed field is one `Correction`
  (`oldValue`/`newValue` JSON-encoded, `null` when absent); an unchanged field is not logged and a correction that
  changes nothing is a 400. `aiJson` is never written after the extraction.
- A correction puts the row back to `PENDING` (also from `ACCEPTED`), unless the request says `accept: true`
  ("Save and accept"): what is used must have been accepted in its current form.
- Rejecting needs a reason (`rejectReason`). "Back to pending" (`REOPEN`) undoes a decision.
- A row cannot be accepted without a sample ID, a layer, a quote and a page that exists in the PDF.
- "Accept all verified" takes pending rows with `evidenceVerified`, confidence not `LOW` and no open flag. Flags can
  appear after a correction while the AI confidence stays as it was, so "no open flag" is checked too.
- A document is `ACCEPTED` when it has at least one row and none is pending; any pending row (a correction, a reopen, an
  added row, a re-extraction) moves it back to `NEEDS_REVIEW`. A document without rows stays in review.
- **Only accepted rows of `ACCEPTED` documents** reach matching and the report (`labReviewService.acceptedResults`).
  With accepted rows of half-reviewed documents, S02 with the tile accepted and the adhesive still pending would read as
  not detected: an invented negative. A document still in review counts as "awaiting result" instead.
- The employee can enter or correct the lab report ID (Review tab, with a reason). It is logged as a `Correction` with
  entity `LabDocument`, field `labReportId`; a new extraction keeps it and drops the `LAB_REPORT_ID_MISSING` warning.
  A report with no ID at all is identified by its file name in matching, as that warning says.
- Every review change moves `Project.updatedAt` in the same transaction.

## D-025 · Evidence checks run again after every review change (2026-10-19)

`checkResultRows` (checks b–e, g, h of `verifyExtraction`) runs on the current values of every non-rejected row of the
document after each correction, decision, added row and re-extraction (`refreshDocumentReview`). A corrected sample ID
loses its "not in the cited line" flag, a correction that contradicts the line gains one, and a row added by hand covers
a line the AI skipped, so its `LINE_NOT_EXTRACTED` warning disappears. Other document warnings describe the AI answer
and are kept. `PERCENTAGE_OUT_OF_RANGE` is carried while the percentage is still empty, because the bad value exists only
in `aiJson`. Confidence is the AI's own statement and is never recomputed.

## D-026 · One line builder for the server and the PDF viewer (2026-10-19)

`src/lib/pdfText.ts` holds the line reconstruction (`groupLines`), `normalizeEvidence` and the quote search. The server
uses it to store page lines and verify quotes; the Source panel feeds the same function the text items pdf.js gives
react-pdf in the browser (same `pdfjs-dist` version, D-004) and marks the items of the matching line through
`customTextRenderer`. "Quote found" in the viewer therefore means the same as `evidenceVerified` on the server. A quote
on no line shows "Evidence not found on this page — verify manually"; a quote on several lines is shown as ambiguous.
The PDF is served from `GET …/lab-documents/[docId]/file` (read-only upload, cacheable because it never changes).

## D-027 · One analysis, computed on every read (2026-10-19)

`analysisService` (`GET /api/projects/[id]/analysis`) loads the zones, the accepted rows of accepted lab reports, the state
of every lab report and the stored decisions in one transaction and runs the pure `analyzeProject`
(`src/domain/analysis.ts`): `matchProject` → `categorize` → `computeEstimate`, plus the lab-row checks and the decisions.
Nothing derived is stored, so a zone edit, a correction or a re-extraction can never leave a stale match, category or
amount behind. The Matching view, the report and the plans read this one result. A decision call answers with the
recomputed analysis, so the screen never shows a state the server did not compute.

## D-028 · Issue decisions: Resolve or Keep flagged, by stable key (2026-10-19)

- Only **blocking** issues take a decision. Warnings (inconclusive, unsampled, inaccessible, missing quantity, …) are
  limitations the report carries anyway; they show as "No decision needed".
- **Resolve** (with a note) records that the employee checked the issue and it needs no mention in the report. It changes
  no lab result or zone: a resolved conflict still leaves its layer unresolved (category C, not priced). To change a
  finding, the employee corrects or rejects the lab row or edits the zone, and the issue disappears on its own.
- **Keep flagged in draft** (with a note) lets the report be generated; the note goes to the report's scope limitations
  (`flaggedLimitations`).
- Decisions are stored by the issue key (D-010), so they survive recomputation. Each stores a snapshot of the issue (type,
  message) and `refsKey`, the sorted zones, samples, lab rows and documents it was about. If the issue later refers to
  other evidence (e.g. a third report adds a row to a resolved conflict), the decision no longer applies: the issue is
  open again and the earlier decision is shown as outdated. A decision whose issue is gone (or became a warning) is listed
  as **auto-cleared** with its snapshot; the employee can remove it.
- Readiness: "Blocked: N open items" while any blocking issue is open, else "Draft with N flagged items", else "Ready to
  generate". Generation is allowed whenever nothing is open.
- Every decision moves `Project.updatedAt`, because it changes what the report says.

## D-029 · Review gaps that block the draft (2026-10-19)

Two blocking issue types come from the review state rather than from matching (`src/domain/labRowIssues.ts`):

- `LAB_REPORT_NOT_REVIEWED`: an uploaded lab report that is still extracting, failed, or has pending rows. Its rows are
  not used (D-024), so without this issue the draft would silently miss them.
- `EVIDENCE_NOT_VERIFIED`: an accepted row whose quote is not on exactly one line of the cited page, or that still has
  an open verification check. The report would cite evidence nobody can find again. The typical case is a sample ID the
  employee relabels against the print (LAB-X prints "S7", corrected to S07): the corrected row now matches M03, and the
  employee confirms the relabel with a resolution note.

`LOW_CONFIDENCE` (low AI confidence, quote verified) is a warning only.

## D-030 · "Similar ID in register" is a text hint, never a link (2026-10-19)

For an unmatched lab sample the analysis lists register IDs with the same letters and numbers once separators and leading
zeros are ignored (`S7` → `S07`, `src/domain/similarIds.ts`). It is shown as text next to the unmatched row. Matching
itself stays exact (trim + uppercase). The row joins a zone only after the employee corrects its sample ID through the
logged correction from phase 4, or adds the ID to a zone.

## D-031 · LAB-X edge-case fixture and the ORTAM-DEMO-001-EDGE project (2026-10-19)

`scripts/make-edge-fixture.ts` (`npm run fixture:edge`) draws `fixtures/test/LAB-X_edge_cases.pdf` with pdf-lib in the
same one-table layout as LAB-A/B/C, labelled "TEST FIXTURE created by the candidate — not an ORTAM file". Its rows are
`S7 Textured coating Detected Chrysotile 1%` (an ID the register does not have) and `S04 Plaster Detected Chrysotile
3%` (contradicts LAB-B). Dates and metadata are fixed, so the file is byte-for-byte reproducible and its SHA-256 does
not change when the script is re-run. It prints project `ORTAM-DEMO-001-EDGE`; the seed creates that project as a copy
of the register, so LAB-X is never mixed into the main demo and the golden results stay as they are. In the EDGE project
LAB-A/B/C carry the phase 3 "lab report is for project ORTAM-DEMO-001" warning, which is expected there.

The integration test (`tests/server/analysisService.test.ts`) uploads the real PDFs, replays the recorded AI answers
(and a hand-written answer for LAB-X, labelled as such in `tests/fixtures/ai/lab-x.handwritten.json`), accepts the
verified rows and checks the golden results and the LAB-X issues from the database.

## D-032 · ReportModel: one deterministic source for the report (2026-10-19)

`buildReportModel` (`src/domain/reportModel.ts`) is pure and has the sections of the Word master. Zones, layers, sources,
categories, amounts, limitations, exclusions and appendices come from `analyzeProject`; the model is built on every read,
like the analysis (D-027), so a data change can never leave stale facts in the report.

- It takes the analysis with the employee's decisions already joined, not the raw `ReviewIssueResolution` rows:
  `applyResolutions` has already compared `refsKey`, and the raw rows could show an outdated decision as if it applied. The
  appendix lists current, outdated and auto-cleared decisions with their state.
- The second executive summary paragraph (counts, amounts, unpriced and unresolved zones) is built in code
  (`factsParagraph` in `src/domain/reportText.ts`) and is read-only in the UI. "Samples" counts distinct registered sample
  IDs; layer results are counted per sample, so S02 adds two.
- Disclaimers, the scenario text and the status are constants in `reportText.ts`, worded after the master. The status is
  always "Draft pending human and professional review"; the checklist only states which items were checked.
- `Project.reviewedBy` ("Reviewed by … / pending" in the project information) and the checklist reviewer are separate:
  the first is the human or professional reviewer of the report, the second is who ticked the in-app checks.

## D-033 · What the narrative AI sees, and which numbers it may write (2026-10-19)

The AI gets `narrativeFacts(model)` only: zones, layers, report IDs and pages, categories with their code-built reason,
missing information and limitations. No PDF text, no person's name (client, preparer, reviewer), no earlier narrative and
no money: the cost status is a phrase ("Not priced (quantity unknown)").

CLAUDE.md says the AI never writes numbers; the phase 6 brief says numbers that are not in the ReportModel are flagged.
The guard compares numbers with the AI facts, not the whole model, because the model contains the amounts and
"32,808.00" in a narrative would otherwise pass. Non-money numbers from the facts (quantities, lab percentages, pages,
counts) are accepted; any currency or money-formatted amount is always flagged. Numbers written as words are not checked.

## D-034 · Guardrails: warnings on every read, structure checked hard (2026-10-19)

`src/domain/textGuards.ts` has two kinds of checks.

- `checkDraftStructure` on the AI answer: an unknown, missing or duplicated material ID, or a category other than the
  computed one, makes the answer unusable. It is retried once with the problems (as in D-018) and then rejected as a
  whole: a text for an unknown zone has nowhere to go, and the category is never the AI's to choose.
- `checkNarrative` on the stored texts: warnings shown beside the text, never stored and never blocking a save. They run
  on every read, so they cover employee edits and data changes after the draft. Rules: a zone's findings texts (the four
  together) and its recommendation name its material ID, location as entered and every sample ID; a summary or
  limitations text that names a zone also gives its location and samples; letters-plus-digits tokens (S08, M09) must exist
  in the facts; numbers and money as in D-033; a zone text may not name another category or use its wording; a category D
  zone says "sampled material"; forbidden claims.
- Forbidden claims: asbestos-free / free of asbestos / no asbestos in the building and close variants are accepted only
  when a negation (not, no, cannot, …) stands before them in the same sentence, within 12 words ("does not establish that
  the building is free of asbestos"). Compliance, clearance, "cleared", "safe to occupy" and prescribed removal are always
  flagged, negated or not.

## D-035 · Narrative storage, redraft and employee edits (2026-10-19)

- One `ReportNarrative` row per slot: `executiveSummary`, `zoneInterpretation`, `zoneReason`, `zoneUncertainty`,
  `zoneFollowUp`, `recommendation` (itemKey = zone ID, which survives a material ID rename) and `limitations`.
  Paragraphs are separated by a blank line, limitations by a line break.
- A new AI draft writes `aiText` of every slot but replaces `text` only where the source is still `AI_DRAFT`; texts the
  employee edited are kept (as D-023 keeps reviewed lab rows). "Reset to AI draft" takes the current `aiText`.
- Prose edits need no reason and write no `Correction`: the AI original stays in `aiText`, and the correction log is
  for extracted lab data. A text equal to the AI draft counts as the AI draft again; emptying a slot that has no AI draft
  deletes it.
- Every narrative change moves `Project.updatedAt`. Deleting a zone deletes its slots; a draft removes slots of zones that
  no longer exist.
- `AiRun.inputHash` is the SHA-256 of the facts a NARRATIVE run was given. When the latest successful run's hash differs
  from the current facts, the Draft tab says the draft is outdated.

## D-036 · Narrative call: shared transport, synchronous request (2026-10-19)

- The extraction's call logic moved to `src/server/ai/structuredCall.ts` (`runStructuredCall`): `messages.create` with a
  `json_schema` format from `z.toJSONSchema` (D-016), server-side fallback (D-017), one fresh retry for an unusable
  answer, one `AiRun` per call. `narrative.v1` uses effort `medium` and `max_tokens` 16000.
- "Draft narrative with AI" is a POST that waits for the answer (spinner, usually well under a minute). There is no
  document status to poll as in D-019. A failure answers HTTP 502 with the readable message and the AI error code; nothing
  is stored, the failed `AiRun` stays for "View raw AI response", and after a reload the Draft tab shows the last failed
  run with Retry.
- A NARRATIVE run still `RUNNING` and younger than 10 minutes makes a second draft answer 409 `DRAFT_RUNNING`; an older
  one is marked failed on the next read. The check is not atomic: two clicks in the same instant from two tabs can both
  run; slots are unique per project, so the later answer simply wins.
- Test answers: `tests/fixtures/ai/narrative.recorded.json` is one real answer of `narrative.v1` for the demo project.
  Its `inputHash` equals the hash of the facts the tests build, so it was drafted from exactly those facts; it passes every
  guardrail without a warning. `narrative.handwritten.json` and the tampered `narrative.tampered-asbestos-free.json` are
  written by hand for the rule tests.

## D-037 · The review checklist date is a calendar day (2026-10-19)

`ReviewChecklist.reviewedAt` (DateTime) became `reviewedOn`, a `YYYY-MM-DD` text like the project dates (D-013); migration
`narrative_draft` also adds `updatedAt`. Nothing wrote the table before, so no date is lost. The whole checklist is sent on
each save, and saving moves `Project.updatedAt` because the report states it.

## D-038 · Word template built from the master by a script (2026-10-19)

`scripts/build-template.ts` (`npm run template:build`) turns `fixtures/master_asbestos_report.docx` into
`templates/report_template.docx`, which is committed. Only `word/document.xml` changes; styles, fonts, numbering and
theme are copied byte for byte (a test checks this).

- Each placeholder is found by the exact text of its `<w:t>`; a missing or repeated one stops the build with its name
  (`Placeholder not found in master: [Material ID] [Floor] [Room] [Description]`). The build also fails if any
  `[bracketed]` text is left. Besides the placeholders it fills the master's fixed `2500.00` and `1200.00`, its two
  instruction paragraphs ("Use this structure…", "Repeat this record…"), the "Version 1" line and the "Contingency at 20
  percent" label. The title loses the word "model", which describes the master, not a report.
- Lists use docxtemplater's paragraphLoop: a placeholder paragraph becomes three copies of itself, `{#list}`, `{text}`,
  `{/list}`, so each item is its own paragraph with the master's formatting. The findings table with a new Heading2
  "Material zone M01 — …" repeats per zone; Lab evidence and Result detail have one paragraph per layer. Lists in
  Scope limitations and Assumptions and exclusions use the master's own ListBullet style.
- The cost table's first sample row is the loop row; the second ("[Unmeasured ID] Unknown Not priced …") is removed
  because unpriced lines come from the same loop and print Unknown / Not priced. Removal and replacement subtotals are
  copies of the "Measured zone subtotal" row.
- Appendices A–D (lab source references, sample register, employee corrections, review items) are new tables in the
  master's `LightShading-Accent1` table and cell markup, 9 pt because they have six columns, widths summing to the text
  width (8640 twips). An empty appendix prints one sentence instead of an empty table. `{#hasPlans}` holds a floor plan
  appendix for the mapping bonus; it is empty until plans exist.
- docxtemplater's default parser has no `a.b` paths (that needs `angular-expressions`), so `toTemplateData`
  (`src/domain/templateData.ts`) builds flat, finished text. Keys are unique per loop level because docxtemplater looks a
  missing key up in the outer levels; a test parses the template's tags and checks each one exists at its own level.
  `renderDocx` has a `nullGetter` that throws with the tag name, so "undefined" can never reach a report. A table cell
  must keep at least one paragraph, so every cell list has at least one entry ("No sample taken" …).

## D-039 · Report revisions: one snapshot, one hash, idempotent generation (2026-10-19)

- The snapshot is the canonical JSON (`src/domain/canonicalJson.ts`: keys sorted at every level, plain JSON only) of
  `{ model, templateSha256, rendererVersion }`. Its SHA-256 is the snapshot hash. The revision number and the generation
  time are printed but not hashed, so unchanged data gives the same hash.
- `templateSha256` makes a rebuilt template mark earlier revisions outdated. `REPORT_RENDERER_VERSION` does the same for
  a change of `toTemplateData` wording; a golden test records the output hash per version and fails until the version is
  raised.
- DOCX and PDF are rendered from the stored `snapshotJson` (parsed back), not from a second database read, so the files
  show exactly the hashed data. Files are written read-only into a temporary folder that is renamed to
  `storage/reports/<projectId>/rev-<n>/`; a failed step removes them and stores the revision as `FAILED` with the
  message. Downloads serve only `READY` revisions.
- `POST /api/projects/[id]/revisions` waits for the result (like D-036; conversion takes seconds). When the latest
  `READY` revision has the current hash it is returned and nothing is generated. A `GENERATING` revision younger than
  5 minutes answers 409 `GENERATION_RUNNING`; an older one was cut off by a restart and becomes `FAILED` on the next read.
  Retry is a new attempt with the next number; failed numbers stay in the history.
- `GET /api/projects/[id]/report-status` compares the current hash with the latest `READY` revision: `generating`, then
  `current`, then `failed` (last attempt failed after the latest ready one), then `outdated`, else `none`. The Preview
  tab dims an outdated PDF, disables the current downloads and offers the old files only as "Revision N (outdated)".

## D-040 · What blocks generation (2026-10-19)

- Open blocking review items (readiness `BLOCKED`, D-028): 409 `REPORT_BLOCKED`.
- A narrative `FORBIDDEN_CLAIM` (asbestos-free, compliance, clearance, safety; D-034): the report must never make such a
  claim, so it blocks generation although it only warns in the Draft. Other guardrail warnings do not block; the Preview
  tab shows their count.
- Empty narrative texts do not block. The report prints "Narrative not written yet." in their place and the Preview tab
  lists them, so a missing text is visible rather than silently left out.

## D-041 · `.gitignore` ignores only the root storage folder (2026-10-19)

The runtime-data rule was `storage/`, which also matched `src/server/storage/` and kept `src/server/storage/uploads.ts`
out of every commit since phase 3. It is now `/storage/`.

## D-042 · PDF conversion details (2026-10-19)

`convertDocxToPdf` posts the DOCX as the form field `files` to Gotenberg's `/forms/libreoffice/convert` with a 60 s
limit for the whole call, and checks the answer opens in pdf-lib. Connection refused reads "PDF converter is not running
— start it with docker compose up -d". The master's styles set Arial, which LibreOffice in Gotenberg
replaces with the metrically compatible Liberation Sans, so the PDF lays out close to Word but not pixel-identical. `npm test` uses a fake converter; the real
conversion test runs with `GOTENBERG_IT=1 npm test`.

## D-043 · `npm run verify` runs the app's own modules (2026-10-19)

- `scripts/verify-golden.ts` builds the ReportModel with `loadReportModel`, reads the revision files through
  `revisionService().getFile` and the PDF text with `extractPages`, so it checks what the app computes and serves, not
  a second implementation. Node's built-in TypeScript support does not resolve the `@/` alias or extensionless
  relative imports; `scripts/ts-hooks.mjs` adds a `node:module` resolve hook for files of this repository only. No new
  dependency (tsx or vite-node would need approval).
- The golden values are read from the table and the "Zone subtotal …" line of CLAUDE.md, so there is one copy. A
  section it cannot read stops the check with an error instead of passing.
- Files: every "total before tax" amount in the Word body and in the PDF text must be the same and equal the revision
  snapshot's total, which must equal the golden total; both files must print the revision number and the 12-character
  snapshot of that revision. An outdated latest revision is reported as a note, not a failure: the data check already
  covers the current state.

## D-044 · Dialog focus and destructive confirmations (2026-10-19)

- Most dialogs are opened from state without a `DialogTrigger`, so Radix returned focus to `<body>` when they closed
  and a keyboard user lost their place. `DialogContent` now remembers the element focused when it opened and returns
  focus to it, if it is still on the page.
- Confirmations of a destructive action (delete project, delete zone, reopen or remove an issue decision, extract again
  replacing reviewed rows) open with the footer's Close button focused (`focusCancel`), so pressing Enter twice does not
  delete.
- Reopening a decision and removing an auto-cleared one now ask first: both delete the employee's note, and cleared
  decisions are also printed in the report's decision log.
