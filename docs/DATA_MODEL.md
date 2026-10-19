# Data model

SQLite through Prisma 6 (`prisma/schema.prisma`; migrations `init`, `lab_extraction`, `issue_resolution_snapshot` and `narrative_draft`). SQLite has no enums, so every status column is
a plain `String` and every JSON column is `String`. Their allowed values live in code and are checked with Zod at the
service boundary:

- zone `unit` and `condition`: `unitSchema`, `conditionSchema` in `src/domain/types.ts`
- all other status columns: `src/server/dbEnums.ts`
- form and API input: `src/domain/projectInput.ts`

Every table except `Project` belongs to one project and is deleted with it (`onDelete: Cascade`).
IDs are `cuid()` strings. "Optional" (`?`) columns are `NULL` when absent.

## Project

| Column | Type | Notes |
|---|---|---|
| id | String | |
| code | String, unique | e.g. `ORTAM-DEMO-001` |
| client, building | String | required on create |
| address | String | default `""` |
| inspectionDate, reportDate | String? | calendar date `YYYY-MM-DD`; text, so no time zone can shift the day. Report date must not be before the inspection date. |
| preparedBy | String | default `""` |
| reviewedBy | String? | `NULL` = review pending |
| scope, plannedWork, limitations, jurisdictionNote | String | default `""` |
| currency | String | always `CAD` |
| createdAt, updatedAt | DateTime | `updatedAt` also moves on every zone add, edit or delete |

## MaterialZone

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| materialId | String | uppercased, unique per project (`@@unique([projectId, materialId])`) |
| description, floor, location | String | required |
| quantity | Float? | `NULL` = unknown, never stored as 0; > 0 with at most 2 decimals |
| unit | String | `m2` \| `linear_m` |
| condition | String | `intact` \| `damaged` \| `poor` \| `unknown` |
| plannedDisturbance | Boolean | |
| rateRef | String? | key of the rate card (`R_PIPE`, `R_FLOOR`, `R_CEILING`, `R_PANEL`); `NULL` = not assigned. A unit mismatch is allowed and reported for review, never priced. |
| accessible | Boolean | default `true` |
| notes | String | default `""` |
| sortOrder | Int | register order |

Quantity lives only here. Several samples in one zone never multiply it.

## ZoneSample

| Column | Type | Notes |
|---|---|---|
| id, zoneId | String | |
| sampleId | String | normalized: trim + uppercase. Unique per zone (`@@unique([zoneId, sampleId])`). |
| sortOrder | Int | order the employee entered (S03 before S07) |

The same sample ID may appear in two zones of a project; matching reports that as a blocking review issue instead of
the database refusing it, so the employee can see and fix it.

## LabDocument

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| fileName | String | original upload name (base name only) |
| sha256 | String | `@@unique([projectId, sha256])`: re-uploading the same PDF returns this row, no new results, no AI call |
| storagePath | String | `uploads/<sha256>.pdf` relative to `STORAGE_DIR`; read-only, shared by projects with the same file (D-020) |
| sizeBytes | Int | |
| pageCount | Int | |
| pagesTextJson | String | JSON `[{ page, lines: string[] }]`, page 1-based; table cells separated by two spaces |
| labReportId, labName, projectRef, issuedDate | String? | report header as printed, from the latest successful extraction; `labReportId` may be entered by the employee instead, and then a new extraction keeps it |
| documentNotesJson | String | JSON `[{ page, text, relatedSampleIds, verified }]`, default `[]` |
| warningsJson | String | JSON `[{ code, message }]` document-level verification warnings, default `[]` |
| status | String | `UPLOADED` → `EXTRACTING` → `NEEDS_REVIEW` → `ACCEPTED` (every row accepted or rejected; back to `NEEDS_REVIEW` when a row is pending again), or `FAILED` |
| error | String? | readable failure reason, only while `FAILED` |
| errorCode | String? | `NO_TEXT` (no Retry) or an AI error code from `src/server/ai/aiErrors.ts` |
| extractionStartedAt | DateTime? | set while `EXTRACTING`; after 10 minutes the run counts as interrupted (D-019) |
| createdAt, updatedAt | DateTime | |

