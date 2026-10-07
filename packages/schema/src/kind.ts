import type { FileFacts } from "./facts.ts";
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
  Light: { input: null, output: "LightSpec" },
  Sky: { input: null, output: "SkySpec" },
  Season: { input: null, output: "SeasonSpec" },
  Atmosphere: { input: null, output: "AtmosphereSpec" },
  Ground: { input: null, output: "GroundSpec" },
  Accents: { input: null, output: "AccentSpec" },
  Wind: { input: null, output: "WindSpec" },
};

/** Anchors come from a Skeleton's tips or a Built's anchors. */
function feeds(output: string, input: string): boolean {
  return output === input || (input === "Anchors" && (output === "Built" || output === "Skeleton"));
}

/**
 * A kind of world component. Code, and few of them. Its slots say what a
 * blueprint must fill; `represents` is what Jev reads when it decides which
 * kind should stand for a piece of code.
 */
export interface Kind {
  readonly id: string;
  readonly doc: string;
  readonly represents: string;
  readonly slots: Readonly<Record<string, Slot>>;
  /** Numbers bound from code facts. Jev never answers these. */
  readonly facts: Readonly<Record<string, (f: FileFacts) => number>>;
}

export function kind(def: Kind): Kind {
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
export function slotOrder(k: Kind): string[] {
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
