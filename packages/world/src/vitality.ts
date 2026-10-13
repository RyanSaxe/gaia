// Vitality pooled over the land. A thing's own vitality is Jev's quality from
// the understanding pass (`layoutWorld`); a folder's, as the field map and the
// minimap wash it, pools its files' by the ground each holds.

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A file as a part of the land: the directory it lies in, its vitality, and its size (its lines, or the ground its patch holds). */
export interface VitalPart {
  readonly area: string;
  readonly vitality: number;
  readonly size: number;
}

/**
 * The vitality of a whole made of parts: their vitality weighted by size, so
 * a large tired file weighs more than a small thriving one and the whole
 * reads as the share of it that thrives. A whole with nothing in it is 1.
 */
export function pooledVitality(parts: Iterable<Pick<VitalPart, "vitality" | "size">>): number {
  let sum = 0;
  let weight = 0;
  for (const p of parts) {
    const w = Math.max(0, p.size);
    sum += clamp01(p.vitality) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 1;
}

/**
 * Every directory's vitality, by its path ("" for the whole world): its
 * files' and its subdirectories' files' vitality, pooled by size
 * (`pooledVitality`). A directory with no files of its own or below it is
 * absent.
 */
export function areaVitality(parts: readonly VitalPart[]): ReadonlyMap<string, number> {
  const sums = new Map<string, { sum: number; weight: number }>();
  for (const p of parts) {
    const w = Math.max(0, p.size);
    const dirs = p.area.split("/").filter(Boolean);
    for (let k = 0; k <= dirs.length; k++) {
      const path = dirs.slice(0, k).join("/");
      const s = sums.get(path) ?? { sum: 0, weight: 0 };
      s.sum += clamp01(p.vitality) * w;
      s.weight += w;
      sums.set(path, s);
    }
  }
  return new Map([...sums].map(([path, s]) => [path, s.weight > 0 ? s.sum / s.weight : 1]));
}

/**
 * Every directory's own ground's vitality, by its path: the files directly
 * in it, pooled by size; a directory with no files of its own takes all of
 * its subdirectories' (`areaVitality`). What a map washes each area's own
 * ground with.
 */
export function groundVitality(parts: readonly VitalPart[]): ReadonlyMap<string, number> {
  const whole = areaVitality(parts);
  const own = new Map<string, VitalPart[]>();
  for (const p of parts) own.set(p.area, [...(own.get(p.area) ?? []), p]);
  return new Map([...whole].map(([path, v]) => [path, own.has(path) ? pooledVitality(own.get(path) ?? []) : v]));
}
