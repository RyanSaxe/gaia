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
    look: look("A winding valley through lush grass: busy core logic, where work passes from file to file along the directory's own imports.", "terrain", "water", "flow", "world"),
    biome: land("valley@1", { depth: "moderate", width: "open", run: "north-south", fall: "gentle", meander: "winding", stream: "brook" }, "lush grass"),
  },
  "Clover hills": {
    look: look("Rolling hills in clover, round and moderately spaced: a family of many small, similar pieces made alike, such as shapes or parts.", "primitives", "geometry"),
    biome: land("rolling-hills@1", { height: "rolling", breadth: "moderately spaced", roughness: "softly uneven", grain: "round" }, "clover meadow"),
  },
  "Silver terraces": {
    look: look("A terraced hillside of silver grass, each step level and ordered: code that checks other code, or runs in ordered stages, such as tests or a pipeline.", "test", "realize", "kinds"),
    biome: land("terraces@1", { form: "terraced hill", rise: "waist-high", climb: "a hillside", facing: "south", edge: "soft and grassy" }, "silver grass"),
  },
  "Mossy basin": {
    look: look("A deep mossy bowl: settled code at the bottom of things that much of the rest rests on, such as shared types, a schema or an engine.", "rust", "engine", "schema"),
    biome: land("basin@1", { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true }, "moss"),
  },
  "Heather moor": {
    look: look("An open moor of heather, softly undulating: quiet ground of writing, read more than run, such as documentation and decisions.", "docs", "markdown", "decisions"),
    biome: land("meadow@1", { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" }, "heather"),
  },
  "Meandering vale": {
    look: look("A broad, shallow vale meandering through clover: the part a person sees and touches, an interface that wanders between many concerns.", "render", "renderer", "app"),
    biome: land("valley@1", { depth: "shallow", width: "broad", run: "east-west", fall: "nearly level", meander: "strongly meandering", stream: "trickle" }, "clover meadow"),
  },
  "Golden dunes": {
    look: look("Low golden dunes of steppe grass, rippled by the west wind: configuration, data and tooling that shift around the code rather than run in it.", "config", "data", "json", "tools"),
    biome: land("dunes@1", { height: "low dunes", spacing: "even", wind: "from the west", wander: "wavering" }, "golden steppe"),
  },
  "Pond meadow": {
    look: look("A wide shallow dip melting into lush grass: a service or entry point where requests from elsewhere gather and are handed on.", "service", "main", "flora"),
    biome: land("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true }, "lush grass"),
  },
  "Broad downs": {
    look: look("Broad, sweeping downs of silver grass, smooth and open: a wide container whose own subdirectories hold the code, with little of its own.", "packages"),
    biome: land("rolling-hills@1", { height: "gentle", breadth: "broad and sweeping", roughness: "smooth", grain: "diagonal" }, "silver grass"),
  },
  "Home lawn": {
    look: look("A lawn-flat meadow, level and open: the repository's own root, its top-level files and the ground every other area starts from.", "script", "root", "repository"),
    biome: land("meadow@1", { undulation: "flat as a lawn", tilt: "slightly tilted", facing: "south" }, "lush grass"),
  },
};

/** What grows on a file's patch: a tree species, or open ground that its directory's cover fills. */
export const VIBES: Readonly<Record<string, Look>> = {
  "Lantern willow": look("Weeping willows that hang lanterns of light: a file much of the code leans on.", "hub", "large", "render", "light", "water"),
  Fir: look("Dark, steady firs: a sturdy file that tests or guards others.", "test", "rust", "engine"),
  Cherry: look("Cherry trees in blossom: a small, lively file of the interface.", "renderer", "lab", "app", "typescript"),
  "Autumn maple": look("Broad maples turning gold: a substantial file of logic.", "source", "large", "typescript"),
  "Open meadow": look("No trees: open ground in the area's own cover, for a file that describes or configures rather than acts.", "docs", "config", "data", "script", "markdown", "json", "yaml", "toml"),
};

/** The vibe keys that grow trees, by flora preset name. */
export const TREE_VIBES: readonly string[] = ["Lantern willow", "Fir", "Cherry", "Autumn maple"];

export const BUILDINGS: Readonly<Record<string, Look>> = {
  "Thatched cottage": look("a thatched cottage, small and homely: a small entity of a few files doing one modest job", "module", "small", "leaf"),
  "Stone croft": look("a low stone croft, sturdy and plain: native code close to the machine, compiled on its own, such as an engine", "crate", "rust", "medium", "engine"),
  "Storybook house": look("a crooked storybook house with a tall chimney: an application or a process a person starts, with a window or a service of its own", "app", "service", "renderer", "main", "preload"),
  Watermill: look("a watermill whose wheel turns while the code is healthy: a pipeline that turns one kind of data into another, such as rendering", "realize", "render", "world"),
  "Archive tower": look("a house with an archive tower that rises with what depends on it: one that keeps records, definitions or types that others read", "surface", "kinds"),
};

export const LANDMARKS: Readonly<Record<string, Look>> = {
  "Lantern tower": look("a round lookout tower crowned with a lantern room: an entity that watches over or lights the rest, seen from everywhere", "terrain", "renderer", "light"),
  "Stone ring": look("a ring of towering standing stones around a king stone: the shared definitions every other entity agrees on, such as a schema", "hub", "schema"),
  "Great oak": look("a vast spreading oak: a large library whose many branches the others build from", "hub", "primitives"),
  "Battlemented keep": look("a tall square keep with battlements: a guarded core that the rest runs on", "crate", "rust", "engine"),
  "Great willow": look("a great willow, gnarled and slow: the repository's own root, holding everything", "root", "repository"),
};

export const TRAILS: Readonly<Record<string, Look>> = {
  "Worn footpath": look("A well-trodden footpath two could walk, gently curving, with footbridges: most or many of its files import the other.", "hub", "package", "busy"),
  "Stone-edged path": look("A beaten-earth path edged with stones, with stepping stones over water: some of its files import the other, a deliberate way kept in order.", "crate", "surface", "app"),
  "Faint wandering track": look("A faint, half grassed-over track that meanders: only one or a few of its files import the other.", "leaf", "module", "small"),
};

export const WORLDS: Readonly<Record<string, Look>> = {
  "Meadow morning": look("Clear spring morning light over green meadows, a light breeze.", "typescript", "busy", "young"),
  "Amber steppe": look("Warm amber light over dry steppe, late summer.", "old", "large"),
  "Frost hollow": look("Cold winter light, frost on the ground.", "quiet", "old"),
  "Firefly dusk": look("A long golden dusk with fireflies.", "rust", "quiet"),
  "Monsoon terraces": look("Soft wet light over green terraces in the rains.", "python", "busy"),
  "Heather moor": look("Grey-violet light over heather moors and wind.", "small", "quiet"),
};

/**
 * What a file's finer entity stands as on its patch: a stone, a cairn, a bush
 * or a drift of flowers, each one of the understory's own blueprints (`rule`
 * and which of its presets), so standing hundreds costs no draw calls.
 */
export const FORMS: Readonly<Record<string, { readonly look: Look; readonly rule: string; readonly preset: number }>> = {
  "Standing stone": { look: look("A single upright stone: one thing done plainly, that others steer by.", "function", "exported", "hub", "medium"), rule: "rocks", preset: 1 },
  "Mossy boulder": { look: look("A broad boulder gone green with moss: a heavy, settled piece of work.", "large", "class", "rust", "engine"), rule: "rocks", preset: 0 },
  "Stone family": { look: look("A family of stones, a big one and its small ones: something built of parts.", "class", "geometry", "primitives"), rule: "rocks", preset: 3 },
  "Bench stone": { look: look("A low flat stone to sit on: a quiet helper.", "small", "test", "constant"), rule: "rocks", preset: 2 },
  "Box mound": { look: look("A clipped box bush: a small, tidy, well-kept routine.", "small", "function", "typescript", "renderer"), rule: "shrubs", preset: 0 },
  Blueberry: { look: look("A blueberry bush: a helper that bears fruit for its file.", "function", "test", "world"), rule: "shrubs", preset: 1 },
  Rhododendron: { look: look("A rhododendron in flower: a showy piece of the interface.", "renderer", "lab", "app", "immersive"), rule: "shrubs", preset: 2 },
  "Feather shrub": { look: look("A tall, feathery shrub: a light, airy piece that sways with what it reads.", "type", "schema", "terrain"), rule: "shrubs", preset: 3 },
  Bluebells: { look: look("A carpet of bluebells: a type, a shape the code agrees on, more felt than seen.", "type", "schema", "kinds"), rule: "flowers", preset: 2 },
  Daisies: { look: look("A drift of daisies: a small constant or value scattered through the code.", "constant", "config", "small"), rule: "flowers", preset: 0 },
};

/** Whether an area's land holds water, and the reason each choice gives. */
export const WATERS: Readonly<Record<string, Look>> = {
  "No water": look("No water: the area's code stands on its own, reading little from its neighbors and passing little on.", "dry", "still", "docs", "config", "test"),
  "A brook": look("A brook runs through: the area's code flows, one file feeding the next along chains of its own imports.", "flow", "large"),
  "A trickle": look("A thin trickle: a little flows through, files passing a few things along to each other.", "flow", "small"),
  "A still pond": look("A still pond gathers: much of the code leans on this area, and what it holds settles here.", "crossroads", "schema", "data"),
};

/**
 * How an area's trees and open ground lie, and what that means on the
 * ground: how many trees each line of a file grows (`perLine`), how close
 * they stand in crown widths (`closeness`), whether its files' groves gather
 * toward the area's heart and knit into one wood (`knit`) or keep to their
 * own patches' middles with clearings between, how large its trees grow
 * (`stature`), how much of each understory rule it holds, and what its open
 * ground reads as to the understory (dry heath or damp hollow).
 */
export interface Character {
  readonly look: Look;
  readonly perLine: number;
  readonly closeness: number;
  readonly knit: boolean;
  readonly stature: number;
  readonly understory: Readonly<Record<string, number>>;
  readonly open?: "dry" | "wet";
}

export const CHARACTERS: Readonly<Record<string, Character>> = {
  "Deep wood": {
    look: look("A deep wood: its files' groves run together under one canopy around the area's heart, with meadow at its rim: a large body of code dense with its own logic.", "large", "flow", "geometry", "building", "landmark", "engine", "rust"),
    perLine: 0.04,
    closeness: 0.56,
    knit: true,
    stature: 1.05,
    understory: { rocks: 0.7, shrubs: 1.3, flowers: 0.8 },
  },
  "Groves and clearings": {
    look: look("Groves standing apart, each file's on its own ground, with open clearings between: code whose files each keep to themselves.", "medium", "renderer", "render", "immersive", "app", "terrain"),
    perLine: 0.024,
    closeness: 0.56,
    knit: false,
    stature: 1,
    understory: { rocks: 1, shrubs: 1, flowers: 1 },
  },
  "Old meadow": {
    look: look("An open meadow where a few old trees stand alone, flowers in the grass: code that describes or configures, or is small and settled.", "docs", "config", "small", "still", "root", "repository", "data", "markdown"),
    perLine: 0.006,
    closeness: 2.5,
    knit: false,
    stature: 1.3,
    understory: { rocks: 0.6, shrubs: 0.5, flowers: 1.7 },
  },
  "Rocky heath": {
    look: look("A dry, rocky heath of stones, low scrub and a few wind-bent trees: hard-working code that checks or runs other code, spare and plain.", "test", "script", "tools", "realize", "dry"),
    perLine: 0.012,
    closeness: 0.9,
    knit: false,
    stature: 0.85,
    understory: { rocks: 2.6, shrubs: 1.4, flowers: 0.6 },
    open: "dry",
  },
  "Wet hollow": {
    look: look("A wet hollow of reeds and marsh flowers on soft ground, trees leaning in: ground much of the code leans on, where what it holds settles.", "crossroads", "schema", "world", "service"),
    perLine: 0.016,
    closeness: 0.55,
    knit: true,
    stature: 1,
    understory: { rocks: 0.6, shrubs: 1.3, flowers: 1.5 },
    open: "wet",
  },
};

export const LOOKS: Looks = {
  world: WORLDS,
  land: Object.fromEntries(Object.entries(LANDS).map(([k, l]) => [k, l.look])),
  vibe: VIBES,
  building: BUILDINGS,
  landmark: LANDMARKS,
  trail: TRAILS,
  form: Object.fromEntries(Object.entries(FORMS).map(([k, f]) => [k, f.look])),
  water: WATERS,
  character: Object.fromEntries(Object.entries(CHARACTERS).map(([k, c]) => [k, c.look])),
};
