# Acceptance check

Phase 8 walk-through of `fixtures/START_HERE_candidate_brief.pdf`: the "Core completion checklist" (page 7) and the
"Case details to handle correctly" (page 6), item by item. Checked on 2026-10-19.

Status: **done** = implemented and checked; **partial** = works with a stated gap; **missing** = not implemented.

Where the checks ran:

- `npm run verify` and the file checks: the development database (`ORTAM-DEMO-001`, LAB-A/B/C accepted, revision 1).
- Failure, re-upload and keyboard checks: a scratch copy of the same database and storage on port 3002, so the demo
  data and its revision history were not changed. `.env.local` of the copy was edited per case and the server
  restarted.

## Automated checks

| Command | What it proves | Result |
|---|---|---|
| `npm test` | 420 tests: domain rules, services on a throwaway SQLite file, recorded and tampered AI answers, template build, DOCX render, verify-script logic | 419 passed, 1 skipped (the opt-in Gotenberg test) |
| `GOTENBERG_IT=1 npm test` | Real DOCX → PDF conversion through Gotenberg | passed |
| `npm run verify` | Golden zones and totals from the database, and the latest READY revision's Word and PDF print the same revision, snapshot and total (D-043) | PASS |
| `npm run typecheck`, `npm run lint` | Strict TypeScript, ESLint | clean |

`npm run verify` output on the development database:

```text
Zone  Status        Cat.  Cost (CAD)                      Expected                                          Check
M01   DETECTED      A     3,840.00                        DETECTED A 3,840.00                               ok
M02   DETECTED      A     7,200.00                        DETECTED A 7,200.00                               ok
M03   DETECTED      A     12,600.00                       DETECTED A 12,600.00                              ok
M04   NOT_DETECTED  D     no cost line                    NOT_DETECTED D no cost line                       ok
M05   DETECTED      B     Not priced (quantity unknown)   DETECTED B Not priced (quantity unknown)          ok
M06   INCONCLUSIVE  C     Not priced (unresolved)         INCONCLUSIVE C Not priced (unresolved)            ok
M07   INACCESSIBLE  C     Not priced (unresolved)         INACCESSIBLE C Not priced (unresolved)            ok

Removal subtotal 15,330.00 · Replacement subtotal 8,310.00 · Zone subtotal 23,640.00 · Direct subtotal 27,340.00
Contingency 5,468.00 · Total before tax 32,808.00 (all ok)

Latest READY revision 1 · snapshot 5230918aa1e2 · current
  Word total 32,808.00 (2 mentions) · PDF total 32,808.00 (2 mentions) · both print revision 1 and snapshot 5230918aa1e2
PASS: zones, totals and both report files match the golden expectations.
```

Negative check: in the scratch copy, M05's quantity was set to 10 m2. `npm run verify` then printed
"M05 … MISMATCH: cost 1,500.00, expected Not priced (quantity unknown)", six total mismatches (total 34,608.00 instead of
32,808.00), the latest revision as OUTDATED, and exited with code 1.

## Core completion checklist (brief page 7)

### C1 · Enter all field notes in a clear form, edit a material zone, save and reload — done

- **Where.** Project tab: `src/components/projects/project-form.tsx`. Materials tab: `materials-tab.tsx`,
  `zone-dialog.tsx`, `sample-id-input.tsx`. Validation shared by browser and API: `src/domain/projectInput.ts`.
  Persistence: `src/server/services/projectService.ts` (SQLite through Prisma).
- **How to verify.** New project → enter the header of `employee_field_notes.pdf` (code, client, building, address,
  inspection date, scope, planned work, jurisdiction note) → Save. Add M01–M07: "S03|S07" becomes two sample chips, M05
  and M07 use "Unknown (not measured)", M07 is "Accessible: No" with no sample. Edit a zone, reload the page: every
  value is back. Tests: `tests/server/projectService.test.ts`, `tests/domain/projectInput.test.ts`.
