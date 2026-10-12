// What Jev says about an item, as its picture's caption, lettered across the
// foot of the left-hand page as a plate in an old book carries one: a few
// facts, each a short label and Jev's answer by its name in the engine's
// vocabulary ("reads  hard to follow"). Which facts an item shows depends on
// what it is; an answer Jev hasn't given is left out, so a caption shows
// whatever of them there is, and none at all before anything is judged.

import type { Choice, Score, YesNo } from "@gaia/schema";
import type { JudgedThing } from "../../world-service/protocol.ts";
import type { Judgment } from "./words.ts";

export interface CaptionFact {
  readonly label: string;
  readonly value: string;
  /** How sure Jev is of a choice or a yes or no, 0 to 1. */
  readonly sure?: number;
}

/** What a caption shows, by what the item is: each fact's label, and where its answer sits in a judgment. */
const SHOWN = {
  definition: [
    ["why look", "attention"],
    ["role", "role"],
    ["reads", "quality.readability"],
    ["change", "quality.change"],
    ["failures", "quality.errors"],
  ],
  file: [
    ["kind", "kind"],
    ["why look", "attention"],
    ["focus", "quality.cohesion"],
    ["needs tests", "needsTests"],
  ],
  folder: [
    ["kind", "kind"],
    ["focus", "quality.cohesion"],
    ["why look", "attention"],
  ],
} as const;

/** A name as a caption letters it: without a leading article, and lower case unless it begins with a capital word ("UI"). */
const lettered = (name: string): string => {
  const bare = name.replace(/^(the|an?) /i, "");
  return /^[A-Z][a-z]/.test(bare) ? bare.charAt(0).toLowerCase() + bare.slice(1) : bare;
};

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

/** The caption of an item of this kind, from what Jev judged about the item itself. */
export function captionOf(item: keyof typeof SHOWN, judgment: Judgment | undefined): CaptionFact[] {
  if (judgment === undefined) return [];
  const facts: CaptionFact[] = [];
  for (const [label, path] of SHOWN[item]) {
    const answer = path.split(".").reduce<unknown>((at, k) => (at as Record<string, unknown> | undefined)?.[k], judgment.judged) as Choice | Score | YesNo | undefined;
    const name = judgment.names?.[path];
    if (answer === undefined) continue;
    if ("choice" in answer) {
      // A routine thing gives no reason to look.
      if (path === "attention" && answer.choice === "routine") continue;
      facts.push({ label, value: lettered(name ?? answer.choice), sure: answer.p[answer.choice] ?? 0 });
    } else if ("score" in answer) {
      // A score shows only by its name: a bare number says nothing on a caption.
      if (name !== undefined) facts.push({ label, value: lettered(name) });
    } else facts.push({ label, value: answer.p >= 0.5 ? "yes" : "no", sure: Math.max(answer.p, 1 - answer.p) });
  }
  return facts;
}
