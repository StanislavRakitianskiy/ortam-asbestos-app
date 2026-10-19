import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { projectCreateSchema, zoneCreateSchema, zoneUpdateSchema, type ZoneCreateInput } from "@/domain/projectInput";
import { NotFoundError, ValidationError } from "@/server/errors";
import { projectService, type ProjectService } from "@/server/services/projectService";
import { createTestDb, type TestDb } from "../helpers/testDb";

let testDb: TestDb;
let service: ProjectService;

beforeAll(() => {
  testDb = createTestDb();
  service = projectService(testDb.db);
}, 60_000);

afterAll(async () => {
  await testDb?.cleanup();
});

beforeEach(async () => {
  await testDb.db.project.deleteMany();
});

const newProject = (code = "ORTAM-TEST-001") =>
  service.create(projectCreateSchema.parse({ code, client: "Test client", building: "Test building" }));

const zoneInput = (patch: Partial<ZoneCreateInput> = {}) =>
  zoneCreateSchema.parse({
    materialId: "M01",
    description: "Pipe insulation",
    floor: "Basement",
    location: "B01 mechanical room",
    sampleIds: ["S01"],
    quantity: 24,
    unit: "linear_m",
    condition: "poor",
    plannedDisturbance: false,
    rateRef: "R_PIPE",
    ...patch,
  });

/** Moves updatedAt into the past so a later change is visible without waiting. */
async function ageProject(projectId: string): Promise<Date> {
  const old = new Date("2020-01-01T00:00:00Z");
  await testDb.db.project.update({ where: { id: projectId }, data: { updatedAt: old } });
  return old;
}

async function expectError<T extends Error>(promise: Promise<unknown>, type: new (...args: never[]) => T): Promise<T> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(type);
  return error as T;
}

describe("projects", () => {
  it("creates a project with defaults and reads it back", async () => {
    const created = await newProject();
    const { project, zones } = await service.get(created.id);
    expect(project).toMatchObject({
      code: "ORTAM-TEST-001",
      client: "Test client",
      address: "",
      inspectionDate: null,
      reviewedBy: null,
      currency: "CAD",
    });
    expect(zones).toEqual([]);
  });

  it("rejects a duplicate project code as a field error", async () => {
    await newProject("DUP");
    const error = await expectError(newProject("DUP"), ValidationError);
    expect(Object.keys(error.fieldErrors)).toEqual(["code"]);
  });

  it("updates only the sent fields", async () => {
    const created = await newProject();
    const updated = await service.update(created.id, { inspectionDate: "2026-10-01", reviewedBy: null });
    expect(updated).toMatchObject({ client: "Test client", inspectionDate: "2026-10-01", reviewedBy: null });
  });

  it("rejects a report date before the inspection date, also against the stored value", async () => {
    const created = await newProject();
    await service.update(created.id, { inspectionDate: "2026-10-01" });
    const error = await expectError(service.update(created.id, { reportDate: "2026-09-30" }), ValidationError);
    expect(Object.keys(error.fieldErrors)).toEqual(["reportDate"]);
  });

  it("lists projects, most recently changed first, with their zone count", async () => {
    const first = await newProject("A-1");
    await newProject("B-2");
    await service.addZone(first.id, zoneInput());
    const list = await service.list();
    expect(list.map((item) => [item.code, item.zoneCount])).toEqual([
      ["A-1", 1],
      ["B-2", 0],
    ]);
  });

  it("deletes a project with its zones and samples", async () => {
    const created = await newProject();
    await service.addZone(created.id, zoneInput());
    await service.remove(created.id);
    expect(await testDb.db.materialZone.count()).toBe(0);
    expect(await testDb.db.zoneSample.count()).toBe(0);
    await expectError(service.get(created.id), NotFoundError);
  });
});