- **Phase 8.** A zone was entered with the keyboard only (fields in visual order, sample chips with Enter, selects and
  radios with arrow keys and Space, submit with Enter); see "UX" below.
- **Note.** Currency is fixed to CAD by the exercise rules and is not a form field.

### C2 · Ingest all three lab PDFs with a real AI model; keep sample IDs, layers, labels, percentages, file and page evidence — done

- **Where.** Lab reports tab: `lab-reports-tab.tsx`, `upload-dropzone.tsx`, `lab-document-card.tsx`. Server:
  `labDocumentService.ts` (SHA-256 storage, extraction after the response), `src/server/pdf/extractPages.ts` (pdfjs
  text per page), `src/server/ai/extractLabReport.ts`, `structuredCall.ts`, `prompts/labExtraction.v2.ts`,
  `labExtractionSchema.ts` (Zod), `verifyExtraction.ts` (quote must be on the cited page, values must match it). Each
  call is an `AiRun` with model, tokens, duration and raw answer.
- **How to verify.** Upload LAB-A, LAB-B and LAB-C. Each card ends with "Extracted by claude-… · tokens · s" and offers
  "View raw AI response". Review → Lab results lists every row with page, quoted line, result, type and percentage, and
  the Source panel highlights the quoted line on the PDF page. Database: 8 lab rows for ORTAM-DEMO-001, each with
  `sourcePage`, `sourceText` and the untouched AI row in `aiJson`. Tests: `tests/server/ai/extractLabReport.test.ts`
  (recorded real answers in `tests/fixtures/ai/lab-*.recorded.json`), `verifyExtraction.test.ts` (tampered answers:
  merged S02 layers, wrong page, invented quote), `tests/server/labDocumentService.test.ts`.

### C3 · Review and correct extracted fields; unknown IDs and contradictory results visible; missing quantities stay unknown — done

- **Where.** Review → Lab results: `document-review.tsx`, `source-panel.tsx`, `result-dialogs.tsx` (correct with a
  required reason, accept, reject, add a row by hand). `labReviewService.ts` keeps the AI value in `aiJson` and logs
  every change in `Correction`. Review → Matching: `matching-view.tsx`, `needs-attention.tsx`, `zone-table.tsx`, fed by
  `src/domain/matching.ts` (exact ID match only; unmatched, conflicting and duplicate IDs become issues) and
  `issueResolution.ts` (Resolve or Keep flagged, with a note). An unknown quantity is `null` and shows as "Unknown".
- **How to verify.** `npm run db:seed` creates `ORTAM-DEMO-001-EDGE`. Upload LAB-A, LAB-B, LAB-C and
  `fixtures/test/LAB-X_edge_cases.pdf` there: Matching shows sample "S7" as unmatched with the text hint "Similar ID in
  register: S07" (never linked) and S04 as a conflicting result. Correct S7 → S07 with a reason and the issue clears.
  Tests: `tests/domain/analysis.test.ts`, `tests/server/analysisService.test.ts`, `tests/server/labReviewService.test.ts`,
  `tests/domain/matching.test.ts`.

### C4 · Report follows the master, explains affected locations, grounded draft review actions, every unresolved limitation — done

- **Where.** `scripts/build-template.ts` turns `fixtures/master_asbestos_report.docx` into
  `templates/report_template.docx` (every bracketed placeholder mapped; a leftover fails the build).
  `src/domain/reportModel.ts` and `templateData.ts` hold every section; the narrative is drafted by
  `src/server/ai/draftNarrative.ts` (`prompts/narrative.v1.ts`) from the facts in `narrativeFacts.ts` and checked by
  `textGuards.ts`. Report → Draft: `draft-view.tsx`, `narrative-field.tsx`, `report-sections.tsx`.
