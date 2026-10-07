// What the shell knows about a lab: it draws only while its tab is open,
// names the views `pnpm shots` saves, and offers a hook for scripted checks.

export interface Shot {
  readonly name: string;
  /** Sets the view up at once: no camera flights, no easing. */
  stage(): void;
}

export interface Lab {
  /** A hidden lab draws nothing and ignores input. */
  setActive(on: boolean): void;
  /** Draws one frame; `dt` is seconds since the last, `hour` the local hour the world shows. */
  frame(dt: number, now: number, hour: number): void;
  readonly shots: () => readonly Shot[];
  readonly hook: Readonly<Record<string, unknown>>;
}

/** Finds the element marked `data-ref="name"` inside a lab. */
export function refs(root: ParentNode): <T extends HTMLElement = HTMLElement>(name: string) => T {
  return <T extends HTMLElement>(name: string): T => {
    const node = root.querySelector<T>(`[data-ref="${name}"]`);
    if (node === null) throw new Error(`Missing [data-ref="${name}"]`);
    return node;
  };
}

/** A small file name for a shot: lowercase words joined by dashes. */
export const slug = (s: string): string => s.toLowerCase().replace(/@\d+$/, "").replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
