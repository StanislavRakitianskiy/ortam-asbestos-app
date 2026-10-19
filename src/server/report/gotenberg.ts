import { PDFDocument } from "pdf-lib";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const CONVERSION_TIMEOUT_MS = 60_000;

export type PdfConversionErrorCode = "CONVERTER_UNAVAILABLE" | "CONVERTER_TIMEOUT" | "CONVERTER_FAILED" | "CONVERTER_INVALID_PDF";

/** The DOCX could not be converted. The message says what the employee can do about it. */
export class PdfConversionError extends Error {
  readonly code: PdfConversionErrorCode;

  constructor(message: string, code: PdfConversionErrorCode) {
    super(message);
    this.name = "PdfConversionError";
    this.code = code;
  }
}

export type ConvertOptions = {
  /** GOTENBERG_URL, e.g. http://localhost:3001. */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const isTimeout = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** The Node error code behind a failed fetch ("fetch failed" carries it in `cause`). */
function networkCode(error: unknown): string | null {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : null;
}

function unreachable(error: unknown, url: string): PdfConversionError {
  const code = networkCode(error);
  if (code === "ECONNREFUSED") return new PdfConversionError("PDF converter is not running — start it with docker compose up -d", "CONVERTER_UNAVAILABLE");
  return new PdfConversionError(
    `Cannot reach the PDF converter at ${url}${code === null ? "" : ` (${code})`}. Start it with docker compose up -d and check GOTENBERG_URL in .env.local.`,
    "CONVERTER_UNAVAILABLE",
  );
}

const timedOut = (timeoutMs: number) =>
  new PdfConversionError(
    `PDF conversion took longer than ${Math.round(timeoutMs / 1000)} s and was stopped. Retry; if it happens again, restart the converter with docker compose restart gotenberg.`,
    "CONVERTER_TIMEOUT",
  );

/** A PDF that pdf-lib can open and that has at least one page. Returns the page count. */
async function checkPdf(bytes: Uint8Array): Promise<number> {
  const invalid = new PdfConversionError("PDF converter returned a file that is not a valid PDF. Retry.", "CONVERTER_INVALID_PDF");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw invalid;
  try {
    const pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    if (pages < 1) throw invalid;
    return pages;
  } catch {
    throw invalid;
  }
}

/**
 * Converts a DOCX to PDF with Gotenberg's LibreOffice route (POST /forms/libreoffice/convert, the file in the form
 * field "files"). The whole call, including reading the answer, is limited to `timeoutMs`.
 */
export async function convertDocxToPdf(docx: Uint8Array, options: ConvertOptions): Promise<Uint8Array> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? CONVERSION_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/forms/libreoffice/convert`;
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(docx)], { type: DOCX_MIME }), "report.docx");

  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", body: form, signal, cache: "no-store" });
  } catch (error) {
    throw isTimeout(error) ? timedOut(timeoutMs) : unreachable(error, url);
  }

  let body: Uint8Array;
  try {
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 200);
      throw new PdfConversionError(
        `PDF converter answered HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}. Retry; if it happens again, check docker compose logs gotenberg.`,
        "CONVERTER_FAILED",
      );
    }
    body = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof PdfConversionError) throw error;
    throw isTimeout(error) ? timedOut(timeoutMs) : unreachable(error, url);
  }
  await checkPdf(body);
  return body;
}
