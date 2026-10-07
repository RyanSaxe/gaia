// On a narrow screen a lab's panel is a bottom sheet: a handle naming the
// selected item, which a tap opens or closes and a pull drags. On a wide
// screen lab.css hides the handle and the panel stays beside the stage.

export interface Sheet {
  /** Names the selected item on the handle. */
  name(text: string): void;
}

/** How far a pull must travel before the sheet settles at its other end. */
const SETTLE_PX = 40;

export function createSheet(panel: HTMLElement): Sheet {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "sheet-handle";
  handle.setAttribute("aria-expanded", "false");
  const label = document.createElement("span");
  label.className = "sheet-name";
  handle.append(label);
  panel.prepend(handle);

  const isOpen = (): boolean => panel.classList.contains("open");
  const setOpen = (open: boolean): void => {
    panel.classList.toggle("open", open);
    handle.setAttribute("aria-expanded", String(open));
  };
  /** How far down the closed sheet sits: all of it but the handle. */
  const closedAt = (): number => panel.offsetHeight - handle.offsetHeight;

  const pull = { id: -1, startY: 0, from: 0, at: 0, moved: false };
  handle.addEventListener("pointerdown", (e) => {
    if (pull.id !== -1) return;
    pull.id = e.pointerId;
    pull.startY = e.clientY;
    pull.from = pull.at = isOpen() ? 0 : closedAt();
    pull.moved = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pull.id) return;
    const dy = e.clientY - pull.startY;
    if (!pull.moved && Math.abs(dy) < 6) return;
    pull.moved = true;
    pull.at = Math.max(0, Math.min(closedAt(), pull.from + dy));
    panel.style.transition = "none";
    panel.style.transform = `translateY(${pull.at}px)`;
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== pull.id) return;
    pull.id = -1;
    if (!pull.moved) return;
    panel.style.transition = "";
    panel.style.transform = "";
    const travel = pull.at - pull.from;
    setOpen(travel < -SETTLE_PX ? true : travel > SETTLE_PX ? false : isOpen());
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
  // A press that did not pull is a tap, and the click that follows it toggles.
  handle.addEventListener("click", () => {
    if (pull.moved) pull.moved = false;
    else setOpen(!isOpen());
  });

  return {
    name: (text) => {
      label.textContent = text;
    },
  };
}
