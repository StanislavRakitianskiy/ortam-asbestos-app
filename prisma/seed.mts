// DEVELOPMENT ONLY. Run with `npm run db:seed`. The demo is meant to be entered through the form; this seed only
// saves typing while developing. It holds the project and material register from fixtures/employee_field_notes.pdf
// and no laboratory results: those come only from uploading the lab PDFs.
//
// It also creates ORTAM-DEMO-001-EDGE, a separate copy of the register for the candidate-made edge-case report
// fixtures/test/LAB-X_edge_cases.pdf (upload it there with LAB-A, LAB-B and LAB-C). LAB-X is never used in
// ORTAM-DEMO-001, so the main demo keeps the golden results.
//
// Executed by Node's built-in TypeScript support, so keep to erasable syntax and avoid the @/ alias here.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CODE = "ORTAM-DEMO-001";
const EDGE_CODE = "ORTAM-DEMO-001-EDGE";

type Zone = {
  materialId: string;
  description: string;
  floor: string;
  location: string;
  sampleIds: string[];
  quantity: number | null;
  unit: "m2" | "linear_m";
  condition: "intact" | "damaged" | "poor" | "unknown";
  plannedDisturbance: boolean;
  rateRef: string | null;
  accessible: boolean;
  notes: string;
};

const zones: Zone[] = [
  {
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
    accessible: true,
    notes: "Visible damage recorded; quantity is an exercise input.",
  },
  {
    materialId: "M02",
    description: "Floor tile and adhesive",
    floor: "Ground",
    location: "G01 corridor",
    sampleIds: ["S02"],
    quantity: 90,
    unit: "m2",
    condition: "intact",
    plannedDisturbance: true,
    rateRef: "R_FLOOR",
    accessible: true,
    notes: "Tile and underlying adhesive are distinct lab layers.",
  },
  {
    materialId: "M03",
    description: "Textured ceiling",
    floor: "Ground",
    location: "G02 office",
    sampleIds: ["S03", "S07"],
    quantity: 140,
    unit: "m2",
    condition: "damaged",
    plannedDisturbance: true,
    rateRef: "R_CEILING",
    accessible: true,
    notes: "Two samples represent one material zone; count 140 m2 only once.",
  },
  {
    materialId: "M04",
    description: "Wall plaster",
    floor: "Ground",
    location: "G03 meeting room",
    sampleIds: ["S04"],
    quantity: 65,
    unit: "m2",
    condition: "intact",
    plannedDisturbance: false,
    rateRef: null,
    accessible: true,
    notes: "Result applies only to sampled material.",
  },
  {
    materialId: "M05",
    description: "Cement panel",
    floor: "Exterior",
    location: "E01 east elevation",
    sampleIds: ["S05"],
    quantity: null,
    unit: "m2",
    condition: "intact",
    plannedDisturbance: false,
    rateRef: "R_PANEL",
    accessible: true,
    notes: "Quantity not measured. Do not treat blank as zero.",
  },
  {
    materialId: "M06",
    description: "Insulation fragment",
    floor: "Basement",
    location: "B02 service room",
    sampleIds: ["S06"],
    quantity: 8,
    unit: "m2",
    condition: "unknown",
    plannedDisturbance: false,
    rateRef: null,
    accessible: true,
    notes: "Inconclusive laboratory result; do not classify as negative.",
  },
  {
    materialId: "M07",
    description: "Uninspected riser material",
    floor: "Basement",
    location: "B03 locked riser",
    sampleIds: [],
    quantity: null,
    unit: "m2",
    condition: "unknown",
    plannedDisturbance: false,
    rateRef: null,
    accessible: false,
    notes: "No access and no sample. No conclusion about asbestos presence.",
  },
];

const DEMO_PROJECT = {
  client: "Example Property Group fictional",
  building: "Fictional Training Building A",
  address: "Training Site A - no real address",
  inspectionDate: "2026-10-01",
  scope: "Accessible areas only; illustration for hiring assessment",
  plannedWork: "Ground corridor floor and office ceiling replacement planned",
  jurisdictionNote: "Unspecified - no regulatory compliance conclusion permitted",
  currency: "CAD",
};

/** Re-running the seed resets the project to the field notes (cascade removes its zones and any uploads). */
async function seedProject(code: string, overrides: Partial<typeof DEMO_PROJECT> = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.project.deleteMany({ where: { code } });
    return tx.project.create({
      data: {
        code,
        ...DEMO_PROJECT,
        ...overrides,
        zones: {
          create: zones.map(({ sampleIds, ...zone }, sortOrder) => ({
            ...zone,
            sortOrder,
            samples: { create: sampleIds.map((sampleId, index) => ({ sampleId, sortOrder: index })) },
          })),
        },
      },
    });
  });
}

async function main(): Promise<void> {
  const project = await seedProject(CODE);
  console.log(`Seeded ${project.code} with ${zones.length} material zones and no lab results (${project.id}).`);
  const edge = await seedProject(EDGE_CODE, {
    scope:
      "Edge-case demo of the review step. Upload LAB-A, LAB-B, LAB-C and the candidate-made test fixture fixtures/test/LAB-X_edge_cases.pdf.",
  });
  console.log(`Seeded ${edge.code} (edge-case demo, same register, no lab results) (${edge.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
