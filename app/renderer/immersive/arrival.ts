// Arrival titles: crossing into a directory's area, its name rises softly
// over the land and fades, as a region's name does in Breath of the Wild.
// Pausing brings up a quieter line near the ground: the file underfoot, if
// any, over the area's path. Walking on lets it go.

import type { Place } from "@gaia/terrain";

export interface Arrival {
  /** Follows the person: where they stand, and how long they have stood still, in seconds. */
  frame(place: Place, still: number, dt: number): void;
  /** Whether titles are the chosen way of finding one's way. */
  show(on: boolean): void;
  /** The title showing now and the line underfoot, for scripted checks. */
  state(): { readonly title: string | null; readonly underfoot: string | null };
}

/** How long a person must stay in a new area before its name rises, seconds: a border walked along never flickers. */
const SETTLE = 1.2;
/** An area left and re-entered within this long, seconds, is not announced again. */
const RECENT = 25;
/** How long a title shows, seconds, matching its animation in lab.css. */
const TITLE_LIFE = 7;
/** Standing still this long, seconds, brings up the line underfoot. */
const PAUSE = 1.1;

const el = (cls: string, parent: HTMLElement): HTMLElement => {
  const node = document.createElement("div");
  node.className = cls;
  parent.append(node);
  return node;
};

/** The parent directories of a path, for the small line over its name: "packages / render". */
const parentOf = (path: string): string => path.split("/").slice(0, -1).join(" / ");

export function createArrival(root: HTMLElement): Arrival {
  const title = el("arrival", root);
  title.setAttribute("aria-live", "polite");
  const parent = el("arrival-parent", title);
  const name = el("arrival-name", title);
  el("arrival-rule", title);
  const under = el("underfoot", root);
  const underFile = el("underfoot-file", under);
  const underArea = el("underfoot-area", under);

  let on = false;
  let announced: string | null = null;
  let candidate: string | null = null;
  let held = 0;
  let age = Infinity;
  const seen = new Map<string, number>();
  let clock = 0;
  let underKey = "";

  function announce(place: Place): void {
    parent.textContent = parentOf(place.area.path);
    name.textContent = place.area.name;
    // Restart the rise: drop the class, let the browser see it gone, add it back.
    title.classList.remove("rise");
    void title.offsetWidth;
    title.classList.add("rise");
    age = 0;
  }

  return {
    frame(place, still, dt) {
      clock += dt;
      age += dt;
      if (age > TITLE_LIFE && title.classList.contains("rise")) title.classList.remove("rise");
      const key = `${place.area.depth}:${place.area.path}`;
      if (key === announced) {
        candidate = null;
        held = 0;
      } else if (key === candidate) {
        held += dt;
        if (held >= SETTLE) {
          const last = seen.get(key);
          if (on && (last === undefined || clock - last > RECENT)) announce(place);
          if (announced !== null) seen.set(announced, clock);
          announced = key;
          candidate = null;
        }
      } else {
        candidate = key;
        held = 0;
      }
      const pausing = on && still >= PAUSE;
      if (pausing) {
        const nextKey = `${place.file?.path ?? ""}|${key}`;
        if (nextKey !== underKey || !under.classList.contains("on")) {
          underKey = nextKey;
          underFile.textContent = place.file?.name ?? "";
          underFile.hidden = place.file === null;
          // The wild and the repository's own ground go by their names; a directory by its path.
          underArea.textContent = place.area.depth <= 0 ? place.area.name : place.area.path.split("/").join(" / ");
        }
      }
      under.classList.toggle("on", pausing);
    },
    show(next) {
      on = next;
      if (!next) {
        title.classList.remove("rise");
        under.classList.remove("on");
      }
      // Arriving into the titles announces where the person stands.
      announced = null;
      candidate = null;
      held = 0;
      seen.clear();
    },
    state: () => ({
      title: title.classList.contains("rise") ? name.textContent : null,
      underfoot: under.classList.contains("on") ? `${underFile.hidden ? "" : `${underFile.textContent} · `}${underArea.textContent}` : null,
    }),
  };
}
