// The wait while a world is read, judged and baked: the first thing anyone
// sees whenever a project opens. It shows no words, counts or percentages;
// the progress a person sees is the world itself coming to be. Two
// directions, chosen by `CHOSEN_WAIT` or `?wait=map|mark`:
// - `map`: the field map paints itself. Paper, then each area's border drawn
//   with a pen as soon as the land is divided, each area washed in as its
//   judgments settle, the washes drying while the world bakes, and the
//   paper folding away into the world.
// - `mark`: Gaia's mark on the sky, and fireflies drifting in to gather
//   into its glow as the world is read, judged and baked.
// Everything that moves is a CSS transition or animation of opacity or
// transform, so it keeps moving on the compositor while the page's thread
// is busy standing the world, and the wait never competes with the bake.
// The one question the wait may ask, when judging would cost more than the
// person's limit, is a small paper slip.

import type { ConsentPlan, Opening } from "../../world-service/protocol.ts";
import { createMapWait } from "./map-wait.ts";
import { createMarkWait } from "./mark-wait.ts";
import "./wait.css";

/** A wait that shows how opening a world is going. */
export interface WaitView {
  /** How opening the world is going: the land's outlines and the areas judged so far. */
  opening(o: Opening): void;
  /** Everything is judged and laid out: the world bakes now. */
  baking(): void;
  /** How dark it is, 0 by day to 1 at night: the wait follows the clock. */
  night(n: number): void;
  /** The world stands and has drawn: the wait gives way to it, and resolves once the world shows. */
  lift(): Promise<void>;
}

export interface Wait extends WaitView {
  /** Asks whether to spend past the limit, on a small slip of paper; resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
}

export type WaitStyle = "map" | "mark";
/** The direction the app shows unless the page asks for another with `?wait=`. */
const CHOSEN_WAIT: WaitStyle = "map";

export function waitStyle(): WaitStyle {
  const asked = new URLSearchParams(location.search).get("wait");
  return asked === "map" || asked === "mark" ? asked : CHOSEN_WAIT;
}

const dollars = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** The wait in `veil`, a layer over the stage that lifts once the world stands. */
export function createWait(veil: HTMLElement, style: WaitStyle = waitStyle()): Wait {
  veil.dataset.wait = style;
  const view = style === "map" ? createMapWait(veil) : createMarkWait(veil);
  return {
    ...view,
    ask(plan) {
      const slip = document.createElement("div");
      slip.className = "wait-slip";
      slip.setAttribute("role", "dialog");
      const words = document.createElement("p");
      words.append("Judging ");
      const name = document.createElement("i");
      name.textContent = plan.name;
      words.append(name, ` costs about ${dollars(plan.estimatedUsd)}, over your ${dollars(plan.limitUsd)} limit.`);
      const choices = document.createElement("div");
      choices.className = "wait-choices";
      const button = (text: string, answer: boolean): HTMLButtonElement => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.dataset.answer = String(answer);
        return b;
      };
      const yes = button("Go ahead", true);
      choices.append(yes, button("Use the stand-in", false));
      slip.append(words, choices);
      (veil.parentElement ?? veil).append(slip);
      yes.focus({ preventScroll: true });
      return new Promise((resolve) => {
        choices.addEventListener("click", (e) => {
          const answer = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.answer;
          if (answer === undefined) return;
          slip.classList.add("leaving");
          window.setTimeout(() => slip.remove(), 400);
          resolve(answer === "true");
        });
      });
    },
  };
}
