import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { convertDocxToPdf, DOCX_MIME, PdfConversionError } from "@/server/report/gotenberg";

const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
let pdf: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage();
  pdf = await document.save();
});

const refused = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });

async function failure(fetchImpl: typeof fetch, timeoutMs?: number): Promise<PdfConversionError> {
  try {
    await convertDocxToPdf(docx, { baseUrl: "http://localhost:3001/", fetch: fetchImpl, timeoutMs });
  } catch (error) {
    if (error instanceof PdfConversionError) return error;
    throw error;
  }
  throw new Error("expected the conversion to fail");
}

describe("convertDocxToPdf", () => {
  it("posts the DOCX as the form field files to the LibreOffice route and returns the PDF", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(new Blob([new Uint8Array(pdf)]), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await convertDocxToPdf(docx, { baseUrl: "http://localhost:3001/", fetch: fetchImpl })).toEqual(pdf);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:3001/forms/libreoffice/convert");
    expect(calls[0].init.method).toBe("POST");
    const file = (calls[0].init.body as FormData).get("files") as File;
    expect([file.name, file.type, file.size]).toEqual(["report.docx", DOCX_MIME, docx.byteLength]);
  });

  it("says how to start the converter when it is not running", async () => {
    const error = await failure((async () => {
      throw refused();
    }) as unknown as typeof fetch);
    expect(error.code).toBe("CONVERTER_UNAVAILABLE");
    expect(error.message).toBe("PDF converter is not running — start it with docker compose up -d");
  });

  it("stops after the time limit", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const error = await failure(hanging, 20);
    expect(error.code).toBe("CONVERTER_TIMEOUT");
    expect(error.message).toMatch(/took longer than 0 s and was stopped/);
  });

  it("reports an HTTP error of the converter with its message", async () => {
    const error = await failure((async () => new Response("LibreOffice failed to convert", { status: 503 })) as unknown as typeof fetch);
    expect(error.code).toBe("CONVERTER_FAILED");
    expect(error.message).toMatch(/^PDF converter answered HTTP 503: LibreOffice failed to convert\./);
  });

  it("rejects an answer that is not a PDF", async () => {
    const error = await failure((async () => new Response("<html>proxy page</html>", { status: 200 })) as unknown as typeof fetch);
    expect(error.code).toBe("CONVERTER_INVALID_PDF");
  });
});
