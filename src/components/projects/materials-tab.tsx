"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, TrashIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONDITION_LABELS } from "@/components/projects/labels";
import { ZoneDialog } from "@/components/projects/zone-dialog";
import { formatQuantity } from "@/domain/format";
import type { MaterialZone } from "@/domain/types";
import { zoneWarnings, type ZoneWarning } from "@/domain/zoneWarnings";
import { api, queryKeys } from "@/lib/api";

type Editing = { mode: "add" } | { mode: "edit"; zone: MaterialZone } | null;

export function MaterialsTab({ projectId, zones }: { projectId: string; zones: MaterialZone[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<MaterialZone | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material zones</CardTitle>
        <CardDescription>
          One row per measured material. The quantity belongs to the zone, however many samples it has.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setEditing({ mode: "add" })}>
            <PlusIcon aria-hidden />
            Add material zone
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No material zones yet. Add one for each material in the field notes.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Samples</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Disturbance</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Accessible</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone) => (
                <ZoneRow
                  key={zone.id}
                  zone={zone}
                  warnings={zoneWarnings(zone, zones)}
                  onEdit={() => setEditing({ mode: "edit", zone })}
                  onDelete={() => setDeleting(zone)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ZoneDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        projectId={projectId}
        zone={editing?.mode === "edit" ? editing.zone : undefined}
        zones={zones}
      />
      <DeleteZoneDialog projectId={projectId} zone={deleting} onClose={() => setDeleting(null)} />
    </Card>
  );
}

function ZoneRow({
  zone,
  warnings,
  onEdit,
  onDelete,
}: {
  zone: MaterialZone;
  warnings: ZoneWarning[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sampleWarnings = warnings.filter((warning) => warning.type === "SAMPLE_IN_OTHER_ZONE");
  const rateWarnings = warnings.filter((warning) => warning.type === "RATE_UNIT_MISMATCH" || warning.type === "UNKNOWN_RATE_REF");
  const flagged = new Set(sampleWarnings.map((warning) => warning.sampleId));

  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-normal">
        <div className="font-medium">{zone.materialId}</div>
        <div className="text-muted-foreground">{zone.description}</div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div>{zone.floor}</div>
        <div className="text-muted-foreground">{zone.location}</div>
      </TableCell>
      <TableCell className="whitespace-normal">
        {zone.sampleIds.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <div className="flex max-w-40 flex-wrap gap-1">
            {zone.sampleIds.map((sampleId) => (
              <span
                key={sampleId}
                className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                  flagged.has(sampleId) ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted"
                }`}
              >
                {sampleId}
              </span>
            ))}
          </div>
        )}
        <RowWarnings warnings={sampleWarnings} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {zone.quantity === null ? (
          <span className="text-muted-foreground" title="Not measured. Shown as Not priced if asbestos is detected.">
            Unknown <span className="text-xs">({zone.unit})</span>
          </span>
        ) : (
          formatQuantity(zone.quantity, zone.unit)
        )}
      </TableCell>
      <TableCell>{CONDITION_LABELS[zone.condition]}</TableCell>
      <TableCell>{zone.plannedDisturbance ? "Yes" : "No"}</TableCell>
      <TableCell className="whitespace-normal">
        {zone.rateRef ?? <span className="text-muted-foreground">Not assigned</span>}
        <RowWarnings warnings={rateWarnings} />
      </TableCell>
      <TableCell>{zone.accessible ? "Yes" : "No"}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit zone ${zone.materialId}`}>
            <PencilIcon aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete zone ${zone.materialId}`}>
            <TrashIcon aria-hidden />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function RowWarnings({ warnings }: { warnings: ZoneWarning[] }) {
  return warnings.map((warning) => (
    <p key={warning.message} className="mt-1 flex max-w-56 items-start gap-1 text-xs text-amber-800 dark:text-amber-300">
      <TriangleAlertIcon className="mt-px size-3 shrink-0" aria-hidden />
      <span>{warning.message}</span>
    </p>
  ));
}

function DeleteZoneDialog({
  projectId,
  zone,
  onClose,
}: {
  projectId: string;
  zone: MaterialZone | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (target: MaterialZone) => api.deleteZone(projectId, target.id),
    onSuccess: (_result, target) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(`Zone ${target.materialId} deleted.`);
      onClose();
    },
    onError: (error) => toast.error(`Not deleted. ${error.message}`),
  });

  return (
    <Dialog open={zone !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent focusCancel>
        {zone ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Delete zone {zone.materialId} ({zone.description})?
              </DialogTitle>
              <DialogDescription>
                {zone.sampleIds.length > 0
                  ? `Its sample IDs (${zone.sampleIds.join(", ")}) are removed from the register too; lab results with these IDs then show as unmatched. `
                  : ""}
                Its narrative texts in the report draft are deleted with it. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(zone)}>
                {remove.isPending ? "Deleting…" : "Delete zone"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
