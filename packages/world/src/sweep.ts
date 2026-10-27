// A sweep of a kind's parts: blueprints in which every part that can fill
// each slot, every option of every part's settings and every listed pairing
// of parts stands at least once, chosen in order with no seed, so the same
// kind and library always give the same sweep. The proving ground stands
// its sweeps so a person can walk up to every part, and tests realize them
// so every part is built.

import { type AnyKind, type AnyPrimitive, type Blueprint, type Field, type FilledSlot, type Library, blueprintOf, isStoredValue, slotOrder } from "@gaia/schema";
import { validate } from "./planner.ts";

/** Where one blueprint of a sweep stands, and what that place settles. */
export interface SweepPlace {
  /** What the place has that a part may need, such as running water: a part needing more is never stood there. */
  readonly has?: readonly string[];
  /** The part the place settles for a slot, by slot: a brook's land is a valley (`{ relief: "valley@1" }`). */
  readonly uses?: Readonly<Record<string, string>>;
  /** Values the place settles, per field path (`relief.stream`), as `DetailOptions.fixed` takes them. */
  readonly fixed?: Readonly<Record<string, string | boolean>>;
  /** A group the place belongs to, such as a health: every part stands under every label the places name. */
  readonly label?: string;
}

export interface SweepOptions {
  /** Slot pairs whose every pairing of parts stands at least once, such as `[["form", "crown"]]`. */
  readonly pairs?: readonly (readonly [string, string])[];
  /** One blueprint per place, in order. Without places the sweep stands blueprints until nothing is left uncovered. */
  readonly places?: readonly SweepPlace[];
}

export interface Sweep {
  readonly blueprints: readonly Blueprint[];
  /** What no blueprint stands, in words: empty when the sweep covers the kind. */
  readonly missing: readonly string[];
}

/** The most blueprints a sweep without places stands before it gives up: every kind today needs under 30. */
const MOST_ROWS = 256;

type Value = string | boolean | string[];

/** A field's values in the sweep's order: a scale's levels from low to high, a choice's keys and a flag's false then true. */
function valuesOf(field: Exclude<Field, { type: "set" }>): (string | boolean)[] {
  if (field.type === "choice") return Object.keys(field.options);
  if (field.type === "scale") return field.levels.map((l) => l.words);
  return [false, true];
}

/** What one value of a field covers: the value itself, or each member a set includes. */
const keysOf = (value: Value): string[] => (Array.isArray(value) ? value : [String(value)]);

/**
 * Sweeps a kind's parts from a library. Each blueprint takes, slot by slot, the part with the most left to cover:
 * first a part that needs something of its place where the place has it, then one that completes a listed pairing,
 * then one not yet stood under the place's label, then the one with the most options left. Each setting takes its
 * first option not yet stood, and once all have, the option its part's count of uses comes round to; a set takes
 * every other member, alternating. An optional slot is left out once it has nothing left to cover. Every blueprint
 * is valid for the kind.
 */