- **How to verify.** Report → Draft: each zone shows floor and location, condition, sample IDs, every layer with its
  lab source (report ID, file, page, quote), the category reason and an editable recommendation. Scope limitations
  list M05 (quantity), M06 (inconclusive), M07 (inaccessible), M04 (sampled material only), hidden materials and any
  issue kept flagged. Tests: `tests/scripts/buildTemplate.test.ts`, `tests/domain/reportModel.test.ts`,
  `templateData.test.ts`, `textGuards.test.ts`, `tests/server/report/renderDocx.test.ts`,
  `tests/server/ai/draftNarrative.test.ts`.
- **Note.** The plan appendix belongs to the optional mapping bonus, which is not implemented; the report says "No
  floor plan is attached."

### C5 · Costs follow the rules; several samples in one zone are not charged twice; changing a quantity updates the amounts — done

- **Where.** `src/domain/rates.ts` (rate card), `costs.ts` (integer cents, half-up rounding, unit check), `analysis.ts`
  (computed on every read, D-027). Shown in Matching (cost panel) and in the report's cost scenario.
- **How to verify.** `npm run verify`. Edit M05's quantity: Matching and the Draft show new amounts at once and the
  Preview marks the revision outdated. Tests: `tests/domain/costs.test.ts` (golden totals, the brief's example
  700.00 / 4,400.00 / 880.00 / 5,280.00, M03 once, recalculation at 150 m2, unit mismatch), `analysisService.test.ts`.

### C6 · Preview works; Word and PDF downloads open and contain the same revision; a stale preview never looks current — done

- **Where.** `src/server/services/revisionService.ts` (snapshot hash, READY / FAILED, no regeneration of unchanged
  data, D-039), `src/server/report/renderDocx.ts`, `gotenberg.ts`, `snapshot.ts`; `GET /api/revisions/[id]/docx|pdf`.
  Report → Preview and downloads: `preview-view.tsx`, `report-pdf-viewer.tsx`.
- **How to verify.** Generate: the preview shows "revision N" and both buttons read "Download … (rev N)". Change any
  report fact: the badge turns "Outdated", both download buttons are disabled, the preview is dimmed under "Preview
  outdated — data changed after revision N", and the old files are offered only as "Revision N (outdated)".
  `npm run verify` checks that the Word and PDF files of the latest READY revision print the same revision, snapshot and
  total. Tests: `tests/server/revisionService.test.ts`, `gotenberg.integration.test.ts`.
- **Phase 8.** The revision 1 DOCX was read by pizzip, by LibreOffice (Gotenberg converted it) and by macOS `textutil`;
  the PDF by pdf.js. It was **not** opened in Microsoft Word in this phase: open `ORTAM-DEMO-001_rev1.docx` in Word once
  before submitting.

### C7 · Re-uploading the same PDF creates no duplicate findings or costs; AI or export failures show an understandable error and Retry — done

- **Where.** `LabDocument` is unique per project and SHA-256; `labDocumentService.upload` answers `duplicate` and the
  card says "… was already imported on …. No duplicate findings were created." Failures: `src/server/ai/aiErrors.ts`
  (readable message per cause, key redacted), `lab-document-card.tsx`, `draft-view.tsx` and `preview-view.tsx` (red
  alert with Retry); a FAILED revision keeps no files and its downloads answer 409.
- **Phase 8 results.** See "Failure states" and "Re-upload" below.

## Case details (brief page 6)

