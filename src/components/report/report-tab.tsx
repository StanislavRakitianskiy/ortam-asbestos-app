"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { DraftView } from "@/components/report/draft-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type View = "draft" | "preview";

/** The report: the editable draft now; the generated revision with its PDF preview and downloads in the next phase. */
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
        <Card>
          <CardHeader>
            <CardTitle>Preview and downloads: not built yet</CardTitle>
            <CardDescription>Coming in the next phase. No report revision has been generated for this project.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Planned: generate one report revision from this draft, preview its PDF and download the matching Word and PDF files.
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
