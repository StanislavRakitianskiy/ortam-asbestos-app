import { describe, expect, it } from "vitest";
import { layerKey, matchProject, registeredSampleIds, type ProjectMatch } from "@/domain/matching";
import { byMaterial, demoResults, demoZones, labRow, withZone } from "../fixtures/demoProject";

const statuses = (match: ProjectMatch) =>
  Object.fromEntries(match.zones.map((zone) => [zone.materialId, zone.zoneStatus]));
const issue = (match: ProjectMatch, key: string) => {
  const found = match.issues.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`Expected issue ${key}, got ${match.issues.map((i) => i.key).join(", ")}`);
  return found;
};
const keys = (match: ProjectMatch) => match.issues.map((found) => found.key);

describe("matchProject on the supplied demo data", () => {
  const match = matchProject(demoZones(), demoResults());

  it("derives the golden zone statuses", () => {
    expect(statuses(match)).toEqual({
      M01: "DETECTED",
      M02: "DETECTED",
      M03: "DETECTED",
      M04: "NOT_DETECTED",
      M05: "DETECTED",
      M06: "INCONCLUSIVE",
      M07: "INACCESSIBLE",
    });
  });

  it("keeps both S02 layers and treats the zone as detected", () => {
    const [s02] = byMaterial(match.zones, "M02").samples;
    expect(s02.sampleId).toBe("S02");
    expect(s02.layers.map((layer) => [layer.layer, layer.status])).toEqual([
      ["Floor tile", "NOT_DETECTED"],
      ["Black adhesive", "DETECTED"],
    ]);
    expect(s02.status).toBe("DETECTED");
    expect(byMaterial(match.zones, "M02").zoneStatus).toBe("DETECTED");
  });

  it("keeps S03 and S07 as two samples of the one M03 zone", () => {
    const m03 = byMaterial(match.zones, "M03");
    expect(m03.samples.map((sample) => [sample.sampleId, sample.status])).toEqual([
      ["S03", "DETECTED"],
      ["S07", "DETECTED"],
    ]);
    expect(m03.samples.map((sample) => sample.layers[0].results[0].labReportId)).toEqual(["LAB-A", "LAB-C"]);
  });

  it("keeps the evidence of each matched lab row", () => {
    const [layer] = byMaterial(match.zones, "M05").samples[0].layers;
    expect(layer.results[0]).toMatchObject({
      fileName: "LAB-B_fictional_lab_report.pdf",
      page: 1,
      sourceText: "S05 Cement panel Detected Chrysotile 8%",
      percentage: 8,
    });
  });

  it("raises only the expected review issues, none of them blocking", () => {
    expect(match.issues.map((found) => [found.key, found.severity])).toEqual([
      ["MISSING_QUANTITY:zone-m05", "warning"],
      ["INCONCLUSIVE_RESULT:zone-m06:S06:insulation fragment", "warning"],
      ["INACCESSIBLE_ZONE:zone-m07", "warning"],
    ]);
  });

  it("attaches each issue to the zones it refers to", () => {
    expect(byMaterial(match.zones, "M05").issues.map((found) => found.type)).toEqual(["MISSING_QUANTITY"]);
    expect(byMaterial(match.zones, "M01").issues).toEqual([]);
    expect(issue(match, "INCONCLUSIVE_RESULT:zone-m06:S06:insulation fragment").refs).toEqual({
      zoneIds: ["zone-m06"],
      sampleIds: ["S06"],
      labResultIds: ["lab-b-s06-insulation-fragment"],
      documentIds: ["doc-lab-b"],
    });
  });

  it("produces the same result and keys when run again", () => {
    expect(matchProject(demoZones(), demoResults())).toEqual(match);
  });
});

