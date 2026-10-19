import { describe, expect, it } from "vitest";
import { labExtractionJsonSchema } from "@/server/ai/labExtractionSchema";

type Node = Record<string, unknown>;

/** Keywords structured outputs accept for this schema. Numeric bounds and string lengths are not among them. */
const ALLOWED = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "description"]);

function walk(node: Node, visit: (node: Node, path: string) => void, path = "$") {
  visit(node, path);
  for (const [key, child] of Object.entries(node.properties ?? {})) walk(child as Node, visit, `${path}.${key}`);
  if (node.items) walk(node.items as Node, visit, `${path}[]`);
}

describe("lab extraction JSON schema", () => {
  const schema = labExtractionJsonSchema();

  it("uses only keywords that structured outputs enforce", () => {
    walk(schema, (node, path) => {
      for (const key of Object.keys(node)) expect(ALLOWED.has(key), `${path} has "${key}"`).toBe(true);
    });
  });

  it("requires every property and forbids extra ones on every object", () => {
    walk(schema, (node, path) => {
      if (node.type !== "object") return;
      expect(node.additionalProperties, path).toBe(false);
      expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as Node).sort());
    });
  });

  it("constrains the result label and confidence to their exact values", () => {
    const row = ((schema.properties as Node).results as Node).items as Node;
    const properties = row.properties as Record<string, Node>;
    expect(properties.resultLabel.enum).toEqual(["DETECTED", "NOT_DETECTED", "INCONCLUSIVE"]);
    expect(properties.confidence.enum).toEqual(["high", "medium", "low"]);
    expect(properties.sourcePage.type).toBe("integer");
    expect(properties.percentage.type).toEqual(["number", "null"]);
  });
});
