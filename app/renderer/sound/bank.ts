// The world's recordings (`assets/`, CC0 field recordings cut into loops and
// single sounds; `assets/CREDITS.md` says whose and from where) and the
// score's (`assets/music/`), decoded for an audio context, with each one's
// own loudness from its manifest.

import wind from "./assets/wind.ogg";
import gusts from "./assets/gusts.ogg";
import leaves from "./assets/leaves.ogg";
import stream from "./assets/stream.ogg";
import mill from "./assets/mill.ogg";
import birds from "./assets/birds.ogg";
import evening from "./assets/birds-evening.ogg";
import crickets from "./assets/crickets.ogg";
import stepsGrass from "./assets/steps-grass.ogg";
import stepsDry from "./assets/steps-dry.ogg";
import stepsWood from "./assets/steps-wood.ogg";
import bookOpen from "./assets/book-open.ogg";
import bookShut from "./assets/book-shut.ogg";
import pageTurn from "./assets/page-turn.ogg";
import riffle from "./assets/riffle.ogg";
import manifest from "./assets/manifest.json";
import bed from "./assets/music/bed.ogg";
import melody from "./assets/music/melody.ogg";
import shimmer from "./assets/music/shimmer.ogg";
import minor from "./assets/music/minor.ogg";
import day1 from "./assets/music/phrase-day-1.ogg";
import day2 from "./assets/music/phrase-day-2.ogg";
import day3 from "./assets/music/phrase-day-3.ogg";
import day4 from "./assets/music/phrase-day-4.ogg";
import night1 from "./assets/music/phrase-night-1.ogg";
import night2 from "./assets/music/phrase-night-2.ogg";
import ruin1 from "./assets/music/phrase-ruin-1.ogg";
import score from "./assets/music/manifest.json";
import type { MusicBank, Phrase, Stem } from "./music.ts";
import { createShelf } from "./shelf.ts";
import type { Bank, Ground, Paper, Sprite } from "./soundscape.ts";
import type { Bed } from "./hearing.ts";

interface Entry {
  readonly lufs: number;
  readonly steps?: readonly { readonly start: number; readonly length: number }[];
}
const entries: Readonly<Record<string, { readonly loudness_lufs: number; readonly steps?: Entry["steps"] }>> = manifest.files;

/** A recording's loudness and, for footfalls, where each one lies, from the manifest. */
function entry(file: string): Entry {
  const e = entries[file.replace(/\.ogg$/, "")];
  if (e === undefined) throw new Error(`The sound manifest has no ${file}.`);
  return { lufs: e.loudness_lufs, ...(e.steps === undefined ? {} : { steps: e.steps }) };
}

const BEDS: Readonly<Record<Bed, string>> = { wind, gusts, leaves, stream, mill, birds, evening, crickets };
const BED_FILES: Readonly<Record<Bed, string>> = {
  wind: "wind.ogg",
  gusts: "gusts.ogg",
  leaves: "leaves.ogg",
  stream: "stream.ogg",
  mill: "mill.ogg",
  birds: "birds.ogg",
  evening: "birds-evening.ogg",
  crickets: "crickets.ogg",
};
const STEPS: Readonly<Record<Ground, readonly [string, string]>> = {
  grass: [stepsGrass, "steps-grass.ogg"],
  dry: [stepsDry, "steps-dry.ogg"],
  wood: [stepsWood, "steps-wood.ogg"],
};
const PAPER: Readonly<Record<Paper, readonly [string, string]>> = {
  open: [bookOpen, "book-open.ogg"],
  shut: [bookShut, "book-shut.ogg"],
  turn: [pageTurn, "page-turn.ogg"],
  riffle: [riffle, "riffle.ogg"],
};
const STEM_URLS: Readonly<Record<Stem, string>> = { bed, melody, shimmer, minor };
const PHRASE_URLS: Readonly<Record<Phrase, string>> = { "day-1": day1, "day-2": day2, "day-3": day3, "day-4": day4, "night-1": night1, "night-2": night2, "ruin-1": ruin1 };
/**
 * The beds are field recordings of air, water, birds and insects, which hold
 * little above 16 kHz: decoded at 32 kHz they take two thirds of the memory,
 * and the context plays them at its own rate.
 */
const BED_RATE = 32000;

async function decode(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the sound at ${url.slice(0, 80)}: ${response.status}.`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

/** The world's recordings for `ctx`: the beds on a shelf, decoded while they may be heard (kept once decoded with `keep`), the short sounds decoded now. */
export async function loadBank(ctx: BaseAudioContext, keep = false): Promise<Bank> {
  const bedDecoder = new OfflineAudioContext(2, 1, BED_RATE);
  const all = async <K extends string>(table: Readonly<Record<K, readonly [string, string]>>): Promise<Record<K, AudioBuffer>> =>
    Object.fromEntries(await Promise.all(Object.entries<readonly [string, string]>(table).map(async ([k, [url]]) => [k, await decode(ctx, url)] as const))) as Record<K, AudioBuffer>;
  const [stepBuffers, paper] = await Promise.all([all(STEPS), all(PAPER)]);
  const sprite = (g: Ground): Sprite => {
    const cuts = (entry(STEPS[g][1]).steps ?? []).map((s) => ({ at: s.start, length: s.length }));
    if (cuts.length === 0) throw new Error(`The sound manifest lists no footfalls in ${STEPS[g][1]}.`);
    return { buffer: stepBuffers[g], cuts };
  };
  const steps = { grass: sprite("grass"), dry: sprite("dry"), wood: sprite("wood") };
  const lufs = {
    ...Object.fromEntries((Object.keys(BED_FILES) as Bed[]).map((b) => [b, entry(BED_FILES[b]).lufs])),
    "steps-grass": entry(STEPS.grass[1]).lufs,
    "steps-dry": entry(STEPS.dry[1]).lufs,
    "steps-wood": entry(STEPS.wood[1]).lufs,
    ...Object.fromEntries((Object.keys(PAPER) as Paper[]).map((p) => [p, entry(PAPER[p][1]).lufs])),
  } as Bank["lufs"];
  return { beds: createShelf(BEDS, (url) => decode(bedDecoder, url), keep), steps, paper, lufs };
}

/** The score for `ctx`: the piece's parts and the phrases on shelves, decoded while they may be heard (kept once decoded with `keep`). */
export function loadMusic(ctx: BaseAudioContext, keep = false): MusicBank {
  return {
    stems: createShelf(STEM_URLS, (url) => decode(ctx, url), keep),
    phrases: createShelf(PHRASE_URLS, (url) => decode(ctx, url), keep),
    length: score.piece.seconds,
    lufs: { piece: score.piece.lufs, phrases: score.phrases.lufs },
  };
}
