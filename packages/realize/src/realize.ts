// Turns a stored blueprint into geometry: resolve scale words to numbers,
// build each slot in dependency order, feed every slot its `on` slot's output.

import {
  type Anchor,
  type AnyPrimitive,
  type Blueprint,
  type BuildContext,
  type Built,
  type AnyKind,
  type Library,
  type MotionSpec,
  type Palette,
  type Part,
  type Role,
  type Skeleton,
  isStoredValue,
  rand,
  resolveScale,
  slotOrder,
} from "@gaia/schema";

export interface RealizeOptions {
  readonly seed: number;
  /** The kind's fact bindings for this instance, such as scale. */
  readonly facts: Readonly<Record<string, number>>;
}

export interface Realized {
  readonly parts: Part[];
  readonly motion: MotionSpec;
  readonly palette: Palette;
  /** Every slot's built output, such as a building's plan, for placing it in the world. */
  readonly slots: ReadonlyMap<string, BuiltSlot>;
}

const STILL: MotionSpec = { sway: 0, frequency: 0 };

/** The erased build signature. Stored values are checked against `params` before the call. */
type ErasedBuild = (params: unknown, ctx: BuildContext, input: unknown) => unknown;

/** Turns stored words into what `build` receives; each scale gets its own seeded unit. */
export function resolveParams(p: AnyPrimitive, stored: Blueprint["slots"][string]["params"], r: ReturnType<typeof rand>, where: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(p.params)) {
    const value = stored[name];
    if (!isStoredValue(field, value)) throw new Error(`${where}.${name} has an invalid value for ${p.id}.`);
    out[name] = field.type === "scale" ? resolveScale(field, value as string, r.fork(`${where}.${name}`).next()) : value;
  }
  return out;
}

const isSkeleton = (x: unknown): x is Skeleton => typeof x === "object" && x !== null && "limbs" in x && "tips" in x;
const isBuilt = (x: unknown): x is Built => typeof x === "object" && x !== null && "parts" in x && "anchors" in x;

function anchorsOf(source: unknown): readonly Anchor[] {
  if (isBuilt(source)) return source.anchors;
  if (isSkeleton(source)) return source.tips;
  throw new Error("An Ornament needs anchors from a Built or a Skeleton.");
}

/** One slot's built output, in the kind's dependency order. */
export interface BuiltSlot {
  readonly role: Role;
  readonly output: unknown;
}

/**
 * Builds every filled slot of a blueprint in dependency order, feeding each
 * slot its `on` slot's output. Kinds then gather the outputs they need.
 */
export function buildSlots(bp: Blueprint, k: AnyKind, lib: Library, opts: RealizeOptions): Map<string, BuiltSlot> {
  if (bp.kind !== k.id) throw new Error(`Blueprint ${bp.id} is a ${bp.kind}, not a ${k.id}.`);
  const root = rand(opts.seed);
  const built = new Map<string, BuiltSlot>();
  for (const name of slotOrder(k)) {
    const slot = k.slots[name];
    const filled = bp.slots[name];
    if (slot === undefined || filled === undefined) continue;
    if (filled.slots !== undefined) throw new Error(`${name}: nested slots are not supported by this realizer yet.`);
    const p = lib.get(filled.use);
    if (p.role !== slot.role) throw new Error(`${name} needs a ${slot.role}, not ${p.id}.`);
    let input: unknown = null;
    if (slot.on !== undefined) {
      const source = built.get(slot.on)?.output;
      // An optional source that is absent leaves its dependents unbuilt.
      if (source === undefined) continue;
      input = slot.role === "Ornament" ? anchorsOf(source) : source;
    }
    const params = resolveParams(p, filled.params, root.fork("params"), name);
    const ctx: BuildContext = { rand: root.fork(name), facts: opts.facts };
    built.set(name, { role: p.role, output: (p.build as ErasedBuild)(params, ctx, input) });
  }
  return built;
}

export function realize(bp: Blueprint, k: AnyKind, lib: Library, opts: RealizeOptions): Realized {
  const parts: Part[] = [];
  let motion: MotionSpec | undefined;
  let palette: Palette | undefined;
  const slots = buildSlots(bp, k, lib, opts);
  for (const { role, output } of slots.values()) {
    if (role === "Motion") motion = output as MotionSpec;
    else if (role === "Palette") palette = output as Palette;
    else if (isBuilt(output)) parts.push(...output.parts);
  }
  if (palette === undefined) throw new Error(`Blueprint ${bp.id} has no Palette slot to color it.`);
  return { parts, motion: motion ?? STILL, palette, slots };
}

export const triangleCount = (parts: readonly Part[]): number => parts.reduce((n, p) => n + p.indices.length / 3, 0);

/**
 * Joins parts that share a swatch and a collision into one, so a building of
 * many pieces draws in a few calls. Order follows each swatch's first part.
 */
export function mergeParts(parts: readonly Part[]): Part[] {
  const groups = new Map<string, Part[]>();
  for (const p of parts) {
    const key = `${p.swatch}|${p.collision}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p]);
    else list.push(p);
  }
  return [...groups.values()].map((list) => {
    if (list.length === 1) return list[0] as Part;
    const join = (pick: (p: Part) => Float32Array): Float32Array => {
      const out = new Float32Array(list.reduce((n, p) => n + pick(p).length, 0));
      let at = 0;
      for (const p of list) {
        out.set(pick(p), at);
        at += pick(p).length;
      }
      return out;
    };
    const indices = new Uint32Array(list.reduce((n, p) => n + p.indices.length, 0));
    let at = 0;
    let base = 0;
    for (const p of list) {
      for (let i = 0; i < p.indices.length; i++) indices[at + i] = (p.indices[i] as number) + base;
      at += p.indices.length;
      base += p.shade.length;
    }
    const first = list[0] as Part;
    return {
      swatch: first.swatch,
      collision: first.collision,
      positions: join((p) => p.positions),
      normals: join((p) => p.normals),
      indices,
      shade: join((p) => p.shade),
      tint: join((p) => p.tint),
      cutout: join((p) => p.cutout),
      channels: {
        loss: join((p) => p.channels.loss),
        droop: join((p) => p.channels.droop),
        wither: join((p) => p.channels.wither),
        glow: join((p) => p.channels.glow),
        pivot: join((p) => p.channels.pivot),
      },
    };
  });
}
