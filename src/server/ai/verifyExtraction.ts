import { layerKey } from "@/domain/matching";
import { normalizeSampleId } from "@/domain/sampleId";
import type { ResultLabel } from "@/domain/types";
import type { Confidence } from "@/server/dbEnums";
import type { PageText } from "@/server/pdf/extractPages";
import { findQuoteLines, normalizeEvidence } from "@/lib/pdfText";
import { LenientLabExtractionSchema, type ParsedLabExtraction, type ParsedLabResult } from "@/server/ai/labExtractionSchema";

/**
 * Deterministic checks of an AI extraction against the page text we extracted ourselves.
 * Nothing here changes a result label or applies a threshold: a failed check becomes a flag the employee sees.
 */

export const RESULT_FLAG_CODES = [
  "MISSING_VALUE",
  "PAGE_OUT_OF_RANGE",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_AMBIGUOUS",
  "SAMPLE_ID_NOT_IN_LINE",
  "LAYER_NOT_IN_LINE",
  "RESULT_NOT_IN_LINE",
  "LABEL_CONTRADICTS_LINE",
  "VALUE_NOT_IN_LINE",
  "PERCENTAGE_OUT_OF_RANGE",
  "DUPLICATE_SAMPLE_LAYER",
  "UNCITED_LINE_FOR_SAMPLE",
  "LAB_NOTE_NOT_FOUND",
] as const;
export const DOCUMENT_WARNING_CODES = [
  "NO_RESULTS",
  "LAB_REPORT_ID_MISSING",
  "PROJECT_REF_MISSING",
  "PROJECT_REF_MISMATCH",
  "LINE_NOT_EXTRACTED",
  "NOTE_NOT_FOUND",
] as const;

export type ResultFlagCode = (typeof RESULT_FLAG_CODES)[number];
export type DocumentWarningCode = (typeof DOCUMENT_WARNING_CODES)[number];
export type Flag<Code extends string = ResultFlagCode | DocumentWarningCode> = { code: Code; message: string };

/** The parsed extraction plus each result row exactly as the model returned it (for LabResult.aiJson). */
export type ParsedExtraction = ParsedLabExtraction & { rawResults: unknown[] };

export type ParseOutcome = { ok: true; value: ParsedExtraction } | { ok: false; issues: string[] };

const MAX_REPORTED_ISSUES = 8;

/** Check (a): the response has the expected shape. Enum values are compared ignoring case. */
export function parseExtraction(json: unknown): ParseOutcome {
  const result = LenientLabExtractionSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    const extra = issues.length - MAX_REPORTED_ISSUES;
    return {
      ok: false,
      issues: extra > 0 ? [...issues.slice(0, MAX_REPORTED_ISSUES), `and ${extra} more problem(s)`] : issues,
    };
  }
  const rawResults = (json as { results: unknown[] }).results;
  return { ok: true, value: { ...result.data, rawResults } };
}

export type VerifiedResult = {
  sampleId: string;
  layer: string;
  resultLabel: ResultLabel;
  asbestosType: string | null;
  /** null when the model's number was outside 0..100 (the original stays in aiJson). */
  percentage: number | null;
  percentageRaw: string | null;
  sourcePage: number;
  sourceText: string;
  labNote: string | null;
  /** The model's confidence, lowered to LOW when any check failed. */
  confidence: Confidence;
  evidenceVerified: boolean;
  flags: Flag<ResultFlagCode>[];
  /** The row exactly as the model returned it. */
  aiJson: string;
};

export type VerifiedNote = { page: number; text: string; relatedSampleIds: string[]; verified: boolean };

export type VerifiedExtraction = {
  report: ParsedLabExtraction["report"];
  results: VerifiedResult[];
  notes: VerifiedNote[];
  warnings: Flag<DocumentWarningCode>[];
};

export type VerifyContext = { pages: readonly PageText[]; projectCode: string };

export { normalizeEvidence };

