// Stores the person's music and world volume, each from 0 (silent) to 1 (as
// mixed). The slip's sliders set them, the sound reads them, and
// `localStorage` keeps them so a return visit sounds the same.

export interface Levels {
  readonly music: number;
  readonly world: number;
}

export interface LevelStore {
  get(): Levels;
  set(part: keyof Levels, value: number): void;
  /** Calls `listener` now and after every change. */
  watch(listener: (levels: Levels) => void): void;
}

const KEY = "gaia.sound";
const FULL: Levels = { music: 1, world: 1 };
const clamp01 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

function stored(): Levels {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Levels> | null;
    return kept === null ? FULL : { music: clamp01(kept.music), world: clamp01(kept.world) };
  } catch {
    return FULL;
  }
}

/** Converts a slider position to a gain by squaring it, so its middle is about 12 dB down and its travel sounds even. */
export const gainOf = (level: number): number => level * level;

let store: LevelStore | null = null;

/** Returns the page's single level store, creating it on first call. */
export function soundLevels(): LevelStore {
  if (store !== null) return store;
  let levels = stored();
  const listeners: ((levels: Levels) => void)[] = [];
  store = {
    get: () => levels,
    set(part, value) {
      levels = { ...levels, [part]: clamp01(value) };
      try {
        localStorage.setItem(KEY, JSON.stringify(levels));
      } catch {
        // A page without storage keeps the levels until it closes.
      }
      for (const l of listeners) l(levels);
    },
    watch(listener) {
      listeners.push(listener);
      listener(levels);
    },
  };
  return store;
}