## AiRun

One row per model call, successful or not.

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| labDocumentId | String? | set for extraction runs; `SET NULL` if the document goes |
| kind | String | `EXTRACTION` \| `NARRATIVE` |
| model | String | the model that answered (`response.model`; a fallback model if the requested one declined) |
| responseId | String? | API message ID |
| inputTokens, outputTokens | Int? | |
| durationMs | Int | |
| status | String | `RUNNING` \| `SUCCEEDED` \| `FAILED` |
| error | String? | readable reason, API keys redacted |
| stopReason | String? | API `stop_reason`, e.g. `end_turn`, `max_tokens`, `refusal` |
| promptVersion | String | versioned prompt file name, e.g. `labExtraction.v2` |
| rawResponse | String? | the whole API message as received (JSON); `NULL` when no answer arrived |
| inputHash | String? | NARRATIVE runs: SHA-256 of the facts the AI was given (`narrativeFacts`); a different current hash means the draft is outdated (D-035). `NULL` for extraction runs |
| createdAt | DateTime | |

## LabResult

One sample layer from a lab report. AI values and employee corrections are kept apart.

| Column | Type | Notes |
|---|---|---|
| id, labDocumentId | String | |
| aiRunId | String? | run that produced it |
| origin | String | `AI` \| `MANUAL` |
| aiJson | String? | the row exactly as the AI returned it; written once, never updated. `NULL` for `MANUAL`. |
| sampleId | String | as printed; normalized only when matching |
| layer | String | |
| resultLabel | String | `DETECTED` \| `NOT_DETECTED` \| `INCONCLUSIVE` |
| asbestosType | String? | |
| percentage | Float? | 0–100 |
| percentageRaw | String? | as printed, e.g. `15%`, `Not reported` |
| sourcePage | Int | 1-based page in the PDF |
| sourceText | String | quoted supporting text |
| labNote | String? | |
| confidence | String? | `HIGH` \| `MEDIUM` \| `LOW` from the AI, lowered to `LOW` when a verification check failed; `NULL` for `MANUAL` |
| evidenceVerified | Boolean | quote found on exactly one line of the cited page; re-checked after every review change |
| verificationJson | String | JSON `[{ code, message }]` flags from `verifyExtraction`, recomputed on the current values after every review change (D-025), default `[]` |
| reviewStatus | String | `PENDING` \| `ACCEPTED` \| `REJECTED` (values in `src/domain/labReview.ts`) |
| rejectReason | String? | required when rejecting; cleared on accept or reopen |
| createdAt, updatedAt | DateTime | |

The current columns are the employee-reviewed values; `aiJson` is the untouched original. Every change to a current
value writes a `Correction`. Re-extraction replaces a document's untouched `AI` drafts in one transaction; accepted or
corrected rows and `MANUAL` rows are kept (D-023). Only `ACCEPTED` rows of `ACCEPTED` documents are used for matching and
the report (D-024).

## Correction

Audit log of employee edits.

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| entity, entityId | String | `LabResult` or `LabDocument`, and its id |
| field | String | for `LabResult`: an editable field (`sampleId`, `layer`, `resultLabel`, `asbestosType`, `percentage`, `labNote`), or `row` for a row added by hand; for `LabDocument`: `labReportId` |
| oldValue, newValue | String? | JSON-encoded, `NULL` when the value is absent; for `row` the new value is the added row |
| reason | String | required |
| createdAt | DateTime | |

## ReviewIssueResolution

