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