describe("material zones", () => {
  it("stores an unknown quantity as null and reads it back as null, not 0", async () => {
    const { id } = await newProject();
    const zone = await service.addZone(id, zoneInput({ materialId: "M05", quantity: null, unit: "m2", rateRef: "R_PANEL" }));
    expect(zone.quantity).toBeNull();
    const stored = await testDb.db.materialZone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(stored.quantity).toBeNull();
    expect((await service.get(id)).zones[0].quantity).toBeNull();
  });

  it("keeps several samples of one zone in the order entered, with one quantity", async () => {
    const { id } = await newProject();
    await service.addZone(
      id,
      zoneInput({ materialId: "M03", sampleIds: ["s07", "S03"], quantity: 140, unit: "m2", rateRef: "R_CEILING" }),
    );
    const { zones } = await service.get(id);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ sampleIds: ["S07", "S03"], quantity: 140 });
  });

  it("keeps zones in the order they were added", async () => {
    const { id } = await newProject();
    for (const materialId of ["M02", "M01", "M07"]) {
      await service.addZone(id, zoneInput({ materialId, sampleIds: [] }));
    }
    expect((await service.get(id)).zones.map((zone) => zone.materialId)).toEqual(["M02", "M01", "M07"]);
  });

  it("rejects a material ID that is already used in the project, but allows it in another project", async () => {
    const first = await newProject("A-1");
    const second = await newProject("B-2");
    await service.addZone(first.id, zoneInput());
    const error = await expectError(service.addZone(first.id, zoneInput({ sampleIds: ["S99"] })), ValidationError);
    expect(Object.keys(error.fieldErrors)).toEqual(["materialId"]);
    await expect(service.addZone(second.id, zoneInput())).resolves.toMatchObject({ materialId: "M01" });
  });

  it("allows the same sample ID in two zones; matching reports it for review", async () => {
    const { id } = await newProject();
    await service.addZone(id, zoneInput({ materialId: "M01", sampleIds: ["S01"] }));
    await service.addZone(id, zoneInput({ materialId: "M02", sampleIds: ["S01"] }));
    expect((await service.get(id)).zones.map((zone) => zone.sampleIds)).toEqual([["S01"], ["S01"]]);
  });

  it("updates only the sent fields and replaces the sample register when sent", async () => {
    const { id } = await newProject();
    const zone = await service.addZone(id, zoneInput({ sampleIds: ["S01", "S08"] }));

    const measured = await service.updateZone(id, zone.id, zoneUpdateSchema.parse({ quantity: 12.5 }));
    expect(measured).toMatchObject({ quantity: 12.5, sampleIds: ["S01", "S08"], condition: "poor" });

    const unknown = await service.updateZone(id, zone.id, zoneUpdateSchema.parse({ quantity: null, sampleIds: ["s09"] }));
    expect(unknown).toMatchObject({ quantity: null, sampleIds: ["S09"], unit: "linear_m" });
    expect(await testDb.db.zoneSample.count()).toBe(1);
  });

  it("rejects renaming a zone to a material ID used by another zone", async () => {
    const { id } = await newProject();
    await service.addZone(id, zoneInput({ materialId: "M01" }));
    const second = await service.addZone(id, zoneInput({ materialId: "M02" }));
    await expectError(service.updateZone(id, second.id, { materialId: "M01" }), ValidationError);
  });

  it("deletes a zone with its samples", async () => {
    const { id } = await newProject();
    const zone = await service.addZone(id, zoneInput());
    await service.removeZone(id, zone.id);
    expect((await service.get(id)).zones).toEqual([]);
    expect(await testDb.db.zoneSample.count()).toBe(0);
  });

  it("does not touch a zone through another project's ID", async () => {
    const owner = await newProject("A-1");
    const other = await newProject("B-2");
    const zone = await service.addZone(owner.id, zoneInput());
    await expectError(service.updateZone(other.id, zone.id, { notes: "x" }), NotFoundError);
    await expectError(service.removeZone(other.id, zone.id), NotFoundError);
    await expectError(service.addZone("missing-project", zoneInput()), NotFoundError);
    expect((await service.get(owner.id)).zones).toHaveLength(1);
  });

  it("moves Project.updatedAt on every zone change", async () => {
    const { id } = await newProject();
    const updatedAt = async () => (await testDb.db.project.findUniqueOrThrow({ where: { id } })).updatedAt;

    let old = await ageProject(id);
    const zone = await service.addZone(id, zoneInput());
    expect((await updatedAt()) > old).toBe(true);

    old = await ageProject(id);
    await service.updateZone(id, zone.id, { notes: "Checked" });
    expect((await updatedAt()) > old).toBe(true);

    old = await ageProject(id);
    await service.removeZone(id, zone.id);
    expect((await updatedAt()) > old).toBe(true);

    old = await ageProject(id);
    await service.update(id, { address: "Training Site A" });
    expect((await updatedAt()) > old).toBe(true);
  });
});
