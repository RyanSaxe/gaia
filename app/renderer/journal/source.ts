// A file's text, for the journal's code pages. A world the page carries its
// source with, the showcase's, reads it there; inside the app the world
// service reads it from the folder the world was opened from (`world.source`),
// at the commit the world was built from, and once the world heals onto a new
// commit (`world.vitality`) every file read so far is read again from that.
// A page with neither, such as the lab on the proving ground, shows a
// definition's name and place without its code.

import type { WorldService } from "../service.ts";

export interface SourceText {
  /** A file's lines; undefined until they arrive, null when they can't be had. */
  lines(path: string): readonly string[] | null | undefined;
  /** Hears each file's lines arrive. */
  onArrive(listener: (path: string) => void): void;
  /** Settles once a file's lines have come, or are known not to be had. */
  when(path: string): Promise<void>;
}

export function createSourceText(service: WorldService | null, carried: ReadonlyMap<string, string> | null = null): SourceText {
  const files = new Map<string, readonly string[] | null | "asked">();
  for (const [path, text] of carried ?? []) files.set(path, text.replace(/\n$/, "").split("\n"));
  const listeners: ((path: string) => void)[] = [];
  /** Who waits for each file, each heard once. */
  const waiting = new Map<string, (() => void)[]>();
  const arrive = (path: string, lines: readonly string[] | null): void => {
    files.set(path, lines);
    for (const l of listeners) l(path);
    for (const w of waiting.get(path) ?? []) w();
    waiting.delete(path);
  };
  service?.on((m) => {
    if (m.type === "world.source") arrive(m.path, m.lines);
    // Its old lines stay until the new ones come, so no page shows a file empty.
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
