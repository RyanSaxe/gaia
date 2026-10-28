// The wait screen shown while a world is read, judged and baked. It shows
// progress without words or numbers, as a field map that draws each step as
// it happens (`map-wait.ts`). Every animation is a CSS opacity or transform
// transition, or a pen line's dash, so it keeps running on the compositor
// while the main thread builds the world.

import type { ConsentPlan, Opening } from "../../world-service/protocol.ts";
import type { BakedWorld } from "../terrain/world.ts";
import { createMapWait } from "./map-wait.ts";
import "./wait.css";

/** The wait screen's progress methods. */
export interface WaitView {
  /** Shows one `Opening` message: the land and its patches, each file's vitality as it settles, and the areas settled so far. */
  opening(o: Opening): void;
  /** Called once everything is judged and laid out, as the world starts to bake. `health` is every file's vitality by path. */
  baking(health: Readonly<Record<string, number>>): void;
  /** Draws a mark for each building and landmark at its laid-out place while the world bakes. */
  marks(things: Pick<BakedWorld, "buildings" | "landmarks">): void;
  /** Called when the world is built. Its hill shade, contours, water and trees fade in on the sheet. */
  baked(world: BakedWorld): void;
  /** Sets the darkness, from 0 by day to 1 at night, so the wait follows the clock. */
  night(n: number): void;
  /** Called when the world is ready to show. The paper folds away at once with any unfinished drawing, and the promise resolves once the world shows. */
  lift(): Promise<void>;
  /** The sheet's position on the page, where a card chosen on the start page lands. */
  sheet(): DOMRect;
  /**
   * Shows the face of a card chosen on the start page: a painting of the person's last view, or a tally of commits since
   * they last opened the world. The sheet takes the face's aspect and shows the face at once, under the start page's
   * table until the card rises into place. Once the land is divided, the card flips over to the sheet's bare paper, as
   * the journal turns a page, and the map is drawn there as for any world.
   */
  chosen(face: HTMLImageElement | HTMLCanvasElement): void;
  /** Returns the sheet's paper as currently painted, in its aspect, for the face of a new card that rises into the sheet. */
  face(): HTMLCanvasElement;
}

export interface Wait extends WaitView {
  /** Asks on a paper slip whether to spend over the limit. Resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
  /** Says on the same slip why the world could not be opened, with a button to try again. The wait stays, so no world opens without Jev's judgments. */
  failed(message: string): void;
}

const dollars = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** The wait `startWaitEarly` made before the world's page was built, until `takeWait` takes it. */
let early: { veil: HTMLElement; wait: Wait } | null = null;

/**
 * Lays the wait over `host` before the rest of the world's page is built, so
 * the first frame a person sees is the wait's sheet, already at darkness
 * `night` and in the land's aspect `aspect` (width over depth). With
 * `underTable`, the start page's map table will cover it (`start.css`), so
 * the sheet stays hidden under the table from the first frame and only the
 * paper shows until the table appears. The world claims this wait with
 * `takeWait`.
 */
export function startWaitEarly(host: HTMLElement, night: number, aspect: number, underTable = false): void {
  const veil = document.createElement("div");
  veil.className = "veil";
  veil.dataset.ref = "veil";
  veil.setAttribute("aria-label", "The world is being made");
  // Matches the darkness of the world's first frame, so the paper does not darken when that frame arrives.
  veil.style.setProperty("--night", night.toFixed(2));
  if (underTable) veil.dataset.table = "front";
  host.append(veil);
  early = { veil, wait: createWait(veil, aspect) };
}

/** Returns the early wait, swapped in for `slot`, or a new wait in `slot` with aspect `aspect`. */
export function takeWait(slot: HTMLElement, aspect: number): { veil: HTMLElement; wait: Wait } {
  if (early === null) return { veil: slot, wait: createWait(slot, aspect) };
  const taken = early;
  early = null;
  slot.replaceWith(taken.veil);
  return taken;
}

/**
 * A small paper slip at the bottom of the wait, with text and one or two answer buttons. It is the only place the wait
 * shows words. `answered` receives the chosen value on the click, as the slip starts to leave.
 */
function slipIn(veil: HTMLElement): (words: HTMLElement, answers: readonly (readonly [string, boolean | string])[], answered: (value: string) => void) => void {
  return (words, answers, answered) => {
    const slip = document.createElement("div");
    slip.className = "wait-slip";
    slip.setAttribute("role", "dialog");
    const choices = document.createElement("div");
    choices.className = "wait-choices";
    const buttons = answers.map(([text, value]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.dataset.answer = String(value);
      return b;
    });
    choices.append(...buttons);
    slip.append(words, choices);
    (veil.parentElement ?? veil).append(slip);
    buttons[0]?.focus({ preventScroll: true });
    choices.addEventListener("click", (e) => {
      const answer = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.answer;
      if (answer === undefined) return;
      slip.classList.add("leaving");
      window.setTimeout(() => slip.remove(), 400);
      answered(answer);
    });
  };
}

/** Creates the wait in `veil`, a layer over the stage that lifts once the world is built, with its sheet in the land's aspect `aspect`. */
export function createWait(veil: HTMLElement, aspect: number): Wait {
  veil.dataset.wait = "";
  const view = createMapWait(veil, aspect);
  const slip = slipIn(veil);
  return {
    ...view,
    ask(plan) {
      const words = document.createElement("p");
      words.append("Judging ");
      const name = document.createElement("i");
      name.textContent = plan.name;
      words.append(name, ` costs about ${dollars(plan.estimatedUsd)}, over your ${dollars(plan.limitUsd)} limit.`);
      return new Promise((resolve) => slip(words, [["Go ahead", true], ["Not now", false]], (answer) => resolve(answer === "true")));
    },
    failed(message) {
      const words = document.createElement("p");
      words.textContent = message;
      // Reloading opens the same world again, because main gives the new page the same folder.
      slip(words, [["Try again", true]], () => window.location.reload());
    },
  };
}
