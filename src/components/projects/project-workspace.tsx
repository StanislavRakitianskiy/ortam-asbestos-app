"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabReportsTab, useLabDocuments } from "@/components/lab-reports/lab-reports-tab";
import { MaterialsTab } from "@/components/projects/materials-tab";
import { ProjectForm } from "@/components/projects/project-form";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/projects/unsaved-changes";
import { ReviewTab, pendingRowCount } from "@/components/review/review-tab";
import { ApiError, api, queryKeys } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";

const TABS = [
  { value: "project", label: "Project" },
  { value: "materials", label: "Materials" },
  { value: "lab-reports", label: "Lab reports" },
  { value: "review", label: "Review" },
  { value: "report", label: "Report" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

const isTab = (value: string | null): value is TabValue => TABS.some((tab) => tab.value === value);

const PLANNED: Record<Exclude<TabValue, "project" | "materials" | "lab-reports" | "review">, string> = {
  report: "Generate the report revision, preview its PDF and download the matching Word and PDF files.",
};

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  return (
    <UnsavedChangesProvider>
      <Workspace projectId={projectId} />
    </UnsavedChangesProvider>
  );
}

function BackLink() {
  const { confirmLeave } = useUnsavedChanges();
  return (
    <Button variant="ghost" size="sm" asChild className="w-fit">
      <Link href="/" onNavigate={confirmLeave}>
        <ArrowLeftIcon aria-hidden />
        All projects
      </Link>
    </Button>
  );
}

function Workspace({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const { dirty } = useUnsavedChanges();
  const requested = searchParams.get("tab");
  const tab: TabValue = isTab(requested) ? requested : "project";

  const { data, error, isPending, refetch } = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.getProject(projectId),
  });
  const labDocuments = useLabDocuments(projectId);

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
        Loading project…
      </p>
    );
  }

  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">
            {missing ? "This project does not exist. It may have been deleted." : `Could not load the project: ${error.message}`}
          </span>
          {missing ? null : (
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  const { project, zones } = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackLink />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{project.code}</h1>
          <p className="text-muted-foreground">
            {project.client} · {project.building}
          </p>
          <p className="text-xs text-muted-foreground">Last saved {formatDateTime(project.updatedAt)}</p>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          // Native history updates useSearchParams without a server round trip; a reload reopens this tab.
          window.history.replaceState(null, "", `?tab=${value}`);
        }}
      >
        <TabsList className="max-w-full overflow-x-auto">
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
              {item.value === "project" && dirty ? (
                <span className="size-1.5 rounded-full bg-amber-500" aria-label="(unsaved changes)" />
              ) : null}
              {item.value === "materials" ? (
                <span className="text-xs text-muted-foreground tabular-nums">{zones.length}</span>
              ) : null}
              {item.value === "lab-reports" && labDocuments.data ? (
                <span className="text-xs text-muted-foreground tabular-nums">{labDocuments.data.length}</span>
              ) : null}
              {item.value === "review" && pendingRowCount(labDocuments.data) > 0 ? (
                <span className="text-xs text-amber-700 tabular-nums dark:text-amber-300" aria-label={`(${pendingRowCount(labDocuments.data)} rows pending)`}>
                  {pendingRowCount(labDocuments.data)}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Kept mounted so unsaved edits survive switching tabs. */}
        <TabsContent value="project" forceMount className="pt-4 data-[state=inactive]:hidden">
          <ProjectForm project={project} />
        </TabsContent>
        <TabsContent value="materials" className="pt-4">
          <MaterialsTab projectId={project.id} zones={zones} />
        </TabsContent>
        <TabsContent value="lab-reports" className="pt-4">
          <LabReportsTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="review" className="pt-4">
          <ReviewTab projectId={project.id} />
        </TabsContent>
        {(Object.keys(PLANNED) as (keyof typeof PLANNED)[]).map((value) => (
          <TabsContent key={value} value={value} className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>{TABS.find((item) => item.value === value)?.label}: not built yet</CardTitle>
                <CardDescription>
                  Coming in a later phase. Nothing on this tab has been run or checked for this project.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Planned: {PLANNED[value]}</CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
