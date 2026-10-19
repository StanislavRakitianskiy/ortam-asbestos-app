"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon, MinusIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";

// Must be set in the module that renders <Document> (see the react-pdf README). Same pdfjs-dist version as the server.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Page width as a share of the viewer width; 1 fits the width. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const FIT = 2;

/**
 * Every page of a generated report PDF, exactly the file the PDF download serves. Browser only: loaded with
 * next/dynamic and ssr: false. Give it a `key` per file so a new revision starts from the first page.
 */
export default function ReportPdfViewer({ fileUrl }: { fileUrl: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState<number>(FIT);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Inner width without the padding of the scroll area.
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const zoom = ZOOMS[zoomIndex];
  const pageWidth = Math.max(200, Math.round(width * zoom));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant="outline" size="icon-sm" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}>
          <MinusIcon aria-hidden />
        </Button>
        <span className="w-24 text-center tabular-nums" aria-live="polite">
          {Math.round(zoom * 100)}% of width
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={zoomIndex === ZOOMS.length - 1}
          onClick={() => setZoomIndex((index) => Math.min(ZOOMS.length - 1, index + 1))}
        >
          <PlusIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" disabled={zoomIndex === FIT} onClick={() => setZoomIndex(FIT)}>
          Fit width
        </Button>
        {pageCount !== null ? (
          <span className="text-muted-foreground">
            {pageCount} page{pageCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div ref={scrollRef} className="max-h-[75vh] overflow-auto rounded-md border bg-muted p-4 [scrollbar-gutter:stable]">
        {loadError !== null ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Could not show the PDF: {loadError}
          </p>
        ) : width > 0 ? (
          <Document
            file={fileUrl}
            loading={<Loading text="Loading the PDF…" />}
            onLoadSuccess={(document) => setPageCount(document.numPages)}
            onLoadError={(error) => setLoadError(error.message)}
            onSourceError={(error) => setLoadError(error.message)}
            className="flex flex-col items-center gap-4"
          >
            {Array.from({ length: pageCount ?? 0 }, (_, index) => (
              <Page
                key={index + 1}
                pageNumber={index + 1}
                width={pageWidth}
                renderAnnotationLayer={false}
                className="bg-white shadow-sm"
                loading={<Loading text={`Rendering page ${index + 1}…`} />}
              />
            ))}
          </Document>
        ) : null}
      </div>
    </div>
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
