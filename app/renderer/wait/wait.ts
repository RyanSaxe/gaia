// The wait while a world is read, judged and baked: the first thing anyone
// sees whenever a project opens. It shows no words, counts or percentages;
// the progress a person sees is the world itself coming to be: the field
// map paints itself (`map-wait.ts`). Paper, then each area's border drawn
// with a pen as soon as the land is divided, each file's health washed in
// as it settles and each area's name lettered as its last answer comes in,
// the buildings and landmarks drawn while the world bakes, its hills, water
// and trees once it stands, and the paper folding away into the world.
// Nothing shows that work is pending: a lull is a still map.
// Everything that moves is a CSS transition of opacity or transform, or a
// pen line's dash, so it keeps moving on the compositor while the page's
// thread is busy standing the world, and the wait never competes with the bake.
// The one question the wait may ask, when judging would cost more than the
// person's limit, is a small paper slip: go ahead, or draw this world from
// the code alone, which the project remembers until the limit changes.

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
  /** The world stands and has drawn: the wait gives way to it once all that stood is on the sheet, and resolves once the world shows. */
  lift(): Promise<void>;
  /** Where the sheet lies on the page: a map chosen on the start ends there. */
  sheet(): DOMRect;
}

export interface Wait extends WaitView {
  /** Asks whether to spend past the limit, on a small slip of paper; resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
}

const dollars = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** The wait in `veil`, a layer over the stage that lifts once the world stands. */
export function createWait(veil: HTMLElement): Wait {
  veil.dataset.wait = "";
  const view = createMapWait(veil);
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
      words.append(name, ` costs about ${dollars(plan.estimatedUsd)}, over your ${dollars(plan.limitUsd)} limit. Without it, the world is drawn from the code alone.`);
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
      // Declining is remembered for this project until the limit changes.
      choices.append(yes, button("Not for this world", false));
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