The employee's decision on one blocking review issue (D-028). Warnings take no decision.

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| issueKey | String | stable key from `src/domain/matching.ts`, e.g. `UNMATCHED_LAB_SAMPLE:S7`; `@@unique([projectId, issueKey])` |
| issueType, issueMessage | String | snapshot of the issue when decided, so an auto-cleared decision can still be shown |
| refsKey | String | sorted zones, samples, lab rows and documents the issue was about (`refsKey()` in `src/domain/issueResolution.ts`); when the current issue refers to other evidence, the decision no longer applies |
| decision | String | `RESOLVED` \| `FLAGGED` |
| note | String | required; a `FLAGGED` note goes to the report's scope limitations |
| createdAt, updatedAt | DateTime | `updatedAt` is shown as the decision time |

Nothing derived from matching is stored: zone status, category, cost lines and issues are recomputed on every read
(D-027). A decision whose issue no longer exists is kept and listed as auto-cleared until the employee removes it.

## ReportNarrative

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| section | String | `executiveSummary`, `zoneInterpretation`, `zoneReason`, `zoneUncertainty`, `zoneFollowUp`, `recommendation`, `limitations` (`src/domain/narrative.ts`) |
| itemKey | String | the zone ID for the zone sections and `recommendation`; `""` for section-level text. Not nullable because SQLite treats NULLs as distinct in a unique index. `@@unique([projectId, section, itemKey])` |
| aiText | String? | the latest AI draft as generated; `NULL` when the employee wrote the text without one |
| text | String | current text; a new AI draft replaces it only while `source` is `AI_DRAFT` (D-035) |
| source | String | `AI_DRAFT` \| `EDITED` |
| updatedAt | DateTime | |

Narrative edits are not logged as `Correction` rows: `aiText` keeps the AI original. Deleting a zone deletes its slots.

## ReviewChecklist

One row per project (`projectId` is the primary key).

| Column | Type |
|---|---|
| samplesChecked, layersChecked, quantitiesChecked, costsChecked, narrativeChecked | Boolean, default `false` |
| reviewerName | String? |
| reviewedOn | String? (calendar date `YYYY-MM-DD`, D-037) |
| updatedAt | DateTime |

The report status stays "Draft pending human and professional review" whatever is checked.

## ReportRevision

| Column | Type | Notes |
|---|---|---|
| id, projectId | String | |
| number | Int | `@@unique([projectId, number])` |
| snapshotJson | String | canonical JSON of everything the report shows |
| snapshotHash | String | SHA-256 of `snapshotJson`; preview, DOCX and PDF must share it |
| status | String | `GENERATING` \| `READY` \| `FAILED` |
| error | String? | |
| docxPath, pdfPath | String? | files under `storage/reports/` |
| createdAt | DateTime | |

## Deviations from the phase 2 brief

- `ZoneSample.sortOrder` added so S03|S07 keeps the order the employee typed.
- `LabResult.aiJson` and `LabResult.confidence` are nullable because `MANUAL` rows have no AI original.
- `LabResult.createdAt` added for stable ordering.
- `ReportNarrative.itemKey` is `String @default("")` instead of `String?` so the unique index works in SQLite.
- `MaterialZone` has `@@unique([projectId, materialId])`.
- Phase 3 (`lab_extraction` migration): `LabDocument` gained `sizeBytes`, the report header columns, `documentNotesJson`,
  `warningsJson`, `errorCode`, `extractionStartedAt` and `updatedAt`, and its status `EXTRACTED` became `NEEDS_REVIEW`
  plus `ACCEPTED`; `pagesTextJson` holds lines per page. `AiRun.stopReason` and `LabResult.verificationJson` were added.
- Phase 5 (`issue_resolution_snapshot` migration): `ReviewIssueResolution` gained `issueType`, `issueMessage` and
  `refsKey`.
- Phase 6 (`narrative_draft` migration): `AiRun.inputHash` added; `ReviewChecklist.reviewedAt` (DateTime) replaced by
  `reviewedOn` (`YYYY-MM-DD` text) and `updatedAt` added.
