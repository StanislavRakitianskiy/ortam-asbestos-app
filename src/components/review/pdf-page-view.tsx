"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { Document, Page, pdfjs, type PageProps } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { quoteHighlights, type LineItem } from "@/lib/pdfText";

// Must be set in the module that renders <Document> (see the react-pdf README). Same pdfjs-dist version as the server.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type TextRenderer = NonNullable<PageProps["customTextRenderer"]>;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const mark = (text: string) => `<mark class="evidence-mark">${escapeHtml(text)}</mark>`;

/** Marked content entries carry no text; a blank item keeps the indexes in step with react-pdf's itemIndex. */
const BLANK_ITEM: LineItem = { str: "", transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0 };

/**
 * One PDF page with the quoted evidence marked in the text layer. Lines are rebuilt from the page's text items exactly
 * as the server builds them for verification, so "found" here means the same as "evidence verified" there.
 * Browser only: loaded with next/dynamic and ssr: false.
 */
export default function PdfPageView({
  fileUrl,
  pageNumber,
  quote,
  width,
  onQuoteMatch,
  onRendered,
}: {
  fileUrl: string;
  pageNumber: number;
  quote: string;
  width: number;
  /** How many lines of the page contain the quote; null until the page text is read. */
  onQuoteMatch: (count: number | null) => void;
  /** After the text layer is drawn, e.g. to scroll the first mark into view. */
  onRendered: () => void;
}) {
  const [text, setText] = useState<{ page: number; items: LineItem[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Text of the page on screen only: a row on another page must not be checked against the previous page.
  const items = text?.page === pageNumber ? text.items : null;

  const highlights = useMemo(() => (items === null ? null : quoteHighlights(items, quote)), [items, quote]);

  useEffect(() => {
    onQuoteMatch(highlights?.matchCount ?? null);
  }, [highlights, onQuoteMatch]);

  const renderText = useCallback<TextRenderer>(
    ({ str, itemIndex }) => {
      const highlight = highlights?.items.get(itemIndex);
      if (!highlight) return escapeHtml(str);
      if (highlight.whole) return mark(str);
      return escapeHtml(str.slice(0, highlight.start)) + mark(str.slice(highlight.start, highlight.end)) + escapeHtml(str.slice(highlight.end));
    },
    [highlights],
  );

  if (loadError !== null) {
    return (
      <p role="alert" className="flex items-start gap-2 p-3 text-sm text-destructive">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Could not show the PDF: {loadError}
      </p>
    );
  }

  return (
    <Document
      file={fileUrl}
      loading={<Loading text="Loading the PDF…" />}
      onLoadError={(error) => setLoadError(error.message)}
      onSourceError={(error) => setLoadError(error.message)}
    >
      <Page
        key={pageNumber}
        pageNumber={pageNumber}
        width={width}
        renderAnnotationLayer={false}
        loading={<Loading text={`Rendering page ${pageNumber}…`} />}
        customTextRenderer={renderText}
        onGetTextSuccess={(content) =>
          setText({ page: pageNumber, items: content.items.map((item) => ("str" in item ? item : BLANK_ITEM)) })
        }
        onRenderTextLayerSuccess={onRendered}
        onLoadError={(error) => setLoadError(error.message)}
      />
    </Document>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
      {text}
    </p>
  );
}
