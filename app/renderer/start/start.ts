// The start: what Gaia shows when it opens with no world named. A person
// picks a world they walked before, a folder on this computer, or writes the
// address of a place on GitHub. It is part of the world, not a screen in
// front of it: no boxes, no jargon, and an address that leads nowhere is
// answered in the world's own words. It is the traveller's map table in 3D
// (`table.ts`): a folded sheet on an oak table, lit by the world's own light
// at the hour, the worlds walked before laid on it as paintings of where the
// person last stood, and a line at its foot to write an address on in ink.
// The start lies over the wait, inside its veil, so it reads the same
// `--night`. Once a place is chosen, the table stays behind the wait, its
// card risen into the wait's sheet, until the world shows; a world opened
// with no start rises from the same table.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { localHour } from "../clock.ts";
import type { Wait } from "../wait/wait.ts";
import type { StartPage } from "./choice.ts";
import { createTable } from "./table.ts";
import "./start.css";

/** How long a map chosen on the table takes to rise into the wait's sheet, ms. */
export { CHOSEN_MS } from "./table.ts";

/** The wait with the start, which the page shows when no world is named. */
export interface WaitWithStart extends Wait {
  /** Offers the start in the wait's veil; resolves with the place chosen. The next `opening` sends it behind the wait. */
  choose(offer: StartOffer): Promise<StartChoice>;
  /** The hour the world shows, each frame: the start is lit by it. */
  hour(h: number): void;
}

/** How long after a place is on its way the wait paints on even if no card has risen into it, ms: a card takes under 3 s. */
const UNCOVERED_BY_MS = 6000;

/** The wait, with the start laid over it in its veil when no world is named. */
export function withStart(wait: Wait, veil: HTMLElement): WaitWithStart {
  /** The start, from when it is offered (or a world opens with no start, on the table) until the world shows. */
  let page: StartPage | null = null;
  /** Whether the place is on its way, so the page takes no more choices. */
  let left = false;
  // Until the first frame says otherwise, the hour the clock shows: the person's own, or `?hour=`.
  const asked = Number(new URLSearchParams(location.search).get("hour") ?? Number.NaN);
  let hour = Number.isFinite(asked) ? asked : localHour(new Date());
  // While the table's card is on its way, the wait paints nothing new on its sheet, so the sheet is still what the card
  // shows when it takes the card's place; then everything held is painted in the order it came.
  let covered: Promise<void> = Promise.resolve();
  let uncover = (): void => undefined;
  const cover = (): void => {
    covered = new Promise((resolve) => (uncover = resolve));
  };
  const held = (paint: () => void): void => void covered.then(paint);
  const table = (): StartPage => {
    cover();
    return createTable(veil, { hour, sheet: wait.sheet, chosen: wait.chosen, face: wait.face, landed: () => uncover() });
  };
  return {
    ...wait,
    opening(o) {
      // A world opened with no start, as on a reload, rises from the same table a chosen one does.
      if (page === null && o.stage === "reading") page = table();
      if (!left) {
        page?.leave();
        window.setTimeout(() => uncover(), UNCOVERED_BY_MS);
      }
      left = true;
      held(() => wait.opening(o));
    },
    baking(health) {
      held(() => wait.baking(health));
    },
    marks(things) {
      held(() => wait.marks(things));
    },
    stood(world) {
      held(() => wait.stood(world));
    },
    choose(offer) {
      // Offered again after a place was on its way, the start begins afresh.
      if (left) {
        page?.close();
        page = null;
        left = false;
      }
      page ??= table();
      return page.offer(offer);
    },
    async lift() {
      await covered;
      await wait.lift();
      page?.close();
      page = null;
    },
    hour(h) {
      if (h === hour) return;
      hour = h;
      page?.hour(h);
    },
  };
}
