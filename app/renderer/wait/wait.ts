// The wait while a world is read, judged and baked: the first thing anyone
// sees whenever a project opens. It shows no words, counts or percentages;
// the progress a person sees is the world itself coming to be: the field
// map paints itself (`map-wait.ts`). Paper, then each area's border drawn
// with a pen as soon as the land is divided, a pencil going over each file
// and area as Jev reads it, each file's health washed in as it settles and
// each area's name lettered as its last answer comes in, the buildings and
// landmarks drawn while the world bakes, its hills, water and trees once it
// stands, and the paper folding away into the world as soon as it is ready
// to show, whatever is left of the drawing going with it. Every stroke is of
// something that has happened, drawn at a hand's pace, so the sheet keeps
// moving all the time Jev works.
// Everything that moves is a CSS transition of opacity or transform, or a
// pen line's dash, so it keeps moving on the compositor while the page's
// thread is busy standing the world, and the wait never competes with the bake.
// The one question the wait may ask, when judging would cost more than the
// person's limit, is a small paper slip: go ahead, or not now, which leaves
// the world unopened. When a world cannot be judged (Jev is off, or a request
// it could not answer), the same slip says what failed and why, and the wait
// stays: a world is always Jev's, never quietly guessed.

import type { ConsentPlan, Opening } from "../../world-service/protocol.ts";
import type { StoodWorld } from "../terrain/lab.ts";
import { createMapWait } from "./map-wait.ts";
import "./wait.css";

/** A wait that shows how opening a world is going. */
export interface WaitView {
  /** How opening the world is going: the land and its patches, each file's health as it settles, and the areas judged so far. */
  opening(o: Opening): void;
  /** Everything is judged and laid out, and `health` is every file's vitality by path: every area is settled, and the world bakes now. */
  baking(health: Readonly<Record<string, number>>): void;
  /** The buildings and landmarks at their laid-out places, each with what its mark on the map is drawn from: the pen draws them while the world bakes. */
  marks(things: Pick<StoodWorld, "buildings" | "landmarks">): void;
  /** The world stands: its hill shade, contours, water and trees come in on the sheet. */
  stood(world: StoodWorld): void;
  /** How dark it is, 0 by day to 1 at night: the wait follows the clock. */
  night(n: number): void;
  /** The world is ready to show: the paper folds away into it at once, with whatever of the drawing is still to come, and resolves once the world shows. */
  lift(): Promise<void>;
  /** Where the sheet lies on the page: a map chosen on the start ends there. */
  sheet(): DOMRect;
  /**
   * A map chosen on the start, as its picture and its land's shape (width over depth): the sheet takes that shape and
   * the picture lies on it at once, under the start's table until the map has risen into its place. It folds away to
   * bare paper as soon as the land is divided, and the map is drawn anew, as any world's is.
   */
  chosen(picture: string, aspect: number): void;
  /** The sheet's paper as it is painted now, in its shape: the face of a fresh card that rises into the sheet. */
  face(): HTMLCanvasElement;
}

export interface Wait extends WaitView {
  /** Asks whether to spend past the limit, on a small slip of paper; resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
  /** The world could not be opened: says why on the same slip, with a way to try again, and the wait stays. */
  failed(message: string): void;
}

const dollars = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** A wait made before the world's page is built (`startWaitEarly`), waiting to be taken. */
let early: { veil: HTMLElement; wait: Wait } | null = null;

/**
 * Lays the wait over `host` before anything else of the world's page is
 * built, so the first frame a person sees is the wait's sheet, not an empty
 * page while the world's page builds behind it, already `night` dark and in
 * the shape its land will have (`aspect`, width over depth). With
 * `underTable`, the start's map table is coming (`start.css`): the sheet
 * stays unseen beneath it from the first frame, and only the paper shows
 * until the table does. The world takes it when it makes its own
 * (`takeWait`).
 */
export function startWaitEarly(host: HTMLElement, night: number, aspect: number, underTable = false): void {
  const veil = document.createElement("div");
  veil.className = "veil";
  veil.dataset.ref = "veil";
  veil.setAttribute("aria-label", "The world is being made");
  // As dark as the world's first frame will make it, so the paper does not darken once that frame comes.
  veil.style.setProperty("--night", night.toFixed(2));
  if (underTable) veil.dataset.table = "front";
  host.append(veil);
  early = { veil, wait: createWait(veil, aspect) };
}

/** The wait laid early, standing in `slot`'s place, or a new wait in `slot` in the shape `aspect`. */
export function takeWait(slot: HTMLElement, aspect: number): { veil: HTMLElement; wait: Wait } {
  if (early === null) return { veil: slot, wait: createWait(slot, aspect) };
  const taken = early;
  early = null;
  slot.replaceWith(taken.veil);
  return taken;
}

/**
 * A small slip of warm paper at the foot of the wait, with its words and one or two answers: the one way the wait
 * speaks. `answered` gets the chosen answer's value once the slip has gone.
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

/** The wait in `veil`, a layer over the stage that lifts once the world stands, its sheet in the land's shape `aspect`. */
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
      // Trying again opens the same world afresh: the page reopens what main named it after.
      slip(words, [["Try again", true]], () => window.location.reload());
    },
  };
}
