// Shows the start page when Gaia opens with no world named: a 3D map table
// (`table.ts`) where a person picks a recent world, a local folder or a GitHub
// address. It lies over the wait inside the same veil, so it shares `--night`,
// and `withStart` holds back the wait's painting while a chosen card rises
// into the wait's sheet.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { localHour } from "../clock.ts";
import type { Wait } from "../wait/wait.ts";
import type { StartPage } from "./choice.ts";
import { createTable } from "./table.ts";
import "./start.css";

/** How long a card chosen on the table takes to rise into the wait's sheet, in milliseconds. */
export { CHOSEN_MS } from "./table.ts";

/** The wait with the start page added, which the page uses when no world is named. */
export interface WaitWithStart extends Wait {
  /** Shows the start page in the wait's veil and resolves with the chosen place. The next `opening` call moves the table behind the wait. */
  choose(offer: StartOffer): Promise<StartChoice>;
  /** Passes the world's hour each frame, which lights the start page. */
  hour(h: number): void;
}

/** Milliseconds after a place is chosen when the wait resumes painting even if no card has risen into it. A card takes under 3 s. */
const UNCOVERED_BY_MS = 6000;

/** Adds the start page to `wait`, laid over it in its veil. */
export function withStart(wait: Wait, veil: HTMLElement): WaitWithStart {
  /** The start page, from when it is offered, or a world opens on the table without it, until the world shows. */
  let page: StartPage | null = null;
  /** Whether a place has been chosen, so the page takes no more choices. */
  let left = false;
  // The clock's hour, local or from `?hour=`, until the first frame passes the world's hour.
  const asked = Number(new URLSearchParams(location.search).get("hour") ?? Number.NaN);
  let hour = Number.isFinite(asked) ? asked : localHour(new Date());
  // While the table's card rises, the wait holds back new painting, so the sheet still matches the card when it takes
  // the card's place. The held painting then runs in arrival order.
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
      // A world opened without the start page, as on a reload, rises from the same table as a chosen one.
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
    baked(world) {
      held(() => wait.baked(world));
    },
    choose(offer) {
      // An offer that comes after a place was chosen starts the page over.
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