| Case | Where | How to verify | Status |
|---|---|---|---|
| **S02** floor sample: keep the not-detected tile and the detected adhesive; the zone is detected | `src/domain/matching.ts` (a detected layer makes the zone detected, every layer kept); `reportModel.ts` findings | Matching: M02 lists S02 with "Floor tile · Not detected" and "Black adhesive · Detected", zone Detected, category A. Report: both layers with their LAB-A page and quote. `matching.test.ts` "keeps both S02 layers…", `reportModel.test.ts`, `renderDocx.test.ts` | done |
| **S03 and S07**: keep both samples, charge M03's 140 m2 once | `costs.ts` prices the zone quantity, never per sample | `npm run verify`: M03 12,600.00 and one cost line. `costs.test.ts` "charges M03 once…", `analysis.test.ts` "never links S7 to M03…" | done |
| **S05**: detected, quantity missing; shown and marked Not priced | `costs.ts` (`MISSING_QUANTITY`), `reportModel.ts` | M05 is Detected, category B, "Not priced (quantity unknown)", listed under exclusions and limitations, quantity shown as "Unknown", never 0. `reportModel.test.ts` "shows M05 as detected but Not priced…" | done |
| **S06 and M07**: S06 inconclusive, M07 inaccessible and unsampled; both unresolved | `matching.ts` zone statuses INCONCLUSIVE and INACCESSIBLE; `categories.ts` category C; `costs.ts` UNRESOLVED | Both category C, "Not priced (unresolved)", in limitations and exclusions; neither is called negative. `reportModel.test.ts` "lists M06 and M07…", `costs.test.ts` | done |
| **S04** plaster: not detected only for the sampled plaster | `reportModel.ts` ("Not detected in the sampled material", limitation "not detected applies only to the sampled material (S04)"), standing disclaimers in `reportText.ts`; `textGuards.ts` | Report: M04 category D, no cost line, the scope sentence in its record and in the limitations. A narrative claiming the building is asbestos-free is flagged and blocks generation (D-040). `textGuards.test.ts`, `narrativeService.test.ts` "flags the changed answer that claims an asbestos-free building" | done |

## Phase 8 checks

### Failure states

Each case was run in the scratch copy and read from the page.

| Case | Lab extraction (Lab reports) | Narrative draft (Report → Draft) | Nothing looks finished |
|---|---|---|---|
| `ANTHROPIC_API_KEY` empty | Badge "Failed": "The AI extraction cannot run: ANTHROPIC_API_KEY is not set in .env.local. Add the key to .env.local and restart the server (npm run dev). No results from this file are used." + Retry | "The AI draft did not complete: The AI narrative draft cannot run: ANTHROPIC_API_KEY is not set … Nothing from this attempt was saved; the texts below are unchanged." + Retry | No rows; home page shows "Anthropic key: Not configured" |
| Invalid key (`sk-ant-…` shaped) | "The Anthropic API rejected the API key (HTTP 401). Check ANTHROPIC_API_KEY in .env.local and restart the server (npm run dev). No results from this file are used." + Retry | Same 401 text in the draft alert + Retry | The key value appears in no log line, database row or stored file |
| Gotenberg unreachable | — | — | Preview: "The report was not generated: PDF converter is not running — start it with docker compose up -d" + Retry. Revision 2 stored as Failed, "No files"; its downloads answer 409; the earlier revision stays "Revision 1 (outdated)" with the main download buttons disabled. Home page: "Cannot reach Gotenberg …". |

Retry was pressed in each case: without a key and with the invalid key it failed again with the same message; after
the real settings were restored, Retry produced revision 3 (READY, current). The unreachable converter was simulated
with `GOTENBERG_URL=http://localhost:3999`, which gives the same "connection refused" as a stopped container; the
shared container was not stopped.

### Re-upload

LAB-A, LAB-B and LAB-C uploaded again in one request to ORTAM-DEMO-001 (scratch copy, real key configured):

| | Before | After |
|---|---|---|
| Upload outcome | — | `duplicate` ×3, status stays ACCEPTED |
| LabDocument / LabResult | 3 / 8 | 3 / 8 |
| AiRun (all / extraction) | 9 / 6 | 9 / 6 |
| Cost lines / total before tax | 4 / 32,808.00 | 4 / 32,808.00 |
| Report state | current (rev 3, snapshot ccdc1fe5bd85) | current (same snapshot) |

### UX

