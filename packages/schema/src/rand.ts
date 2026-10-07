// Seeded randomness with named sub-streams. A primitive forks a stream per
// concern, so drawing more values in one place never shifts another.

export interface Rand {
  /** A float in [0, 1). */
  next(): number;
  range(low: number, high: number): number;
  /** An independent stream derived from this one's seed and a label. */
  fork(label: string): Rand;
  readonly seed: number;
}

export function hashString(text: string): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function rand(seed: number): Rand {
  let state = seed >>> 0;
  const next = (): number => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (low, high) => low + (high - low) * next(),
    fork: (label) => rand(hashString(`${seed}:${label}`)),
  };
}

/** Every item's seed comes from its path, so it is stable across runs and machines. */
export const seedOf = (id: string): number => hashString(id);