export function sweep(k: AnyKind, lib: Library, options: SweepOptions = {}): Sweep {
  const places = options.places;
  const pairs = options.pairs ?? [];
  for (const pair of pairs) for (const name of pair) if (k.slots[name] === undefined) throw new Error(`${k.id} has no slot ${name} to pair.`);
  const labels = [...new Set((places ?? []).flatMap((p) => (p.label === undefined ? [] : [p.label])))];
  const order = slotOrder(k);
  const partsOf = (name: string): AnyPrimitive[] => lib.forRole((k.slots[name] as AnyKind["slots"][string]).role);

  /** Each part's labels it has stood under, by `slot=id`; an unlabelled sweep's parts stand under "". */
  const stood = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const used = new Map<string, number>();
  const absent = new Set<string>();
  const paired = new Set<string>();
  const part = (name: string, p: AnyPrimitive): string => `${name}=${p.id}`;
  const option = (name: string, p: AnyPrimitive, param: string, key: string): string => `${part(name, p)}.${param}=${key}`;
  const pairing = (a: string, pa: string, b: string, pb: string): string => `${a}=${pa}+${b}=${pb}`;

  const unstood = (name: string, p: AnyPrimitive, label: string | undefined): boolean => {
    const under = stood.get(part(name, p));
    if (labels.length === 0) return under === undefined;
    return label !== undefined && !(under?.has(label) ?? false);
  };
  const optionsLeft = (name: string, p: AnyPrimitive): number =>
    Object.entries(p.params).reduce((n, [param, f]) => n + (f.type === "set" ? Object.keys(f.members) : valuesOf(f).map(String)).filter((key) => !seen.has(option(name, p, param, key))).length, 0);
  /** The listed pairings with `p` in `name` left to stand: with a partner already chosen in this blueprint, or with any partner still to come. */
  const pairsLeft = (name: string, p: AnyPrimitive, slots: Readonly<Record<string, FilledSlot>>): { now: number; later: number } => {
    let now = 0;
    let later = 0;
    for (const [a, b] of pairs) {
      const other = a === name ? b : b === name ? a : undefined;
      if (other === undefined) continue;
      const key = (q: string): string => (a === name ? pairing(a, p.id, b, q) : pairing(a, q, b, p.id));
      const chosen = slots[other]?.use;
      if (chosen !== undefined) now += paired.has(key(chosen)) ? 0 : 1;
      else later += partsOf(other).filter((q) => !paired.has(key(q.id))).length;
    }
    return { now, later };
  };

  const valueFor = (name: string, p: AnyPrimitive, param: string, field: Field, uses: number): Value => {
    if (field.type === "set") return Object.keys(field.members).filter((_, i) => i % 2 === uses % 2);
    const values = valuesOf(field);
    return values.find((v) => !seen.has(option(name, p, param, String(v)))) ?? (values[uses % values.length] as string | boolean);
  };

  const blueprintAt = (place: SweepPlace | undefined): Blueprint => {
    const slots: Record<string, FilledSlot> = {};
    const label = place?.label;
    for (const name of order) {
      const s = k.slots[name] as AnyKind["slots"][string];
      if (s.on !== undefined && !(s.on in slots)) continue;
      const settled = place?.uses?.[name];
      const fitting = settled !== undefined ? [lib.get(settled)] : lib.forRole(s.role, place === undefined ? undefined : { has: place.has ?? [] });
      if (fitting.some((p) => p.role !== s.role)) throw new Error(`${k.id}'s ${name} needs a ${s.role}, not ${settled}.`);
      if (fitting.length === 0) {
        if (s.optional) continue;
        throw new Error(`No ${s.role} part fits the place of ${k.id}'s ${name}.`);
      }
      // What each part has left to cover here, most pressing first, then the least used; the library's order breaks ties.
      const ranked = fitting.map((p) => {
        const pending = pairsLeft(name, p, slots);
        const fresh = unstood(name, p, label);
        const left = optionsLeft(name, p);
        const wanted = fresh || left > 0 || pending.now > 0 || pending.later > 0;
        return { p, wanted, rank: [(p.needs?.length ?? 0) > 0 && wanted ? 1 : 0, pending.now, fresh ? 1 : 0, pending.later, left, -(used.get(part(name, p)) ?? 0)] };
      });
      if (s.optional && settled === undefined && !ranked.some((r) => r.wanted)) {
        absent.add(name);
        continue;
      }
      const ahead = (a: readonly number[], b: readonly number[]): boolean => {
        const i = a.findIndex((x, j) => x !== b[j]);
        return i >= 0 && (a[i] as number) > (b[i] as number);
      };
      const best = ranked.reduce((a, b) => (ahead(b.rank, a.rank) ? b : a)).p;
      const uses = used.get(part(name, best)) ?? 0;
      const params: Record<string, Value> = {};
      for (const [param, field] of Object.entries(best.params)) {
        const fixed = place?.fixed?.[`${name}.${param}`];
        if (fixed !== undefined && !isStoredValue(field, fixed)) throw new Error(`${String(fixed)} is not a value of ${best.id}'s ${param}.`);
        params[param] = fixed ?? valueFor(name, best, param, field, uses);
      }
      slots[name] = { use: best.id, params };
      const key = part(name, best);
      used.set(key, uses + 1);
      stood.set(key, (stood.get(key) ?? new Set()).add(label ?? ""));
      for (const [param, value] of Object.entries(params)) for (const v of keysOf(value)) seen.add(option(name, best, param, v));
    }
    for (const [a, b] of pairs) {
      const pa = slots[a]?.use;
      const pb = slots[b]?.use;
      if (pa !== undefined && pb !== undefined) paired.add(pairing(a, pa, b, pb));
    }
    const bp = blueprintOf(k.id, slots);
    const problems = validate(bp, k, lib);
    if (problems.length > 0) throw new Error(`The sweep of ${k.id} stood an invalid blueprint: ${problems.join(" ")}`);
    return bp;
  };

  const missingNow = (): string[] => {
    const out: string[] = [];
    for (const name of order) {
      const s = k.slots[name] as AnyKind["slots"][string];
      for (const p of partsOf(name)) {
        const under = stood.get(part(name, p));
        if (labels.length === 0) {
          if (under === undefined) out.push(`${name}: ${p.id}`);
        } else for (const l of labels) if (!(under?.has(l) ?? false)) out.push(`${name}: ${p.id} (${l})`);
        for (const [param, f] of Object.entries(p.params)) {
          for (const key of f.type === "set" ? Object.keys(f.members) : valuesOf(f).map(String)) if (!seen.has(option(name, p, param, key))) out.push(`${name}: ${p.id} ${param} "${key}"`);
        }
      }
      if (s.optional && !absent.has(name)) out.push(`${name} left out`);
    }
    for (const [a, b] of pairs) {
      for (const pa of partsOf(a)) for (const pb of partsOf(b)) if (!paired.has(pairing(a, pa.id, b, pb.id))) out.push(`${a} ${pa.id} with ${b} ${pb.id}`);
    }
    return out;
  };

  if (places !== undefined) {
    const blueprints = places.map(blueprintAt);
    return { blueprints, missing: missingNow() };
  }
  const blueprints: Blueprint[] = [];
  for (let missing = missingNow(); missing.length > 0; missing = missingNow()) {
    if (blueprints.length === MOST_ROWS) throw new Error(`The sweep of ${k.id} still lacks ${missing.join(", ")} after ${MOST_ROWS} blueprints.`);
    blueprints.push(blueprintAt(undefined));
  }
  return { blueprints, missing: [] };
}
