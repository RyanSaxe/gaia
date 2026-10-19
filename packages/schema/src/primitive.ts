import type { Params, Resolved } from "./fields.ts";
import type { Rand } from "./rand.ts";
import type { Role, RoleInput, RoleOutput } from "./ports.ts";
import type { Slot } from "./kind.ts";

export type PrimitiveId = `${string}@${number}`;

export interface BuildContext {
  readonly rand: Rand;
  /** The kind's fact bindings for this instance, such as scale and age. */
  readonly facts: Readonly<Record<string, number>>;
}

/**
 * A versioned procedural operator. `build` must be pure: the same params, seed
 * and input give the same output.
 */
export interface Primitive<R extends Role = Role, P extends Params = Params> {
  readonly id: PrimitiveId;
  readonly role: R;
  /** What Jev reads when it chooses a primitive for a slot. */
  readonly doc: string;
  readonly params: P;
  /** Slots of the primitive's own, filled in a later request. Their input is this primitive's output. */
  readonly slots?: Readonly<Record<string, Slot>>;
  /**
   * What a place must have for this primitive to stand there, such as running
   * water for a waterwheel. A thing whose place lacks any of them is never
   * offered it; where it has them all, Jev chooses as it would.
   */
  readonly needs?: readonly Need[];
  readonly build: (params: Resolved<P>, ctx: BuildContext, input: RoleInput<R>) => RoleOutput<R>;
}

/**
 * One thing a part or a form needs of the place it stands in: something the
 * place has, such as running water, or a range of the thing's rank by
 * importance among the world's own things, from 0 (the least important) to 1
 * (the most), both ends included.
 */
export type Need = string | { readonly rank: readonly [number, number] };

/** Where a thing stands, as needs read it: what the place has, and the thing's rank by importance when it has one. */
export interface Place {
  readonly has: readonly string[];
  readonly rank?: number;
}

/**
 * Whether a place meets every need: it has each thing needed, and its rank
 * lies in each range needed. A place with no rank meets no range. This is the
 * one rule that decides what Jev is offered; among what fits, Jev chooses.
 */
export function meets(needs: readonly Need[] | undefined, place: Place): boolean {
  return (needs ?? []).every((n) => (typeof n === "string" ? place.has.includes(n) : place.rank !== undefined && place.rank >= n.rank[0] && place.rank <= n.rank[1]));
}

export function primitive<R extends Role, const P extends Params>(def: Primitive<R, P>): Primitive<R, P> {
  if (!/^[a-z][a-z0-9-]*@\d+$/.test(def.id)) {
    throw new Error(`Primitive ID "${def.id}" must look like "name@1".`);
  }
  if (def.doc.trim().length === 0) throw new Error(`${def.id} needs a doc for Jev.`);
  return Object.freeze(def);
}

/**
 * A primitive with its parameter types erased, so primitives of different
 * shapes share one list. Gaia checks stored values against `params` before it
 * calls `build`, which is why the erased signature can accept anything.
 */
export interface AnyPrimitive {
  readonly id: PrimitiveId;
  readonly role: Role;
  readonly doc: string;
  readonly params: Params;
  readonly slots?: Readonly<Record<string, Slot>>;
  readonly needs?: readonly Need[];
  readonly build: (params: never, ctx: BuildContext, input: never) => unknown;
}

export class Library {
  readonly #byId = new Map<string, AnyPrimitive>();

  constructor(primitives: readonly AnyPrimitive[]) {
    for (const p of primitives) this.add(p);
  }

  add(p: AnyPrimitive): void {
    if (this.#byId.has(p.id)) throw new Error(`Primitive ${p.id} is registered twice.`);
    this.#byId.set(p.id, p);
  }

  get(id: string): AnyPrimitive {
    const p = this.#byId.get(id);
    if (p === undefined) throw new Error(`Unknown primitive ${id}.`);
    return p;
  }

  /** The primitives that can fill a slot of this role, in a stable order; given a place, only those whose needs it meets (`meets`). */
  forRole(role: Role, place?: Place): AnyPrimitive[] {
    return [...this.#byId.values()]
      .filter((p) => p.role === role && (place === undefined || meets(p.needs, place)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