Checked in the browser on an empty project and on the demo project:

- **Empty states.** Projects list, Materials, Lab reports, Review, Matching, cost scenario, appendices and the Preview
  already had one. Added: Findings and Recommendations in Report → Draft now say "No material zones yet. Add them on the
  Materials tab." instead of an empty section.
- **Loaders.** Every query shows a labelled spinner ("Loading project…", "Loading lab reports…", "Building the report
  draft…", "Checking the report revisions…", "Loading the PDF viewer…"); running steps show "Extracting results with
  AI…", "Drafting narrative…", "Generating…". Added: the extraction Retry button shows "Retrying…" while it is sent.
- **Delete confirmations.** Delete project and delete zone already asked; their text now says everything that goes
  (project: zones, lab reports with results and corrections, decisions, narrative, revisions; zone: sample IDs become
  unmatched, its narrative texts go). Added: Reopen of a decision and Remove of a cleared decision now ask first, quoting
  the note that will be deleted. Every destructive dialog opens with Close focused (D-044).
- **Badges.** Every status badge carries text as well as colour (lab report, review row, issue, zone status, category
  letter plus title, revision, report state, health). The evidence icon differs in shape (check / cross) and has a
  label. The "unsaved" dot and the pending-rows count on the tabs now have screen-reader text and a tooltip.
- **Keyboard.** Zone dialog: focus starts on Material ID, Tab follows the visual order and stays in the dialog; sample
  IDs are added with Enter without submitting; selects open with Enter and choose with arrows; radios with arrows and
  Space; Enter in a text field submits; Escape closes. Fixed: closing a dialog returned focus to `<body>`; it now
  returns to the button that opened it (D-044). Every visible form control on the Project, Materials, Lab reports,
  Review and Report tabs has an accessible name (automated check in the page).

### Coverage of `src/domain` (`npm test -- --coverage --coverage.include='src/domain/**'`)

| File | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| **All files** | **96.82** | **88.27** | **97.96** | **97.73** |
| analysis.ts | 97.56 | 90 | 100 | 100 |
| labRowIssues.ts | 96.87 | 92.59 | 100 | 100 |
| narrative.ts | 97.61 | 75 | 100 | 100 |
| reportModel.ts | 90.21 | 76.19 | 98.48 | 89.72 |
| templateData.ts | 89.56 | 66.66 | 88.88 | 95.78 |
| textGuards.ts | 99.03 | 91.05 | 100 | 99.4 |
| canonicalJson, categories, costs, format, issueResolution, labReview, labReviewInput, matching, narrativeFacts, projectInput, rates, reportText, reviewChecklist, sampleId, similarIds, types, zoneWarnings | 100 | 100 | 100 | 100 |

## Partial, missing and observations

Nothing in the core checklist or the case details is partial or missing. Outside them:

| Item | Status | Detail |
|---|---|---|
| Floor plan mapping bonus (brief page 8) | missing | Optional; not started. The report states that no floor plan is attached. |
| Submission: setup instructions with prerequisites | missing | There is no README yet. |
| Submission: handover note (time, AI tools, own checks, unfinished work, limitations) | missing | Not written yet. |
| Submission: demo recording or screenshots | missing | Not made yet. |
| Submission: one generated Word report and its matching PDF | partial | Revision 1 exists in `storage/reports/` (gitignored) and passes `npm run verify`; it is not yet copied out for submission or opened in Microsoft Word. |
| Jurisdiction note | observation | Entered and stored, but not printed in the report; the report prints the fixed "does not claim legal compliance …" disclaimer instead. |
| "Anthropic key: Configured" on the home page | observation | A format check only (D-007): an invalid key shows as configured until the first AI call fails with the 401 message. |
| Deleting a project | observation | Database rows go (cascade); its revision files stay in `storage/reports/<projectId>/`. Uploaded PDFs are shared by SHA-256 and stay by design. |
