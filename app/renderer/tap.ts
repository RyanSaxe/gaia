// Tells a tap from a drag, for the world canvas and the paper UI over it.

/** How far a press may move, in CSS pixels, and still count as a tap. A finger moves more than a mouse. */
export const tapSlop = (e: PointerEvent): number => (e.pointerType === "mouse" ? 5 : 10);

/**
 * Calls `tap` when a press lifts without ever moving more than `tapSlop` from
 * where it went down, so a drag that returns to its start is still a drag. A
 * press made while another pointer was down is part of a pinch, never a tap.
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
