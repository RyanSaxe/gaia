/**
 * A generated fixture as JSON, with one line for each entry of each top-level field, in the order given: a world's
 * kept answers take a line a request, so a re-ask changes one line for each answer it changes, and Gaia's thousands
 * of answers stay a file of thousands of lines rather than hundreds of thousands.
 */
export function fixtureJson(value: object): string {
  const one = (v: unknown): string => JSON.stringify(v) ?? "null";
  const field = (v: unknown): string => {
    if (Array.isArray(v)) return v.length === 0 ? "[]" : `[\n${v.map(one).join(",\n")}\n]`;
    if (typeof v !== "object" || v === null) return one(v);
    const entries = Object.entries(v).filter(([, e]) => e !== undefined);
    return entries.length === 0 ? "{}" : `{\n${entries.map(([k, e]) => `${JSON.stringify(k)}: ${one(e)}`).join(",\n")}\n}`;
  };
  const fields = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{\n${fields.map(([k, v]) => `${JSON.stringify(k)}: ${field(v)}`).join(",\n")}\n}\n`;
}
