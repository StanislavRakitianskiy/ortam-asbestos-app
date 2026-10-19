"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { DraftView } from "@/components/report/draft-view";
import { PreviewView } from "@/components/report/preview-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type View = "draft" | "preview";

/** The report: the editable draft, and the generated revision with its PDF preview and downloads. */
export function ReportTab({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const [view, setViewState] = useState<View>(searchParams.get("view") === "preview" ? "preview" : "draft");

  const setView = (next: string) => {
    const value: View = next === "preview" ? "preview" : "draft";
    setViewState(value);
    // Kept in the URL so a reload reopens the same view.
    window.history.replaceState(null, "", `?tab=report&view=${value}`);
  };

  return (
    <Tabs value={view} onValueChange={setView}>
      <TabsList>
        <TabsTrigger value="draft">Draft</TabsTrigger>
        <TabsTrigger value="preview">Preview and downloads</TabsTrigger>
      </TabsList>
      <TabsContent value="draft" className="pt-4">
        <DraftView projectId={projectId} />
      </TabsContent>
      <TabsContent value="preview" className="pt-4">
        <PreviewView projectId={projectId} onOpenDraft={() => setView("draft")} />
      </TabsContent>
    </Tabs>
  );
}
