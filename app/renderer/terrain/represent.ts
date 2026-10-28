// The page data of anything that represents code: its path, the name on its
// sign, a few words on what it is, and its vitality.

import type { Blueprint, EntityFacts, FileFacts, ThingFacts } from "@gaia/schema";

/** Something in the world a person can walk up to and ask about. */
export interface Represented {
  /** Its path, which identifies it. */
  readonly id: string;
  /** The name painted on its sign. */
  readonly name: string;
  /** What it is, in a few words, such as "Package · TypeScript": the note under its name on its sign. */
  readonly what: string;
  /** Its vitality from 0 to 1, from Jev's quality judgment. */
  readonly vitality: number;
}

/**
 * The entity, file or definition a building represents, with its page
 * (`represented`), the request that judged its form, and the building.
 */
export interface BuildingOf {
  readonly facts: EntityFacts | ThingFacts;
  readonly represented: Represented;
  /** The request that judged its form. Absent when it was the entity's own request. */
  readonly judged?: { readonly about: "file" | "entity"; readonly target: string };
  readonly vitality: number;
  /** The parts Jev composed for its building. */
  readonly blueprint: Blueprint;
  /** What the building is called, such as "Fieldstone house with a waterwheel". */
  readonly kindName: string;
}

const FORMS: Readonly<Record<EntityFacts["form"], string>> = { package: "Package", crate: "Rust crate" };
const LANGUAGES: Readonly<Record<string, string>> = { typescript: "TypeScript", rust: "Rust" };
/** The last part of a path, which names an entity among its neighbors. The root's entity is "the repository". */
export const shortName = (path: string): string => path.split("/").filter(Boolean).pop() ?? "the repository";

export function representEntity(e: EntityFacts, vitality: number): Represented {
  return {
    id: e.path,
    name: e.name,
    what: FORMS[e.form],
    vitality,
  };
}

/** The page data for a file. */
export function representFile(f: FileFacts, vitality: number): Represented {
  return {
    id: f.path,
    name: shortName(f.path),
    what: `File · ${LANGUAGES[f.language] ?? f.language}`,
    vitality,
  };
}
