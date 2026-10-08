// The start: what Gaia shows when it opens with no world named. A person
// picks a world they walked before, a folder on this computer, or writes the
// address of a place on GitHub. It is part of the world, not a screen in
// front of it: no boxes, no jargon, and an address that leads nowhere is
// answered in the world's own words. Two directions, chosen by
// `CHOSEN_START` or `?start=table|signpost`:
// - `table`: the traveller's map table. The field map's paper on a wooden
//   table, the worlds walked before as small painted map sheets laid on it,
//   and a line at its foot to write an address on, lettered like the map.
// - `signpost`: the world's edge, at the hour it is. A signpost whose arms
//   name the worlds walked before, one pointing to somewhere on this
//   computer, and one blank arm to write an address on.
// The start lies over the wait, inside its veil, so it reads the same
// `--night` and, once a place is chosen, dissolves into the wait's paper.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import type { Wait } from "../wait/wait.ts";
import type { StartPage } from "./choice.ts";
import { createSignpost } from "./signpost.ts";
import { createTable } from "./table.ts";
import "./start.css";

export type StartStyle = "table" | "signpost";
/** The direction the app shows unless the page asks for another with `?start=`. */
const CHOSEN_START: StartStyle = "table";

export function startStyle(): StartStyle {
  const asked = new URLSearchParams(location.search).get("start");
  return asked === "table" || asked === "signpost" ? asked : CHOSEN_START;
}

/** The wait, with the start laid over it in its veil when no world is named. */
export function withStart(wait: Wait, veil: HTMLElement, style: StartStyle = startStyle()): Wait & { choose(offer: StartOffer): Promise<StartChoice> } {
  let page: StartPage | null = null;
  return {
    ...wait,
    opening(o) {
      page?.leave();
      page = null;
      wait.opening(o);
    },
    choose(offer) {
      page ??= style === "table" ? createTable(veil) : createSignpost(veil);
      return page.offer(offer);
    },
  };
}
