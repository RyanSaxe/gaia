// The type space a kind and a library declare: its size, defaults, and a
// uniform sample. Everything here is read off the field declarations.

import type { AnyPrimitive, Field, FilledSlot, Kind, Library } from "@gaia/schema";

type StoredParams = Record<string, string | boolean | string[]>;

export function fieldSize(f: Field): number {
  switch (f.type) {
    case "scale":
      return f.levels.length;
    case "choice":
      return Object.keys(f.options).length;
    case "flag":
      return 2;
    case "set":
      return 2 ** Object.keys(f.members).length;
  }
}

export const primitiveSize = (p: AnyPrimitive): number => Object.values(p.params).reduce((n, f) => n * fieldSize(f), 1);

/** How many distinct blueprints the kind admits with this library. A slot can be present only if its `on` slot is. */
export function blueprintCount(k: Kind, lib: Library): number {
  const names = Object.keys(k.slots);
  const optional = names.filter((n) => k.slots[n]?.optional);
  let total = 0;
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const present = new Set(names.filter((n) => !k.slots[n]?.optional || (mask >> optional.indexOf(n)) & 1));
    if ([...present].some((n) => { const on = k.slots[n]?.on; return on !== undefined && !present.has(on); })) continue;
    total += [...present].reduce((product, n) => {
      const role = k.slots[n]?.role;
      return role === undefined ? product : product * lib.forRole(role).reduce((sum, p) => sum + primitiveSize(p), 0);
    }, 1);
  }
  return total;
}

/** A sensible starting value: the middle of a scale, the first choice. */
export function defaultParams(p: AnyPrimitive): StoredParams {
  const out: StoredParams = {};
  for (const [name, f] of Object.entries(p.params)) {
    if (f.type === "scale") out[name] = f.levels[Math.floor((f.levels.length - 1) / 2)]?.words ?? "";
    else if (f.type === "choice") out[name] = Object.keys(f.options)[0] ?? "";
    else if (f.type === "flag") out[name] = false;
    else out[name] = [];
  }
  return out;
}

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

/** Samples every field uniformly: presence, primitive, and each parameter. */
export function randomSlots(k: Kind, lib: Library, random: () => number): Record<string, FilledSlot> {
  const slots: Record<string, FilledSlot> = {};
  for (const [name, s] of Object.entries(k.slots)) {
    if (s.optional && random() < 0.5) continue;
    if (s.on !== undefined && !(s.on in slots)) continue;
    const p = pick(lib.forRole(s.role), random);
    const params: StoredParams = {};
    for (const [param, f] of Object.entries(p.params)) {
      if (f.type === "scale") params[param] = pick(f.levels, random).words;
      else if (f.type === "choice") params[param] = pick(Object.keys(f.options), random);
      else if (f.type === "flag") params[param] = random() < 0.5;
      else params[param] = Object.keys(f.members).filter(() => random() < 0.5);
    }
    slots[name] = { use: p.id, params };
  }
  return slots;
}
