"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { api, queryKeys } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";

export function ProjectList() {
  const { data, error, isPending, refetch } = useQuery({ queryKey: queryKeys.projects, queryFn: api.listProjects });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>Open a project to enter its building details and material zones.</CardDescription>
        <CardAction>
          <NewProjectDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading projects…
          </p>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive">Could not load the projects: {error.message}</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet. Create one to enter the field notes.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Building</TableHead>
                <TableHead className="text-right">Zones</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((project) => (
                <TableRow key={project.id} className="relative">
                  <TableCell className="font-medium">
                    {/* The link covers the whole row. */}
                    <Link href={`/projects/${project.id}`} className="after:absolute after:inset-0 hover:underline">
                      {project.code}
                    </Link>
                  </TableCell>
                  <TableCell>{project.client}</TableCell>
                  <TableCell>{project.building}</TableCell>
                  <TableCell className="text-right tabular-nums">{project.zoneCount}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(project.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