describe("sample ID matching", () => {
  it('matches " s07 " in the register to lab sample S07', () => {
    const zones = withZone(demoZones(), "M03", { sampleIds: ["S03", " s07 "] });
    const match = matchProject(zones, demoResults());
    const m03 = byMaterial(match.zones, "M03");
    expect(m03.samples.map((sample) => sample.sampleId)).toEqual(["S03", "S07"]);
    expect(m03.samples[1].layers).toHaveLength(1);
    expect(keys(match).some((key) => key.startsWith("UNMATCHED_LAB_SAMPLE"))).toBe(false);
  });

  it('never matches "S7" to S07', () => {
    const zones = withZone(demoZones(), "M03", { sampleIds: ["S03", "S7"] });
    const match = matchProject(zones, demoResults());
    const m03 = byMaterial(match.zones, "M03");
    expect(m03.samples[1]).toEqual({ sampleId: "S7", status: "AWAITING_RESULT", layers: [] });
    expect(m03.zoneStatus).toBe("DETECTED");
    expect(issue(match, "MISSING_LAB_RESULT:zone-m03:S7").severity).toBe("blocking");
    expect(issue(match, "UNMATCHED_LAB_SAMPLE:S07")).toMatchObject({
      severity: "blocking",
      refs: { zoneIds: [], sampleIds: ["S07"], labResultIds: ["lab-c-s07-textured-coating"] },
    });
  });

  it("normalizes lab sample IDs the same way", () => {
    const results = demoResults().map((row) => (row.sampleId === "S01" ? { ...row, sampleId: " s01 " } : row));
    const m01 = byMaterial(matchProject(demoZones(), results).zones, "M01");
    expect(m01.zoneStatus).toBe("DETECTED");
  });

  it("reports S99 from the lab as an unmatched sample", () => {
    const s99 = labRow({ labReportId: "LAB-A", sampleId: "S99", layer: "Insulation", resultLabel: "DETECTED" });
    const match = matchProject(demoZones(), [...demoResults(), s99]);
    expect(issue(match, "UNMATCHED_LAB_SAMPLE:S99")).toMatchObject({
      type: "UNMATCHED_LAB_SAMPLE",
      severity: "blocking",
      refs: { zoneIds: [], sampleIds: ["S99"], labResultIds: [s99.id], documentIds: ["doc-lab-a"] },
    });
    expect(issue(match, "UNMATCHED_LAB_SAMPLE:S99").message).toContain("S99 (LAB-A)");
    expect(statuses(match)).toEqual(statuses(matchProject(demoZones(), demoResults())));
  });

  it("ignores repeated and blank register entries", () => {
    expect(registeredSampleIds({ sampleIds: ["S03", " s03", "", "S07"] })).toEqual(["S03", "S07"]);
  });
});

