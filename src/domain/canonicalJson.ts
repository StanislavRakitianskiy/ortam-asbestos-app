/**
 * Canonical JSON: object keys sorted at every level, arrays kept in their order, no whitespace. The same data always
 * gives the same text, whatever order its keys were built in, so its hash identifies the data.
 *
 * Only plain JSON data is accepted. undefined, functions, non-finite numbers and class instances (Date, Map …) throw
 * instead of being dropped or converted as JSON.stringify would, so JSON.parse of the result gives back exactly the
 * input.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot encode ${value} at ${path}: not a finite number.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Cannot encode ${path}: not a plain object.`);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key], `${path}.${key}`)}`).join(",")}}`;
  }
  throw new TypeError(`Cannot encode ${path}: ${typeof value} is not JSON data.`);
}
