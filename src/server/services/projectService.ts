import { Prisma, type PrismaClient, type Project as ProjectRow } from "@prisma/client";
import type { ProjectCreate, ProjectUpdate, ZoneCreate, ZoneUpdate } from "@/domain/projectInput";
import { materialZoneSchema, type MaterialZone } from "@/domain/types";
import { getDb } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";

export type ProjectSummary = {
  id: string;
  code: string;
  client: string;
  building: string;
  zoneCount: number;
  updatedAt: string;
};

export type ProjectDto = {
  id: string;
  code: string;
  client: string;
  building: string;
  address: string;
  inspectionDate: string | null;
  reportDate: string | null;
  preparedBy: string;
  /** null while the review is pending. */
  reviewedBy: string | null;
  scope: string;
  plannedWork: string;
  limitations: string;
  jurisdictionNote: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = { project: ProjectDto; zones: MaterialZone[] };

type Tx = Prisma.TransactionClient;
type ZoneRow = Prisma.MaterialZoneGetPayload<{ include: { samples: true } }>;

const withSamples = { samples: { orderBy: { sortOrder: "asc" } } } satisfies Prisma.MaterialZoneInclude;

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    code: row.code,
    client: row.client,
    building: row.building,
    address: row.address,
    inspectionDate: row.inspectionDate,
    reportDate: row.reportDate,
    preparedBy: row.preparedBy,
    reviewedBy: row.reviewedBy,
    scope: row.scope,
    plannedWork: row.plannedWork,
    limitations: row.limitations,
    jurisdictionNote: row.jurisdictionNote,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Stored unit and condition are plain strings; the domain schema rejects anything outside the allowed values. */
function toZone(row: ZoneRow): MaterialZone {
  return materialZoneSchema.parse({
    id: row.id,
    materialId: row.materialId,
    description: row.description,
    floor: row.floor,
    location: row.location,
    sampleIds: row.samples.map((sample) => sample.sampleId),
    quantity: row.quantity,
    unit: row.unit,
    condition: row.condition,
    plannedDisturbance: row.plannedDisturbance,
    rateRef: row.rateRef,
    accessible: row.accessible,
    notes: row.notes,
  });
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** ISO dates compare correctly as text. */
function checkDateOrder(inspectionDate: string | null, reportDate: string | null) {
  if (inspectionDate !== null && reportDate !== null && reportDate < inspectionDate) {
    throw ValidationError.field("reportDate", "must be on or after the inspection date");
  }
}

export async function findProjectOrThrow(tx: Tx, projectId: string): Promise<ProjectRow> {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (project === null) throw new NotFoundError("This project does not exist. It may have been deleted.");
  return project;
}

/** The project's material zones in register order. */
export async function findZones(tx: Tx, projectId: string): Promise<MaterialZone[]> {
  const zones = await tx.materialZone.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, include: withSamples });
  return zones.map(toZone);
}

async function findZoneOrThrow(tx: Tx, projectId: string, zoneId: string) {
  const zone = await tx.materialZone.findFirst({ where: { id: zoneId, projectId } });
  if (zone === null) throw new NotFoundError("This material zone does not exist in the project. It may have been deleted.");
  return zone;
}

/** Every change to a project or its zones moves Project.updatedAt. */
async function touchProject(tx: Tx, projectId: string) {
  await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
}

const sampleRows = (sampleIds: readonly string[]) => sampleIds.map((sampleId, sortOrder) => ({ sampleId, sortOrder }));

const duplicateMaterialId = (materialId: string | undefined) =>
  ValidationError.field("materialId", `${materialId ?? "This material ID"} is already used by another zone in this project`);

/**
 * Projects and their material zones. Inputs are already validated by the zod schemas in src/domain/projectInput.ts;
 * this layer enforces what needs the database: existence, uniqueness and date order.
 */
export function projectService(db: PrismaClient = getDb()) {
  return {
    async list(): Promise<ProjectSummary[]> {
      const rows = await db.project.findMany({
        orderBy: { updatedAt: "desc" },
        select: { id: true, code: true, client: true, building: true, updatedAt: true, _count: { select: { zones: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        client: row.client,
        building: row.building,
        zoneCount: row._count.zones,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },

    async create(input: ProjectCreate): Promise<ProjectDto> {
      checkDateOrder(input.inspectionDate ?? null, input.reportDate ?? null);
      try {
        return toProjectDto(await db.project.create({ data: input }));
      } catch (error) {
        if (isUniqueViolation(error)) throw ValidationError.field("code", `${input.code} is already used by another project`);
        throw error;
      }
    },

    async get(projectId: string): Promise<ProjectDetail> {
      const project = await findProjectOrThrow(db, projectId);
      return { project: toProjectDto(project), zones: await findZones(db, projectId) };
    },

    async update(projectId: string, patch: ProjectUpdate): Promise<ProjectDto> {
      const current = await findProjectOrThrow(db, projectId);
      checkDateOrder(
        patch.inspectionDate === undefined ? current.inspectionDate : patch.inspectionDate,
        patch.reportDate === undefined ? current.reportDate : patch.reportDate,
      );
      try {
        return toProjectDto(await db.project.update({ where: { id: projectId }, data: patch }));
      } catch (error) {
        if (isUniqueViolation(error)) throw ValidationError.field("code", `${patch.code} is already used by another project`);
        throw error;
      }
    },

    /** Deletes the project with its zones and everything else that belongs to it (cascade). */
    async remove(projectId: string): Promise<void> {
      await findProjectOrThrow(db, projectId);
      await db.project.delete({ where: { id: projectId } });
    },

    async addZone(projectId: string, input: ZoneCreate): Promise<MaterialZone> {
      const { sampleIds, ...fields } = input;
      try {
        return await db.$transaction(async (tx) => {
          await findProjectOrThrow(tx, projectId);
          const last = await tx.materialZone.aggregate({ where: { projectId }, _max: { sortOrder: true } });
          const zone = await tx.materialZone.create({
            data: {
              ...fields,
              projectId,
              sortOrder: (last._max.sortOrder ?? -1) + 1,
              samples: { create: sampleRows(sampleIds) },
            },
            include: withSamples,
          });
          await touchProject(tx, projectId);
          return toZone(zone);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateMaterialId(input.materialId);
        throw error;
      }
    },

    async updateZone(projectId: string, zoneId: string, patch: ZoneUpdate): Promise<MaterialZone> {
      const { sampleIds, ...fields } = patch;
      try {
        return await db.$transaction(async (tx) => {
          await findZoneOrThrow(tx, projectId, zoneId);
          if (sampleIds !== undefined) {
            // The register is replaced as a whole so the employee's order is kept.
            await tx.zoneSample.deleteMany({ where: { zoneId } });
            await tx.zoneSample.createMany({ data: sampleRows(sampleIds).map((row) => ({ ...row, zoneId })) });
          }
          const zone = await tx.materialZone.update({ where: { id: zoneId }, data: fields, include: withSamples });
          await touchProject(tx, projectId);
          return toZone(zone);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateMaterialId(patch.materialId);
        throw error;
      }
    },

    async removeZone(projectId: string, zoneId: string): Promise<void> {
      await db.$transaction(async (tx) => {
        await findZoneOrThrow(tx, projectId, zoneId);
        await tx.materialZone.delete({ where: { id: zoneId } });
        // The zone's report texts go with it (ReportNarrative.itemKey is the zone ID).
        await tx.reportNarrative.deleteMany({ where: { projectId, itemKey: zoneId } });
        await touchProject(tx, projectId);
      });
    },
  };
}

export type ProjectService = ReturnType<typeof projectService>;