describe("conflicts and duplicates", () => {
  const s04Detected = labRow({ labReportId: "LAB-D", sampleId: "S04", layer: "Plaster", resultLabel: "DETECTED" });

  it("flags S04 detected in one report and not detected in another as a conflict", () => {
    const match = matchProject(demoZones(), [...demoResults(), s04Detected]);
    const m04 = byMaterial(match.zones, "M04");
    expect(m04.zoneStatus).toBe("CONFLICT");
    expect(m04.samples[0].status).toBe("CONFLICT");
    expect(m04.samples[0].layers[0].status).toBe("CONFLICT");
    expect(m04.samples[0].layers[0].results).toHaveLength(2);
    expect(issue(match, "CONFLICTING_RESULT:S04:plaster")).toMatchObject({
      severity: "blocking",
      refs: {
        zoneIds: ["zone-m04"],
        sampleIds: ["S04"],
        labResultIds: ["lab-b-s04-plaster", s04Detected.id],
        documentIds: ["doc-lab-b", "doc-lab-d"],
      },
    });
    expect(issue(match, "CONFLICTING_RESULT:S04:plaster").message).toContain(
      "Not detected in LAB-B, Detected in LAB-D",
    );
    expect(match.issues[0].severity).toBe("blocking");
  });

  it("flags a conflict inside one lab report too", () => {
    const sameReport = { ...s04Detected, id: "lab-b-s04-plaster-2", labReportId: "LAB-B", documentId: "doc-lab-b" };
    const match = matchProject(demoZones(), [...demoResults(), sameReport]);
    expect(byMaterial(match.zones, "M04").zoneStatus).toBe("CONFLICT");
  });

  it("keeps a zone detected through another layer while still raising the conflict", () => {
    const tileDetected = labRow({ labReportId: "LAB-D", sampleId: "S02", layer: "Floor tile", resultLabel: "DETECTED" });
    const match = matchProject(demoZones(), [...demoResults(), tileDetected]);
    const m02 = byMaterial(match.zones, "M02");
    expect(m02.samples[0].layers.map((layer) => layer.status)).toEqual(["CONFLICT", "DETECTED"]);
    expect(m02.zoneStatus).toBe("DETECTED");
    expect(m02.issues.map((found) => found.key)).toEqual(["CONFLICTING_RESULT:S02:floor tile"]);
  });

  it("ranks a conflict above an inconclusive layer", () => {
    const zones = withZone(demoZones(), "M04", { sampleIds: ["S04", "S06"] });
    const match = matchProject(zones, [...demoResults(), s04Detected]);
    expect(byMaterial(match.zones, "M04").zoneStatus).toBe("CONFLICT");
  });

  it("flags S03 listed in two zones and shows its results under both", () => {
    const zones = withZone(demoZones(), "M04", { sampleIds: ["S04", "S03"] });
    const match = matchProject(zones, demoResults());
    expect(issue(match, "DUPLICATE_SAMPLE_IN_REGISTER:S03")).toMatchObject({
      severity: "blocking",
      refs: { zoneIds: ["zone-m03", "zone-m04"], sampleIds: ["S03"], labResultIds: ["lab-a-s03-textured-coating"] },
    });
    expect(issue(match, "DUPLICATE_SAMPLE_IN_REGISTER:S03").message).toContain("(M03, M04)");
    for (const materialId of ["M03", "M04"]) {
      const zone = byMaterial(match.zones, materialId);
      expect(zone.samples.some((sample) => sample.sampleId === "S03" && sample.layers.length === 1)).toBe(true);
      expect(zone.issues.map((found) => found.key)).toContain("DUPLICATE_SAMPLE_IN_REGISTER:S03");
    }
  });

  it("flags a sample listed in two zones even before any lab result arrives", () => {
    let zones = withZone(demoZones(), "M04", { sampleIds: ["S04", "S08"] });
    zones = withZone(zones, "M06", { sampleIds: ["S06", "S08"] });
    const match = matchProject(zones, demoResults());
    expect(issue(match, "DUPLICATE_SAMPLE_IN_REGISTER:S08").refs).toEqual({
      zoneIds: ["zone-m04", "zone-m06"],
      sampleIds: ["S08"],
      labResultIds: [],
      documentIds: [],
    });
  });

  it("reports a conflict on a sample that is not in the register as well as the unmatched ID", () => {
    const rows = [
      labRow({ labReportId: "LAB-A", sampleId: "S99", layer: "Insulation", resultLabel: "DETECTED" }),
      labRow({ labReportId: "LAB-D", sampleId: "S99", layer: "Insulation", resultLabel: "INCONCLUSIVE" }),
    ];
    const match = matchProject(demoZones(), [...demoResults(), ...rows]);
    expect(issue(match, "CONFLICTING_RESULT:S99:insulation").refs.zoneIds).toEqual([]);
    expect(issue(match, "UNMATCHED_LAB_SAMPLE:S99").refs.labResultIds).toEqual(rows.map((row) => row.id));
  });

  it("counts identical rows of one lab report once when that report arrives in two files", () => {
    const copy = demoResults()
      .filter((row) => row.labReportId === "LAB-A")
      .map((row) => ({ ...row, id: `${row.id}-copy`, documentId: "doc-lab-a-copy", fileName: "LAB-A_rescan.pdf" }));
    const match = matchProject(demoZones(), [...demoResults(), ...copy]);
    expect(statuses(match)).toEqual(statuses(matchProject(demoZones(), demoResults())));
    for (const layer of byMaterial(match.zones, "M02").samples[0].layers) expect(layer.results).toHaveLength(1);
    expect(issue(match, "DUPLICATE_LAB_REPORT:LAB-A")).toMatchObject({
      severity: "warning",
      refs: { sampleIds: ["S01", "S02", "S03"], documentIds: ["doc-lab-a", "doc-lab-a-copy"] },
    });
    expect(issue(match, "DUPLICATE_LAB_REPORT:LAB-A").refs.labResultIds).toHaveLength(8);
    expect(keys(match).some((key) => key.startsWith("CONFLICTING_RESULT"))).toBe(false);
  });

  it("keeps agreeing results from different lab reports as separate evidence", () => {
    const second = labRow({ labReportId: "LAB-D", sampleId: "S01", layer: "Insulation", resultLabel: "DETECTED" });
    const match = matchProject(demoZones(), [...demoResults(), second]);
    const [layer] = byMaterial(match.zones, "M01").samples[0].layers;
    expect(layer.status).toBe("DETECTED");
    expect(layer.results.map((result) => result.labReportId)).toEqual(["LAB-A", "LAB-D"]);
    expect(keys(match)).toEqual(keys(matchProject(demoZones(), demoResults())));
  });

  it("compares layer text ignoring case and extra whitespace", () => {
    expect(layerKey("  Black   Adhesive ")).toBe("black adhesive");
    const again = labRow({ labReportId: "LAB-D", sampleId: "S04", layer: " plaster  ", resultLabel: "NOT_DETECTED" });
    const [s04] = byMaterial(matchProject(demoZones(), [...demoResults(), again]).zones, "M04").samples;
    expect(s04.layers).toHaveLength(1);
    expect(s04.layers[0]).toMatchObject({ layer: "Plaster", status: "NOT_DETECTED" });
  });
});

