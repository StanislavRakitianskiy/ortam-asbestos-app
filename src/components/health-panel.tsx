"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthReport } from "@/server/services/health";

async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) throw new Error(`The status endpoint answered HTTP ${response.status}.`);
  return (await response.json()) as HealthReport;
}

type Row = { label: string; ok: boolean; okText: string; failText: string; message: string };

function toRows(report: HealthReport): Row[] {
  const { database, pdfConverter, anthropicKey } = report.checks;
  return [
    { label: "Database", ok: database.ok, okText: "OK", failText: "Not OK", message: database.message },
    {
      label: "PDF converter",
      ok: pdfConverter.ok,
      okText: "Reachable",
      failText: "Not reachable",
      message: pdfConverter.message,
    },
    {
      label: "Anthropic key",
      ok: anthropicKey.configured,
      okText: "Configured",
      failText: "Not configured",
      message: anthropicKey.message,
    },
  ];
}

function StatusBadge({ ok, okText, failText }: Pick<Row, "ok" | "okText" | "failText">) {
  return ok ? (
    <Badge className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
      <CircleCheckIcon aria-hidden />
      {okText}
    </Badge>
  ) : (
    <Badge variant="destructive">
      <CircleXIcon aria-hidden />
      {failText}
    </Badge>
  );
}

export function HealthPanel() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>All three should be green before you start a report.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCwIcon className={isFetching ? "animate-spin" : undefined} aria-hidden />
            Check again
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Checking…
          </p>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive">Could not load the status: {error.message}</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {data.configError ? (
              <pre
                role="alert"
                className="overflow-x-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs whitespace-pre-wrap text-destructive"
              >
                {data.configError}
              </pre>
            ) : null}
            <ul className="divide-y">
              {toRows(data).map((row) => (
                <li key={row.label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-36 shrink-0 font-medium">{row.label}</span>
                  <div className="flex flex-col gap-1">
                    <StatusBadge ok={row.ok} okText={row.okText} failText={row.failText} />
                    <span className="text-sm text-muted-foreground">{row.message}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
