"use client";

import { useRef, useState } from "react";
import { FileUpIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Same limit as the server (MAX_UPLOAD_BYTES); checked here only to skip a pointless upload. */
const MAX_BYTES = 10 * 1024 * 1024;

function precheck(files: File[]): File[] {
  return files.filter((file) => {
    if (file.type !== "application/pdf") {
      toast.error(`Not uploaded: ${file.name} is not a PDF. Only application/pdf files are accepted.`);
      return false;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`Not uploaded: ${file.name} is larger than 10 MB.`);
      return false;
    }
    return true;
  });
}

export function UploadDropzone({ uploading, onFiles }: { uploading: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (list: FileList | null) => {
    const files = precheck(Array.from(list ?? []));
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!uploading) accept(event.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <FileUpIcon className="size-6 text-muted-foreground" aria-hidden />
      <div className="text-sm">
        <p className="font-medium">Drop lab report PDFs here</p>
        <p className="text-muted-foreground">Several files at once, up to 10 MB each. Scanned PDFs without text are not supported.</p>
      </div>
      <Button variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
        {uploading ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
        {uploading ? "Uploading…" : "Choose PDF files"}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        multiple
        className="sr-only"
        aria-label="Lab report PDF files"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
