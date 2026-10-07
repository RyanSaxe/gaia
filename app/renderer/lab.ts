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

/** How far a press may stray, in CSS pixels, and still be a tap: a finger wobbles more than a mouse. */
export const tapSlop = (e: PointerEvent): number => (e.pointerType === "mouse" ? 5 : 10);

/**
 * Calls `tap` when a press lifts without ever straying past `tapSlop` from
 * where it went down, so a drag that comes back is still a drag. A press that
 * shared the canvas with another finger is part of a pinch, never a tap.
 */
export function onTap(target: HTMLElement, tap: (e: PointerEvent) => void): void {
  const down = new Map<number, { x: number; y: number; strayed: boolean }>();
  let pinched = false;
  target.addEventListener("pointerdown", (e) => {
    down.set(e.pointerId, { x: e.clientX, y: e.clientY, strayed: false });
    if (down.size > 1) pinched = true;
  });
  target.addEventListener("pointermove", (e) => {
    const start = down.get(e.pointerId);
    if (start !== undefined && Math.hypot(e.clientX - start.x, e.clientY - start.y) > tapSlop(e)) start.strayed = true;
  });
  const lift = (e: PointerEvent, counts: boolean): void => {
    const start = down.get(e.pointerId);
    down.delete(e.pointerId);
    if (counts && !pinched && start !== undefined && !start.strayed && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= tapSlop(e)) tap(e);
    if (down.size === 0) pinched = false;
  };
  target.addEventListener("pointerup", (e) => lift(e, true));
  target.addEventListener("pointercancel", (e) => lift(e, false));
}

/** A small file name for a shot: lowercase words joined by dashes. */
export const slug = (s: string): string => s.toLowerCase().replace(/@\d+$/, "").replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
