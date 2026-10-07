// The type language. Every field is a closed set, because Jev can only pick
// among options Gaia supplies. Each field carries the instruction Jev reads.

export interface ChoiceField<K extends string = string> {
  readonly type: "choice";
  readonly ask: string;
  readonly options: Readonly<Record<K, string>>;
}

export interface Level<W extends string = string> {
  readonly words: W;
  readonly value: number;
}

export interface ScaleField<W extends string = string> {
  readonly type: "scale";
  readonly ask: string;
  /** Ordered from the lowest value to the highest. */
  readonly levels: readonly Level<W>[];
}

export interface FlagField {
  readonly type: "flag";
  readonly ask: string;
  readonly yes: string;
  readonly no: string;
}

export interface SetField<K extends string = string> {
  readonly type: "set";
  readonly ask: string;
  readonly members: Readonly<Record<K, string>>;
}

export type Field = ChoiceField | ScaleField | FlagField | SetField;
export type Params = Readonly<Record<string, Field>>;

/** What Gaia stores in a blueprint: the words Jev chose. */
export type StoredValue<F extends Field> =
  F extends ChoiceField<infer K> ? K
  : F extends ScaleField<infer W> ? W
  : F extends FlagField ? boolean
  : F extends SetField<infer K> ? K[]
  : never;

/** What a primitive's build receives: scales become numbers. */
export type ResolvedValue<F extends Field> =
  F extends ScaleField ? number : StoredValue<F>;

export type Stored<P extends Params> = { readonly [N in keyof P]: StoredValue<P[N]> };
export type Resolved<P extends Params> = { readonly [N in keyof P]: ResolvedValue<P[N]> };

const MAX_CHOICE = 255;
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;

function requireAsk(ask: string): void {
  if (ask.trim().length === 0) throw new Error("Every field needs an instruction for Jev.");
}

export const t = {
  choice<const K extends string>(ask: string, options: Record<K, string>): ChoiceField<K> {
    requireAsk(ask);
    const count = Object.keys(options).length;
    if (count < 2 || count > MAX_CHOICE) {
      throw new Error(`A choice needs 2 to ${MAX_CHOICE} options; "${ask}" has ${count}.`);
    }
    return { type: "choice", ask, options };
  },

  /** Levels are words with values. Jev judges the words, never the numbers. */
  scale<const W extends string>(ask: string, levels: Record<W, number>): ScaleField<W> {
    requireAsk(ask);
    const sorted = (Object.entries(levels) as [W, number][])
      .map(([words, value]) => ({ words, value }))
      .sort((a, b) => a.value - b.value);
    if (sorted.length < MIN_LEVELS || sorted.length > MAX_LEVELS) {
      throw new Error(`A scale needs ${MIN_LEVELS} to ${MAX_LEVELS} levels; "${ask}" has ${sorted.length}.`);
    }
    for (const level of sorted) {
      if (/^[\d\s.,-]+$/.test(level.words)) {
        throw new Error(`Scale level "${level.words}" in "${ask}" must be words, not a number.`);
      }
    }
    return { type: "scale", ask, levels: sorted };
  },

  flag(ask: string, yes: string, no: string): FlagField {
    requireAsk(ask);
    return { type: "flag", ask, yes, no };
  },

  set<const K extends string>(ask: string, members: Record<K, string>): SetField<K> {
    requireAsk(ask);
    return { type: "set", ask, members };
  },
};

/**
 * Picks the exact number for a stored scale level. The seed places it between
 * the level and halfway to each neighbor, so instances of one blueprint vary
 * slightly and each one is identical on every run.
 */
export function resolveScale(field: ScaleField, words: string, unit: number): number {
  const index = field.levels.findIndex((l) => l.words === words);
  const level = field.levels[index];
  if (level === undefined) throw new Error(`"${words}" is not a level of "${field.ask}".`);
  const below = field.levels[index - 1]?.value ?? level.value;
  const above = field.levels[index + 1]?.value ?? level.value;
  const low = (below + level.value) / 2;
  const high = (above + level.value) / 2;
  return low + (high - low) * unit;
}

export function isStoredValue(field: Field, value: unknown): boolean {
  switch (field.type) {
    case "choice":
      return typeof value === "string" && value in field.options;
    case "scale":
      return typeof value === "string" && field.levels.some((l) => l.words === value);
    case "flag":
      return typeof value === "boolean";
    case "set":
      return Array.isArray(value) && value.every((m) => typeof m === "string" && m in field.members);
  }
}
