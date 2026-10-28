// Fetches file text for the journal's code pages, from the source a page
// carries (the showcase) or from the world service at the world's commit
// (`world.source`). When the world moves to a new commit (`world.vitality`),
// every fetched file is read again, and a page with neither source, such as
// the lab, shows no code.

import type { WorldService } from "../service.ts";

export interface SourceText {
  /** A file's lines, undefined until they arrive, or null when they are unavailable. */
  lines(path: string): readonly string[] | null | undefined;
  /** Calls `listener` as each file's lines arrive. */
  onArrive(listener: (path: string) => void): void;
  /** Resolves once a file's lines arrive or are known to be unavailable. */
  when(path: string): Promise<void>;
}

export function createSourceText(service: WorldService | null, carried: ReadonlyMap<string, string> | null = null): SourceText {
  const files = new Map<string, readonly string[] | null | "asked">();
  for (const [path, text] of carried ?? []) files.set(path, text.replace(/\n$/, "").split("\n"));
  const listeners: ((path: string) => void)[] = [];
  /** Resolvers waiting on each file, each called once. */
  const waiting = new Map<string, (() => void)[]>();
  const arrive = (path: string, lines: readonly string[] | null): void => {
    files.set(path, lines);
    for (const l of listeners) l(path);
    for (const w of waiting.get(path) ?? []) w();
    waiting.delete(path);
  };
  service?.on((m) => {
    if (m.type === "world.source") arrive(m.path, m.lines);
    // Keeps each file's old lines until the new ones arrive, so no page shows a file empty.
    else if (m.type === "world.vitality" && m.commit !== undefined) for (const [path, had] of files) if (had !== "asked") service.send({ type: "world.source", path });
  });
  return {
    lines(path) {
      const had = files.get(path);
      if (had !== undefined) return had === "asked" ? undefined : had;
      if (carried !== null || service === null) {
        files.set(path, null);
        return null;
      }
      files.set(path, "asked");
      service.send({ type: "world.source", path });
      return undefined;
    },
    onArrive: (listener) => listeners.push(listener),
    when(path) {
      if (this.lines(path) !== undefined) return Promise.resolve();
      return new Promise((resolve) => waiting.set(path, [...(waiting.get(path) ?? []), resolve]));
    },
  };
}
