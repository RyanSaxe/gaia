// Builds a sweep of a kind's parts: blueprints in which every part for each
// slot, every option of every part's params and every listed pairing of parts
// appears at least once. Choices follow a fixed order with no seed, so the
// same kind and library always give the same sweep. The proving ground places
// its sweeps so a person can walk up to every part, and tests realize them so
// every part gets built.

import { type AnyKind, type AnyPrimitive, type Blueprint, type Field, type FilledSlot, type Library, blueprintOf, isStoredValue, slotOrder } from "@gaia/schema";
import { validate } from "./planner.ts";

/** The place for one blueprint of a sweep, and the parts and values that place fixes. */
export interface SweepPlace {
  /** Features the place provides, such as running water. A part that needs more is never placed there. */
  readonly has?: readonly string[];
  /** The part the place fixes for each slot. A brook's land, for example, is a valley: `{ relief: "valley@1" }`. */
  readonly uses?: Readonly<Record<string, string>>;
  /** Values the place fixes per field path, such as `relief.stream`, as `DetailOptions.fixed` takes them. */
  readonly fixed?: Readonly<Record<string, string | boolean>>;
  /** A group the place belongs to, such as a health. The sweep covers every part under every label the places name. */
  readonly label?: string;
}

export interface SweepOptions {
  /** Slot pairs, such as `[["form", "crown"]]`, whose every pairing of parts must appear at least once. */
  readonly pairs?: readonly (readonly [string, string])[];
  /** One blueprint per place, in order. Without places, the sweep adds blueprints until nothing is left uncovered. */
  readonly places?: readonly SweepPlace[];
}

export interface Sweep {
  readonly blueprints: readonly Blueprint[];
  /** What no blueprint covers, in words. Empty when the sweep covers the kind. */
  readonly missing: readonly string[];
}

/** Most blueprints a sweep without places adds before it throws. Every current kind needs fewer than 30. */
const MOST_ROWS = 256;

type Value = string | boolean | string[];

function valuesOf(field: Exclude<Field, { type: "set" }>): (string | boolean)[] {
  if (field.type === "choice") return Object.keys(field.options);
  if (field.type === "scale") return field.levels.map((l) => l.words);
  return [false, true];
}

/** The coverage keys of one field value: the value itself, or each member a set includes. */
const keysOf = (value: Value | readonly string[]): readonly string[] => (Array.isArray(value) ? value : [String(value)]);

/** Every coverage key of a field: each option, level, flag value or member. */
const allKeys = (field: Field): string[] => (field.type === "set" ? Object.keys(field.members) : valuesOf(field).map(String));

/** A placed blueprint, with its place's label if it has one. */
export interface PlacedBlueprint {
  readonly blueprint: Blueprint;
  readonly label?: string;
}

export interface Coverage {
  /** Slot pairs whose every pairing of parts must appear, as in `SweepOptions.pairs`. */
  readonly pairs?: readonly (readonly [string, string])[];
  /** Labels every part must appear under. Without labels, every part must appear once. */
  readonly labels?: readonly string[];
}

/**
 * Lists in words what a kind's blueprints leave uncovered: each part of each slot, under each label when labels are
 * given, each option of each part's params, each optional slot no blueprint leaves out, and each listed pairing. A
 * sweep's `missing` is this list for its blueprints. A world's blueprints, labelled by their places, can be checked
 * the same way.
 */
export function missingFrom(k: AnyKind, lib: Library, placed: readonly PlacedBlueprint[], coverage: Coverage = {}): string[] {
  const labels = coverage.labels ?? [];
  const under = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const absent = new Set<string>();
  const paired = new Set<string>();
  for (const { blueprint, label } of placed) {
    for (const name of Object.keys(k.slots)) {
      const filled = blueprint.slots[name];
      if (filled === undefined) {
        absent.add(name);
        continue;
      }
      const key = `${name}=${filled.use}`;
      under.set(key, (under.get(key) ?? new Set()).add(label ?? ""));
      for (const [param, value] of Object.entries(filled.params)) for (const v of keysOf(value)) seen.add(`${key}.${param}=${v}`);
    }
    for (const [a, b] of coverage.pairs ?? []) {
      const pa = blueprint.slots[a]?.use;
      const pb = blueprint.slots[b]?.use;
      if (pa !== undefined && pb !== undefined) paired.add(`${a}=${pa}+${b}=${pb}`);
    }
  }
  const out: string[] = [];
  for (const name of slotOrder(k)) {
    const s = k.slots[name] as AnyKind["slots"][string];
    for (const p of lib.forRole(s.role)) {
      const at = under.get(`${name}=${p.id}`);
      if (labels.length === 0) {
        if (at === undefined) out.push(`${name}: ${p.id}`);
      } else for (const l of labels) if (!(at?.has(l) ?? false)) out.push(`${name}: ${p.id} (${l})`);
      for (const [param, f] of Object.entries(p.params)) for (const key of allKeys(f)) if (!seen.has(`${name}=${p.id}.${param}=${key}`)) out.push(`${name}: ${p.id} ${param} "${key}"`);
    }
    if (s.optional && !absent.has(name)) out.push(`${name} left out`);
  }
  for (const [a, b] of coverage.pairs ?? []) {
    const parts = (name: string): AnyPrimitive[] => lib.forRole((k.slots[name] as AnyKind["slots"][string]).role);
    for (const pa of parts(a)) for (const pb of parts(b)) if (!paired.has(`${a}=${pa.id}+${b}=${pb.id}`)) out.push(`${a} ${pa.id} with ${b} ${pb.id}`);
  }
  return out;
}

