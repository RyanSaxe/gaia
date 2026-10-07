import type { EntityFacts, FileFacts, RegionFacts, RepositoryFacts } from "./facts.ts";
import type { Role } from "./ports.ts";

export interface Slot<R extends Role = Role> {
  readonly role: R;
  /** The slot whose output feeds this slot's input. */
  readonly on?: string;
  readonly optional: boolean;
}

export function slot<R extends Role>(role: R, opts: { on?: string; optional?: boolean } = {}): Slot<R> {
  return { role, optional: opts.optional ?? false, ...(opts.on === undefined ? {} : { on: opts.on }) };
}

/** What each role consumes and produces, by name, for checks at load time. */
const ROLE_IO: Readonly<Record<Role, { input: string | null; output: string }>> = {
  Skeleton: { input: null, output: "Skeleton" },
  Surface: { input: "Skeleton", output: "Built" },
  Foliage: { input: "Skeleton", output: "Built" },
  Ornament: { input: "Anchors", output: "Built" },
  Motion: { input: null, output: "MotionSpec" },
  Palette: { input: null, output: "Palette" },
  Relief: { input: null, output: "Landform" },
  Light: { input: null, output: "DaySpec" },
  Sky: { input: null, output: "SkySpec" },
  Season: { input: null, output: "SeasonSpec" },
  Atmosphere: { input: null, output: "AtmosphereSpec" },
  Ground: { input: null, output: "GroundSpec" },
  Accents: { input: null, output: "AccentSpec" },
  Wind: { input: null, output: "WindSpec" },
  Natives: { input: null, output: "NativeFamilies" },
  Footprint: { input: null, output: "BuildingPlan" },
  Walls: { input: "BuildingPlan", output: "Built" },
  Roof: { input: "BuildingPlan", output: "Built" },
  Openings: { input: "BuildingPlan", output: "Built" },
  Dressing: { input: "BuildingPlan", output: "Built" },
  Feature: { input: "BuildingPlan", output: "Built" },
  Rock: { input: null, output: "Built" },
  Overgrowth: { input: "Built", output: "Built" },
  Drift: { input: null, output: "Built" },
};

/** Anchors come from a Skeleton's tips or a Built's anchors. */
function feeds(output: string, input: string): boolean {
  return output === input || (input === "Anchors" && (output === "Built" || output === "Skeleton"));
}

/**
 * What a kind stands for: one file, one entity (a package, crate, service or
 * module), one directory's region, or the whole repository.
 */
export type Subject = "file" | "entity" | "region" | "repository";

export interface SubjectFacts {
  file: FileFacts;
  entity: EntityFacts;
  region: RegionFacts;
  repository: RepositoryFacts;
}

/**
 * A kind of world component. Code, and few of them. Its slots say what a
 * blueprint must fill; `represents` is what Jev reads when it decides which
 * kind should stand for a piece of code.
 */
export interface Kind<S extends Subject = Subject> {
  readonly id: string;
  readonly subject: S;
  readonly doc: string;
  readonly represents: string;
  readonly slots: Readonly<Record<string, Slot>>;
  /** Slot groups Jev answers in order; each group sees the earlier groups' answers. One group if absent. */
  readonly stages?: readonly (readonly string[])[];
  /** Numbers bound from the subject's facts. Jev never answers these. */
  readonly facts: Readonly<Record<string, (f: SubjectFacts[S]) => number>>;
}

/** Any kind, for code that reads slots and stages but never binds facts. */
export type AnyKind = Kind<"file"> | Kind<"entity"> | Kind<"region"> | Kind<"repository">;

/** The slot groups Jev answers in order: the kind's stages, or every slot at once. */
export function stagesOf(k: AnyKind): readonly (readonly string[])[] {
  return k.stages ?? [Object.keys(k.slots)];
}

export function kind<S extends Subject>(def: Kind<S>): Kind<S> {
  if (def.stages !== undefined) {
    const staged = def.stages.flat();
    const names = Object.keys(def.slots);
    if (staged.length !== names.length || !names.every((n) => staged.includes(n))) {
      throw new Error(`${def.id}'s stages must list every slot exactly once.`);
    }
  }
  for (const [name, s] of Object.entries(def.slots)) {
    const io = ROLE_IO[s.role];
    if (s.on === undefined) {
      if (io.input !== null) throw new Error(`${def.id}.${name} is a ${s.role} and needs an "on" slot.`);
      continue;
    }
    const source = def.slots[s.on];
    if (source === undefined) throw new Error(`${def.id}.${name} is on "${s.on}", which does not exist.`);
    const out = ROLE_IO[source.role].output;
    if (io.input === null || !feeds(out, io.input)) {
      throw new Error(`${def.id}.${name} (${s.role}) cannot take ${out} from "${s.on}".`);
    }
  }
  return Object.freeze(def);
}

/** Slot names in an order where every slot comes after the slot it is on. */
export function slotOrder(k: AnyKind): string[] {
  const done = new Set<string>();
  const order: string[] = [];
  const visit = (name: string): void => {
    if (done.has(name)) return;
    const on = k.slots[name]?.on;
    if (on !== undefined) visit(on);
    done.add(name);
    order.push(name);
  };
  for (const name of Object.keys(k.slots)) visit(name);
  return order;
}
