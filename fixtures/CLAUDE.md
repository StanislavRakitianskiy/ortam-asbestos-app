# ORTAM Asbestos Report App — rules for Claude Code

## What this is
Employee-facing prototype. The employee enters a project and its material zones, uploads three lab PDFs,
AI extracts sample/layer results with evidence (file, page, quoted text), the employee reviews and corrects them,
the app matches results to zones by sample ID, applies exercise categories A–D, computes the fictional cost
scenario in code, drafts the report, exports DOCX (built from the supplied Word master) and PDF (via Gotenberg)
from ONE report revision, and previews that exact PDF.

Source of truth: fixtures/START_HERE_candidate_brief.pdf and fixtures/fictional_rates_and_rules.pdf.
If anything here conflicts with the brief, the brief wins.

## Stack
Next.js (App Router, route handlers) + TypeScript strict · Prisma + SQLite · Zod · @anthropic-ai/sdk
(model from ANTHROPIC_MODEL, default claude-sonnet-5-5, messages.parse + zodOutputFormat) · pdfjs-dist (server text)
· react-pdf (browser viewer) · docxtemplater + pizzip · pdf-lib · Gotenberg 8 in docker compose (http://localhost:3001)
· Vitest · Tailwind + shadcn/ui · TanStack Query. Ask before adding any other dependency.

## Commands
docker compose up -d · npm run setup · npm run dev · npm test · npm run typecheck · npm run lint
· npm run db:seed (dev-only demo data) · npm run template:build · npm run verify

## Layout
- src/domain/ — pure TypeScript, no I/O: types, rates, sampleId, matching, categories, costs, reportModel, textGuards, format. Fully unit-tested.
- src/server/ — env, db, storage, pdf, ai (prompts are versioned files), report (docx, gotenberg), services.
- src/app/ — pages and app/api route handlers. Handlers stay thin: Zod-validate input, call a service.
- src/components/ — UI.
- fixtures/ — supplied input files, read-only. fixtures/test/ — candidate-made test fixtures, clearly labelled.
- storage/ — runtime files (gitignored): uploads/, reports/, plans/.
- tests/ — Vitest. Recorded AI responses live in tests/fixtures/ai/.

## Domain rules (non-negotiable)
- All UI text, code, comments and report text are in English. Money is CAD, computed in integer cents, shown with 2 decimals.
- Quantity lives ONLY on the material zone. null means unknown. Never coerce unknown to 0.
  Several samples in one zone never multiply its quantity (M03 = 140 m2, charged once).
- Units exactly "m2" and "linear_m". Conditions exactly intact | damaged | poor | unknown. Planned disturbance is boolean.
- Lab result labels: DETECTED | NOT_DETECTED | INCONCLUSIVE. Keep every layer. Any detected layer makes the zone
  detected (S02: tile not detected + adhesive detected = zone detected, both layers kept).
- Inconclusive, unsampled, inaccessible or missing results stay unresolved. Never invent a negative.
- Match ONLY by exact sample ID within the project (trim + uppercase). No fuzzy matching, ever.
  Unknown, duplicate or conflicting IDs become review issues that the employee resolves or explicitly flags.
- Categories: A = detected AND (condition poor or damaged OR planned disturbance). B = other detected.
  C = inconclusive / inaccessible / unsampled / awaiting result / unresolved conflict. D = not detected in the
  sampled material (limited scope, no asbestos-specific cost).
- Costs are computed in code only, never by AI. Line = quantity x (removal rate + replacement rate), only for
  detected zones with a known quantity AND a rate whose unit equals the zone unit. Mobilization 2500.00 and
  professional assessment 1200.00 are added once per project when at least one zone is priced.
  Contingency = 20% of the direct subtotal. Total = direct + contingency, before tax.
  Missing quantity, no rate or unit mismatch => "Not priced" + listed as an exclusion.
- Fixed exclusions: taxes, unmeasured materials, unresolved materials, hidden materials, business interruption,
  engineering design, permit costs.
- The report never claims legal compliance, building-wide absence of asbestos, safety or clearance.
  "Not detected" applies only to the sampled material.
- AI is used for exactly two things: extracting lab PDFs and drafting narrative prose. AI never computes costs,
  never chooses categories, never applies thresholds, never writes numbers into the narrative. AI output is a draft.
- NEVER hardcode the supplied lab results in application code. They may appear only in tests and test fixtures.
- Uploaded source files are immutable. AI original values are stored separately from employee corrections;
  every correction is logged with a reason.
- Re-uploading the same PDF (same SHA-256 in the same project) never creates duplicate results or costs.
- A failed AI or export step shows an understandable error and a Retry action. It never looks completed.
- Preview and both downloads always come from one ReportRevision (same snapshot hash). Any edit after it marks
  the preview outdated; outdated files are never offered as current.
- Secrets live only in .env.local (gitignored). .env.example contains no secrets. Never log the API key.

## Golden expectations for the supplied demo data
| Zone | Status | Category | Cost |
|---|---|---|---|
| M01 | DETECTED | A | 3840.00 |
| M02 | DETECTED | A | 7200.00 |
| M03 | DETECTED | A | 12600.00 (S03 + S07, charged once) |
| M04 | NOT_DETECTED | D | no cost line |
| M05 | DETECTED | B | Not priced (quantity unknown) |
| M06 | INCONCLUSIVE | C | Not priced (unresolved) |
| M07 | INACCESSIBLE | C | Not priced (unresolved) |
Zone subtotal 23640.00 (removal 15330.00 + replacement 8310.00) · direct 27340.00 · contingency 5468.00 · total 32808.00 CAD.
Brief example: 10 m2 x (50 + 20) = 700.00 · direct 4400.00 · contingency 880.00 · total 5280.00.

## Working style
- Small typed modules, tests next to every domain rule. Run npm test and npm run typecheck before saying a task is done.
- For non-obvious choices add a short entry to docs/DECISIONS.md.
- Do not touch files in fixtures/. Do not commit storage/, prisma/dev.db or .env.local.
