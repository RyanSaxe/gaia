// What a building, a landmark or anything else that stands for code says
// about what it stands for: its path, the name on its sign, a few words on
// what it is, and its vitality.

import type { Blueprint, EntityFacts, FileFacts, ThingFacts } from "@gaia/schema";

/** Something in the world a person can walk up to and ask about. */
export interface Represented {
  /** Its path: its identity. */
  readonly id: string;
  /** The name painted on its sign. */
  readonly name: string;
  /** What it is, in a few words, such as "Package · TypeScript": the note under its name on its sign. */
  readonly what: string;
  /** How it is doing, 0 to 1: Jev's quality. */
  readonly vitality: number;
}

/**
 * What a building stands for and the building: an entity, a file or a
 * definition, with its page (`represented`) and the request that judged what
 * it stands as.
 */
export interface BuildingOf {
  readonly facts: EntityFacts | ThingFacts;
  /** What its page says. */
  readonly represented: Represented;
  /** The request that judged what it stands as; an entity's own when absent. */
  readonly judged?: { readonly about: "file" | "entity"; readonly target: string };
  readonly vitality: number;
  /** What its building is built from: the parts Jev composed for it. */
  readonly blueprint: Blueprint;
  /** What the building is called, such as "Fieldstone house with a waterwheel". */
  readonly kindName: string;
}

const FORMS: Readonly<Record<EntityFacts["form"], string>> = { package: "Package", crate: "Rust crate" };
const LANGUAGES: Readonly<Record<string, string>> = { typescript: "TypeScript", rust: "Rust" };
/** The last part of a path, which names an entity among its neighbors; the root's entity is the repository's own. */
export const shortName = (path: string): string => path.split("/").filter(Boolean).pop() ?? "the repository";

export function representEntity(e: EntityFacts, vitality: number): Represented {
  return {
    id: e.path,
    name: e.name,
    what: FORMS[e.form],
    vitality,
  };
}

/** What stands for a file says about it. */
export function representFile(f: FileFacts, vitality: number): Represented {
  return {
    id: f.path,
    name: shortName(f.path),
    what: `File · ${LANGUAGES[f.language] ?? f.language}`,
    vitality,
  };
}
