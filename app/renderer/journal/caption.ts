// Builds a picture's caption from Jev's judgment of an item: a label and a
// percentage for each quality concept Jev answered, such as "readability
// 45%". An unanswered concept is left out, so a caption is empty before
// anything is judged.

import type { JudgedThing } from "../../world-service/protocol.ts";

export interface CaptionFact {
  readonly label: string;
  readonly value: string;
}

/** The quality concepts in caption order, each with its caption label. */
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
 * Returns the caption for an item the understanding pass judged: each
 * answered concept as a percentage. A concept with no answer, such as
 * robustness where nothing can fail, is left out.
 */
export function conceptsCaption(thing: JudgedThing): CaptionFact[] {
  return CONCEPTS.flatMap(([key, label]) => {
    const v = thing.concepts[key];
    return v == null ? [] : [{ label, value: `${Math.round(v * 100)}%` }];
  });
}
