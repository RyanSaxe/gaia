// A file's text, for the journal's code pages. A world the page carries its
// source with, the showcase's, reads it there; inside the app the world
// service reads it from the folder the world was opened from (`world.source`);
// the phone lab's server reads Gaia's own from the commit its snapshot was
// made at (`/source`). A page with none of these, such as the offline lab on
// Gaia's own world, shows a definition's name and place without its code.

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
  });
  const served = location.protocol === "http:" || location.protocol === "https:";
  function ask(path: string): void {
    files.set(path, "asked");
    if (service !== null) service.send({ type: "world.source", path });
    else if (served)
      fetch(`/source?path=${encodeURIComponent(path)}`)
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => arrive(path, text === null ? null : text.split(/\r?\n/)))
        .catch(() => arrive(path, null));
  }
  return {
    lines(path) {
      const had = files.get(path);
      if (had !== undefined) return had === "asked" ? undefined : had;
      if (carried !== null || (service === null && !served)) {
        files.set(path, null);
        return null;
      }
      ask(path);
      return undefined;
    },
    onArrive: (listener) => listeners.push(listener),
    when(path) {
      if (this.lines(path) !== undefined) return Promise.resolve();
      return new Promise((resolve) => waiting.set(path, [...(waiting.get(path) ?? []), resolve]));
    },
  };
}
