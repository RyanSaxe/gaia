// What Jev says about an item, as its picture's caption, lettered across the
// foot of the left-hand page as a plate in an old book carries one: each
// concept of quality Jev answered, a short label and a percentage
// ("readability  45%"). A concept Jev hasn't answered, or whose answer
// doesn't count, is left out, so a caption shows whatever of them there is,
// and none at all before anything is judged.

import type { JudgedThing } from "../../world-service/protocol.ts";

export interface CaptionFact {
  readonly label: string;
  readonly value: string;
}

/** The concepts of quality in the order a caption letters them, each by its name on the plate. */
const CONCEPTS: readonly (readonly [string, string])[] = [
  ["correctness", "correctness"],
  ["readability", "readability"],
  ["simplicity", "simplicity"],
  ["cohesion", "cohesion"],
  ["coupling", "loose coupling"],
  ["explicitness", "explicitness"],
  ["consistency", "consistency"],
  ["testability", "testability"],
  ["robustness", "robustness"],
  ["efficiency", "efficiency"],
];

/**
 * The caption of an item the understanding pass judged: each concept it
 * answered, as a percentage. A concept whose answer doesn't count, such as
 * robustness where nothing can fail, is left out.
 */
export function conceptsCaption(thing: JudgedThing): CaptionFact[] {
  return CONCEPTS.flatMap(([key, label]) => {
    const v = thing.concepts[key];
    return v == null ? [] : [{ label, value: `${Math.round(v * 100)}%` }];
  });
}