const NOT_DETECTED = /\bnot detected\b/i;
const DETECTED = /(?<!\bnot )\bdetected\b/i;
const INCONCLUSIVE = /\binconclusive\b/i;
const RESULT_CELL = /^(not detected|detected|inconclusive)$/i;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function containsSampleId(line: string, sampleId: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(sampleId)}([^A-Z0-9]|$)`).test(line.toUpperCase());
}

function labelWords(line: string) {
  return { notDetected: NOT_DETECTED.test(line), detected: DETECTED.test(line), inconclusive: INCONCLUSIVE.test(line) };
}

const LABEL_TEXT: Record<ResultLabel, string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected",
  INCONCLUSIVE: "Inconclusive",
};

/** Check (d): the cited line names the sample, the layer and the printed result that the label claims. */
function checkLine(row: CheckedRow, line: string): Flag<ResultFlagCode>[] {
  const flags: Flag<ResultFlagCode>[] = [];
  const sampleId = normalizeSampleId(row.sampleId);
  if (sampleId !== "" && !containsSampleId(line, sampleId)) {
    flags.push({ code: "SAMPLE_ID_NOT_IN_LINE", message: `The cited line does not contain the sample ID ${sampleId}.` });
  }
  const layer = layerKey(normalizeEvidence(row.layer));
  if (layer !== "" && !layerKey(line).includes(layer)) {
    flags.push({ code: "LAYER_NOT_IN_LINE", message: `The cited line does not contain the layer "${row.layer.trim()}".` });
  }
  const words = labelWords(line);
  const present = { DETECTED: words.detected, NOT_DETECTED: words.notDetected, INCONCLUSIVE: words.inconclusive };
  if (!present[row.resultLabel]) {
    flags.push({ code: "RESULT_NOT_IN_LINE", message: `The cited line does not say "${LABEL_TEXT[row.resultLabel]}".` });
  }
  const others = (Object.keys(present) as ResultLabel[]).filter((label) => label !== row.resultLabel && present[label]);
  if (others.length > 0) {
    flags.push({
      code: "LABEL_CONTRADICTS_LINE",
      message: `The cited line says "${LABEL_TEXT[others[0]]}" but the extracted result is ${LABEL_TEXT[row.resultLabel]}.`,
    });
  }
  for (const [name, value] of [
    ["asbestos type", row.asbestosType],
    ["content", row.percentageRaw],
  ] as const) {
    const expected = value === null ? "" : normalizeEvidence(value).toLowerCase();
    if (expected !== "" && !line.toLowerCase().includes(expected)) {
      flags.push({ code: "VALUE_NOT_IN_LINE", message: `The cited line does not contain the ${name} "${value?.trim()}".` });
    }
  }
  return flags;
}

type CitedLine = { page: number; index: number };

const lineKey = (cited: CitedLine) => `${cited.page}:${cited.index}`;

/** Checks (b) and (c): the cited page exists and the quote is on exactly one line of it. */
function findEvidence(
  row: CheckedRow,
  pages: readonly PageText[],
): { cited: CitedLine | null; line: string | null; flags: Flag<ResultFlagCode>[] } {
  const page = pages.find((candidate) => candidate.page === row.sourcePage);
  if (page === undefined) {
    return {
      cited: null,
      line: null,
      flags: [{ code: "PAGE_OUT_OF_RANGE", message: `Page ${row.sourcePage} does not exist; the document has ${pages.length} page(s).` }],
    };
  }
  const quote = normalizeEvidence(row.sourceText);
  if (quote === "") return { cited: null, line: null, flags: [{ code: "MISSING_VALUE", message: "The quoted source text is empty." }] };

  const matches = findQuoteLines(page.lines, quote);
  if (matches.length === 1) {
    return { cited: { page: page.page, index: matches[0] }, line: normalizeEvidence(page.lines[matches[0]]), flags: [] };
  }
  if (matches.length > 1) {
    return {
      cited: null,
      line: null,
      flags: [{ code: "EVIDENCE_AMBIGUOUS", message: `The quoted text matches ${matches.length} lines on page ${page.page}; it does not identify one row.` }],
    };
  }
  const elsewhere = pages.find((other) => other.lines.some((text) => normalizeEvidence(text).includes(quote)));
  return {
    cited: null,
    line: null,
    flags: [
      {
        code: "EVIDENCE_NOT_FOUND",
        message: elsewhere
          ? `The quoted text is not on page ${page.page} (it is on page ${elsewhere.page}).`
          : `The quoted text was not found on any single line of page ${page.page}.`,
      },
    ],
  };
}

const resultKey = (row: Pick<CheckedRow, "sampleId" | "layer">) => `${normalizeSampleId(row.sampleId)}|${layerKey(row.layer)}`;

/** Lines that look like result rows: at least three table cells, one of which is exactly a printed result. */
function resultRowLines(pages: readonly PageText[]) {
  return pages.flatMap((page) =>
    page.lines.flatMap((text, index) => {
      const cells = text.split(/\s{2,}/).map((cell) => cell.trim());
      return cells.length >= 3 && cells.some((cell) => RESULT_CELL.test(cell))
        ? [{ page: page.page, index, text, firstCell: normalizeSampleId(cells[0]) }]
        : [];
    }),
  );
}

/** The values of a result row that are checked against the page text: an AI row, or the current values after review. */
export type CheckedRow = Pick<
  ParsedLabResult,
  "sampleId" | "layer" | "resultLabel" | "asbestosType" | "percentage" | "percentageRaw" | "sourcePage" | "sourceText" | "labNote"
>;

export type RowCheck = {
  flags: Flag<ResultFlagCode>[];
  evidenceVerified: boolean;
  /** null when the percentage was outside 0..100. */
  percentage: number | null;
};

export type RowsCheck = { rows: RowCheck[]; warnings: Flag<"LINE_NOT_EXTRACTED">[] };

/**
 * Checks (b)–(e), (g) and (h) of the result rows of one document against its page text. Used for the AI answer and
 * again for the current rows after every review change. Pure: same input, same output.
 */
export function checkResultRows(rows: readonly CheckedRow[], pages: readonly PageText[]): RowsCheck {
  const documentText = normalizeEvidence(pages.flatMap((page) => page.lines).join(" "));
  const warnings: Flag<"LINE_NOT_EXTRACTED">[] = [];

  const checked = rows.map((row) => {
    const flags: Flag<ResultFlagCode>[] = [];
    if (row.sampleId.trim() === "") flags.push({ code: "MISSING_VALUE", message: "The sample ID is empty." });
    if (row.layer.trim() === "") flags.push({ code: "MISSING_VALUE", message: "The layer is empty." });

    const evidence = findEvidence(row, pages);
    flags.push(...evidence.flags);
    if (evidence.line !== null) flags.push(...checkLine(row, evidence.line));

    let percentage = row.percentage;
    if (percentage !== null && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) {
      flags.push({ code: "PERCENTAGE_OUT_OF_RANGE", message: `The extracted content ${percentage}% is outside 0–100%; it was not stored.` });
      percentage = null;
    }
    if (row.labNote !== null && normalizeEvidence(row.labNote) !== "" && !documentText.includes(normalizeEvidence(row.labNote))) {
      flags.push({ code: "LAB_NOTE_NOT_FOUND", message: "The lab note is not printed in the document word for word." });
    }
    return { row, flags, percentage, cited: evidence.cited, evidenceVerified: evidence.line !== null };
  });

  // (g) the same sample and layer twice in one document.
  const counts = new Map<string, number>();
  for (const { row } of checked) counts.set(resultKey(row), (counts.get(resultKey(row)) ?? 0) + 1);
  for (const item of checked) {
    if ((counts.get(resultKey(item.row)) ?? 0) > 1) {
      item.flags.push({
        code: "DUPLICATE_SAMPLE_LAYER",
        message: `${normalizeSampleId(item.row.sampleId)} "${item.row.layer.trim()}" was extracted more than once from this document.`,
      });
    }
  }

  // (h) every printed result row must be cited by a result, otherwise a layer was merged or skipped.
  const citedLines = new Set(checked.flatMap((item) => (item.cited ? [lineKey(item.cited)] : [])));
  for (const line of resultRowLines(pages)) {
    if (citedLines.has(lineKey(line))) continue;
    warnings.push({
      code: "LINE_NOT_EXTRACTED",
      message: `Page ${line.page}: the result line "${normalizeEvidence(line.text)}" is not cited by any extracted result. A layer may have been merged or skipped.`,
    });
    for (const item of checked) {
      if (normalizeSampleId(item.row.sampleId) === line.firstCell) {
        item.flags.push({
          code: "UNCITED_LINE_FOR_SAMPLE",
          message: `Another result line for ${line.firstCell} on page ${line.page} is not covered by any extracted result.`,
        });
      }
    }
  }

  return {
    rows: checked.map(({ flags, evidenceVerified, percentage }) => ({ flags, evidenceVerified, percentage })),
    warnings,
  };
}

/** Checks (b)–(h) for a parsed extraction. Pure: same input, same output. */
export function verifyExtraction(extraction: ParsedExtraction, context: VerifyContext): VerifiedExtraction {
  const { pages } = context;
  const checked = checkResultRows(extraction.results, pages);
  const warnings: Flag<DocumentWarningCode>[] = [...checked.warnings];

  // (f) the report should belong to this project.
  const projectRef = extraction.report.projectRef?.trim() ?? "";
  if (projectRef === "") {
    warnings.push({ code: "PROJECT_REF_MISSING", message: "The lab report does not state a project reference." });
  } else if (normalizeSampleId(projectRef) !== normalizeSampleId(context.projectCode)) {
    warnings.push({
      code: "PROJECT_REF_MISMATCH",
      message: `The lab report is for project "${projectRef}", but this project is "${context.projectCode}".`,
    });
  }
  if (extraction.results.length === 0) warnings.push({ code: "NO_RESULTS", message: "No result rows were extracted from this document." });
  if ((extraction.report.labReportId?.trim() ?? "") === "") {
    warnings.push({
      code: "LAB_REPORT_ID_MISSING",
      message:
        "No lab report ID was extracted. Check the report header and enter the ID on the Review tab; until then results from this file are identified by its file name.",
    });
  }

  const notes = extraction.documentNotes.map((note): VerifiedNote => {
    const page = pages.find((candidate) => candidate.page === note.page);
    const text = normalizeEvidence(note.text);
    const verified = page !== undefined && text !== "" && normalizeEvidence(page.lines.join(" ")).includes(text);
    if (!verified) warnings.push({ code: "NOTE_NOT_FOUND", message: `A lab note was not found word for word on page ${note.page}: "${note.text.trim()}"` });
    return { page: note.page, text: note.text, relatedSampleIds: note.relatedSampleIds, verified };
  });

  return {
    report: extraction.report,
    results: extraction.results.map((row, index) => {
      const { flags, percentage, evidenceVerified } = checked.rows[index];
      return {
        sampleId: row.sampleId.trim(),
        layer: row.layer.trim(),
        resultLabel: row.resultLabel,
        asbestosType: row.asbestosType,
        percentage,
        percentageRaw: row.percentageRaw,
        sourcePage: row.sourcePage,
        sourceText: row.sourceText,
        labNote: row.labNote,
        confidence: flags.length > 0 ? "LOW" : row.confidence,
        evidenceVerified,
        flags,
        aiJson: JSON.stringify(extraction.rawResults[index] ?? row),
      };
    }),
    notes,
    warnings,
  };
}