/**
 * Sweeps a kind's parts from a library. For each slot of each blueprint, it picks the part with the most left to
 * cover. The ranking prefers, in order, a part that needs something its place provides, a part that completes a
 * listed pairing with a part already chosen, a part not yet placed under the place's label, a part with pairings
 * left for later slots, the part with the most options left, and the least used part. Each param gets its first
 * value not yet covered. Once all are covered, it gets the value at the part's use count, modulo the number of
 * values. A set gets every other member, alternating between uses. An optional slot is left out once no part has
 * anything left to cover. Every blueprint is valid for the kind.
 */
export function sweep(k: AnyKind, lib: Library, options: SweepOptions = {}): Sweep {
  const places = options.places;
  const pairs = options.pairs ?? [];
  for (const pair of pairs) for (const name of pair) if (k.slots[name] === undefined) throw new Error(`${k.id} has no slot ${name} to pair.`);
  const labels = [...new Set((places ?? []).flatMap((p) => (p.label === undefined ? [] : [p.label])))];
  const order = slotOrder(k);
  const partsOf = (name: string): AnyPrimitive[] => lib.forRole((k.slots[name] as AnyKind["slots"][string]).role);

  /** The labels each part has appeared under, by `slot=id`. An unlabelled sweep uses the label "". */
  const labelsOf = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const used = new Map<string, number>();
  const paired = new Set<string>();
  const part = (name: string, p: AnyPrimitive): string => `${name}=${p.id}`;
  const option = (name: string, p: AnyPrimitive, param: string, key: string): string => `${part(name, p)}.${param}=${key}`;
  const pairing = (a: string, pa: string, b: string, pb: string): string => `${a}=${pa}+${b}=${pb}`;

  const uncovered = (name: string, p: AnyPrimitive, label: string | undefined): boolean => {
    const under = labelsOf.get(part(name, p));
    if (labels.length === 0) return under === undefined;
    return label !== undefined && !(under?.has(label) ?? false);
  };
  const optionsLeft = (name: string, p: AnyPrimitive): number => Object.entries(p.params).reduce((n, [param, f]) => n + allKeys(f).filter((key) => !seen.has(option(name, p, param, key))).length, 0);
  /** Uncovered listed pairings for `p` in slot `name`. `now` counts pairings with a partner already in this blueprint, and `later` counts those with partners in slots not yet filled. */
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
      // Rank parts by what they have left to cover, most pressing first, then by least use. The library's order breaks ties.
      const ranked = fitting.map((p) => {
        const pending = pairsLeft(name, p, slots);
        const fresh = uncovered(name, p, label);
        const left = optionsLeft(name, p);
        const wanted = fresh || left > 0 || pending.now > 0 || pending.later > 0;
        return { p, wanted, rank: [(p.needs?.length ?? 0) > 0 && wanted ? 1 : 0, pending.now, fresh ? 1 : 0, pending.later, left, -(used.get(part(name, p)) ?? 0)] };
      });
      if (s.optional && settled === undefined && !ranked.some((r) => r.wanted)) continue;
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
      labelsOf.set(key, (labelsOf.get(key) ?? new Set()).add(label ?? ""));
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

  const blueprints: Blueprint[] = [];
  const missingNow = (): string[] => missingFrom(k, lib, blueprints.map((blueprint, i) => ({ blueprint, ...(places?.[i]?.label === undefined ? {} : { label: places[i].label }) })), { pairs, labels });
  if (places !== undefined) {
    for (const place of places) blueprints.push(blueprintAt(place));
    return { blueprints, missing: missingNow() };
  }
  for (let missing = missingNow(); missing.length > 0; missing = missingNow()) {
    if (blueprints.length === MOST_ROWS) throw new Error(`The sweep of ${k.id} still lacks ${missing.join(", ")} after ${MOST_ROWS} blueprints.`);
    blueprints.push(blueprintAt(undefined));
  }
  return { blueprints, missing: [] };
}