describe("zone status rules", () => {
  it("marks an accessible zone without samples as unsampled", () => {
    const zones = withZone(demoZones(), "M07", { accessible: true });
    const match = matchProject(zones, demoResults());
    expect(byMaterial(match.zones, "M07").zoneStatus).toBe("UNSAMPLED");
    expect(issue(match, "UNSAMPLED_ZONE:zone-m07").severity).toBe("warning");
    expect(keys(match)).not.toContain("INACCESSIBLE_ZONE:zone-m07");
  });

  it("waits for every sample before concluding not detected", () => {
    const zones = withZone(demoZones(), "M04", { sampleIds: ["S04", "S08"] });
    const match = matchProject(zones, demoResults());
    expect(byMaterial(match.zones, "M04").zoneStatus).toBe("AWAITING_RESULT");
    expect(issue(match, "MISSING_LAB_RESULT:zone-m04:S08").refs).toMatchObject({
      zoneIds: ["zone-m04"],
      sampleIds: ["S08"],
    });
  });

  it("marks a zone with no results at all as awaiting results", () => {
    const zones = withZone(demoZones(), "M04", { sampleIds: ["S08"] });
    expect(byMaterial(matchProject(zones, demoResults()).zones, "M04").zoneStatus).toBe("AWAITING_RESULT");
  });

  it("keeps a zone inconclusive when another sample is not detected", () => {
    const zones = withZone(demoZones(), "M04", { sampleIds: ["S04", "S06"] });
    expect(byMaterial(matchProject(zones, demoResults()).zones, "M04").zoneStatus).toBe("INCONCLUSIVE");
  });

  it("treats a zone as detected when one sample is detected and another is awaiting", () => {
    const zones = withZone(demoZones(), "M01", { sampleIds: ["S01", "S08"] });
    expect(byMaterial(matchProject(zones, demoResults()).zones, "M01").zoneStatus).toBe("DETECTED");
  });
});

describe("rate checks", () => {
  it("flags M01 measured in m2 against the linear_m pipe rate", () => {
    const match = matchProject(withZone(demoZones(), "M01", { unit: "m2" }), demoResults());
    expect(issue(match, "RATE_UNIT_MISMATCH:zone-m01:R_PIPE")).toMatchObject({
      severity: "blocking",
      refs: { zoneIds: ["zone-m01"] },
    });
    expect(issue(match, "RATE_UNIT_MISMATCH:zone-m01:R_PIPE").message).toContain("priced per linear_m");
  });

  it("flags an unknown rate reference: blocking when detected, warning otherwise", () => {
    let zones = withZone(demoZones(), "M01", { rateRef: "R_DUCT" });
    zones = withZone(zones, "M04", { rateRef: "R_WALL" });
    const match = matchProject(zones, demoResults());
    expect(issue(match, "UNKNOWN_RATE_REF:zone-m01:R_DUCT").severity).toBe("blocking");
    expect(issue(match, "UNKNOWN_RATE_REF:zone-m04:R_WALL").severity).toBe("warning");
  });

  it("downgrades a unit mismatch on a zone that will not be priced to a warning", () => {
    const match = matchProject(withZone(demoZones(), "M04", { rateRef: "R_PIPE" }), demoResults());
    expect(issue(match, "RATE_UNIT_MISMATCH:zone-m04:R_PIPE").severity).toBe("warning");
  });

  it("flags a detected zone without a rate reference", () => {
    const match = matchProject(withZone(demoZones(), "M01", { rateRef: null }), demoResults());
    expect(issue(match, "MISSING_RATE_FOR_DETECTED:zone-m01").severity).toBe("warning");
  });
});
