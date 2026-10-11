// A file's text, for the journal's code pages. Inside the app the world
// service reads it from the folder the world was opened from (`world.source`);
// the phone lab's server reads Gaia's own from the commit its snapshot was
// made at (`/source`). A page with neither, such as the offline lab, shows a
// definition's name and place without its code.

import type { WorldService } from "../service.ts";

export interface SourceText {
  /** A file's lines; undefined until they arrive, null when they can't be had. */
  lines(path: string): readonly string[] | null | undefined;
  /** Hears each file's lines arrive. */
  onArrive(listener: (path: string) => void): void;
}

export function createSourceText(service: WorldService | null): SourceText {
  const files = new Map<string, readonly string[] | null | "asked">();
  const listeners: ((path: string) => void)[] = [];
  const arrive = (path: string, lines: readonly string[] | null): void => {
    files.set(path, lines);
    for (const l of listeners) l(path);
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
      if (service === null && !served) {
        files.set(path, null);
        return null;
      }
      ask(path);
      return undefined;
    },
    onArrive: (listener) => listeners.push(listener),
  };
}
