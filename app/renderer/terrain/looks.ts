// The looks a codebase's world chooses among: each option's words, which Jev
// reads, and the facts it suits, which only the stand-in judge reads. Keys
// are the lab's hand-filled presets, so a choice names a blueprint. Lands are
// biome blueprints of their own: a landform with a ground cover.

import { type Blueprint, type FilledSlot, type PrimitiveId, blueprintOf } from "@gaia/schema";
import type { Look, Looks } from "@gaia/world";

const look = (doc: string, ...suits: string[]): Look => ({ doc, suits });

/** A biome blueprint: a relief with its stored words and a ground cover. */
const land = (use: string, params: FilledSlot["params"], cover: string): Blueprint =>
  blueprintOf("biome", {
    relief: { use: use as PrimitiveId, params },
    cover: { use: "ground-cover@1", params: { cover, length: "natural", wildflowers: "a scattering" } },
    natives: { use: "native-families@1", params: { families: [] } },
  });

/** Each land's blueprint and the words Jev reads about it. */
export const LANDS: Readonly<Record<string, { readonly look: Look; readonly biome: Blueprint }>> = {
  "Brook valley": {
    look: look("A winding valley with a brook running through lush grass: busy ground where things flow.", "terrain", "water", "flow", "world"),
    biome: land("valley@1", { depth: "moderate", width: "open", run: "north-south", fall: "gentle", meander: "winding", stream: "brook" }, "lush grass"),
  },
  "Clover hills": {
    look: look("Rolling hills in clover, round and moderately spaced.", "primitives", "geometry"),
    biome: land("rolling-hills@1", { height: "rolling", breadth: "moderately spaced", roughness: "softly uneven", grain: "round" }, "clover meadow"),
  },
  "Silver terraces": {
    look: look("A terraced hillside of silver grass, each step level and ordered.", "test", "realize", "kinds"),
    biome: land("terraces@1", { form: "terraced hill", rise: "waist-high", climb: "a hillside", facing: "south", edge: "soft and grassy" }, "silver grass"),
  },
  "Mossy basin": {
    look: look("A deep mossy bowl around a still pond.", "rust", "engine", "schema"),
    biome: land("basin@1", { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true }, "moss"),
  },
  "Heather moor": {
    look: look("An open moor of heather, softly undulating: quiet ground for reading.", "docs", "markdown", "decisions"),
    biome: land("meadow@1", { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" }, "heather"),
  },
  "Meandering vale": {
    look: look("A broad, shallow vale with a trickle meandering through clover.", "render", "renderer", "app"),
    biome: land("valley@1", { depth: "shallow", width: "broad", run: "east-west", fall: "nearly level", meander: "strongly meandering", stream: "trickle" }, "clover meadow"),
  },
  "Golden dunes": {
    look: look("Low golden dunes of steppe grass, rippled by the west wind.", "config", "data", "json", "tools"),
    biome: land("dunes@1", { height: "low dunes", spacing: "even", wind: "from the west", wander: "wavering" }, "golden steppe"),
  },
  "Pond meadow": {
    look: look("A wide shallow dip holding a pond, melting into lush grass.", "service", "main", "flora"),
    biome: land("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true }, "lush grass"),
  },
  "Broad downs": {
    look: look("Broad, sweeping downs of silver grass, smooth and open.", "packages"),
    biome: land("rolling-hills@1", { height: "gentle", breadth: "broad and sweeping", roughness: "smooth", grain: "diagonal" }, "silver grass"),
  },
  "Home lawn": {
    look: look("A lawn-flat meadow, level and open: the ground everything else starts from.", "script", "root", "repository"),
    biome: land("meadow@1", { undulation: "flat as a lawn", tilt: "slightly tilted", facing: "south" }, "lush grass"),
  },
};

/** What grows on a file's patch: a tree species, or open ground that its directory's cover fills. */
export const VIBES: Readonly<Record<string, Look>> = {
  "Lantern willow": look("Weeping willows that hang lanterns of light: a file much of the code leans on.", "hub", "large", "render", "light", "water"),
  Fir: look("Dark, steady firs: a sturdy file that tests or guards others.", "test", "rust", "engine", "medium"),
  Cherry: look("Cherry trees in blossom: a small, lively file of the interface.", "small", "renderer", "lab", "app", "typescript"),
  "Autumn maple": look("Broad maples turning gold: a substantial file of logic.", "source", "medium", "large", "typescript"),
  "Open meadow": look("No trees: open ground in the area's own cover, for a file that describes or configures rather than acts.", "docs", "config", "data", "script", "markdown", "json", "yaml", "toml"),
};

/** The vibe keys that grow trees, by flora preset name. */
export const TREE_VIBES: readonly string[] = ["Lantern willow", "Fir", "Cherry", "Autumn maple"];

export const BUILDINGS: Readonly<Record<string, Look>> = {
  "Thatched cottage": look("a thatched cottage, small and homely", "module", "small", "leaf"),
  "Stone croft": look("a low stone croft, sturdy and plain", "crate", "rust", "medium", "engine"),
  "Storybook house": look("a crooked storybook house with a tall chimney", "app", "service", "renderer", "main", "preload"),
  Watermill: look("a watermill whose wheel turns while the code is healthy: one that turns input into output", "realize", "render", "world"),
  "Archive tower": look("a house with an archive tower that rises with what depends on it: one that keeps records", "surface", "kinds"),
};

export const LANDMARKS: Readonly<Record<string, Look>> = {
  "Lantern tower": look("a round lookout tower crowned with a lantern room", "terrain", "renderer", "light"),
  "Stone ring": look("a ring of towering standing stones around a king stone", "hub", "schema"),
  "Great oak": look("a vast spreading oak", "hub", "primitives"),
  "Battlemented keep": look("a tall square keep with battlements", "crate", "rust", "engine"),
  "Great willow": look("a great willow, gnarled and slow", "root", "repository"),
};

export const TRAILS: Readonly<Record<string, Look>> = {
  "Worn footpath": look("A well-trodden footpath two could walk, gently curving, with footbridges.", "hub", "package", "busy"),
  "Stone-edged path": look("A beaten-earth path edged with stones, with stepping stones over water.", "crate", "surface", "app"),
  "Faint wandering track": look("A faint, half grassed-over track that meanders.", "leaf", "module", "small"),
};

export const WORLDS: Readonly<Record<string, Look>> = {
  "Meadow morning": look("Clear spring morning light over green meadows, a light breeze.", "typescript", "busy", "young"),
  "Amber steppe": look("Warm amber light over dry steppe, late summer.", "old", "large"),
  "Frost hollow": look("Cold winter light, frost on the ground.", "quiet", "old"),
  "Firefly dusk": look("A long golden dusk with fireflies.", "rust", "quiet"),
  "Monsoon terraces": look("Soft wet light over green terraces in the rains.", "python", "busy"),
  "Heather moor": look("Grey-violet light over heather moors and wind.", "small", "quiet"),
};

export const LOOKS: Looks = {
  world: WORLDS,
  land: Object.fromEntries(Object.entries(LANDS).map(([k, l]) => [k, l.look])),
  vibe: VIBES,
  building: BUILDINGS,
  landmark: LANDMARKS,
  trail: TRAILS,
};
