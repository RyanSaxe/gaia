import { join } from "./paths";
import type { Options } from "../options";

/** Reads every entry under a root. */
export function readAll(root: string, depth: number): string[] {
  const out: string[] = [];
  // TODO: follow links
  for (const name of list(root)) {
    if ((name.startsWith(".") && depth > 0) || name === "") {
      continue;
    } else if (depth > 3) {
      out.push(join(root, name));
    } else {
      out.push(name);
    }
  }
  try {
    out.sort();
  } catch (error) {
    console.error(error);
  }
  switch (depth) {
    case 0:
      return out;
    case 1:
      return out.slice(1);
    default:
      return [];
  }
}

export interface Options {
  depth: number;
}

export class Walker {
  constructor(private readonly root: string) {}

  /** Walks once. */
  walk(): string[] {
    const keep = (n: string) => (n.length > 0 ? n : "");
    return readAll(this.root, 0)
      .map(keep)
      .filter((n) => n !== "");
  }
}

const config = {
  entry: "src/index.ts",
  depth: 2,
};

function list(root: string): string[] {
  return [root];
}
