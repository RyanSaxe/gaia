// What a codebase's world is made from. Jev composes its sky, its lands,
// its buildings, landmarks and trails part by part (`COMPOSING`), and
// chooses among the looks here for what is still a choice: what each entity,
// file and definition stands as (`FORMS`, offered by importance through
// `SIZES`), whether a land holds water, and what an area's ground is like. Each
// option's words are what Jev reads, and the facts it suits only the
// stand-in judge reads. The hand-filled lands and trails are for worlds
// written by hand, such as the proving ground, never offered to Jev.

import { biome, landmark, link, structure, world } from "@gaia/kinds";
import { PRIMITIVES } from "@gaia/primitives";
import { LANDMARK_PRESETS, STRUCTURE_PRESETS, TRAIL_PRESETS, WORLD_PRESETS } from "@gaia/realize";
import { type Blueprint, type FilledSlot, Library, type PrimitiveId, blueprintOf } from "@gaia/schema";
import type { Composing, Look, Looks } from "@gaia/world";

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

/**
 * Each size of thing, smallest first: the range of rank by importance among
 * the world's own entities, files and definitions that it is offered to (0
 * the least important, 1 the most, as `rankThings` reads it), and how big and
 * how rare it is, which ends every one of its forms' words. The ranges are
 * wide and overlap, so every thing is offered at least two sizes and Jev
 * chooses among them by character; the most important things are never
 * offered flowers, and only they are offered a building or a landmark. Jev
 * picks a building most times it is offered one (217 of 267 on Gaia's world
 * when buildings started at 0.90), so the buildings' range is narrow to keep
 * them scarce. A rank is a share of the world's own things, so the ranges
 * hold at any world size.
 */
export const SIZES = {
  flowers: { rank: [0, 0.55], words: "Flowers grow low in the grass, and many things are flowers." },
  stones: { rank: [0, 0.75], words: "A stone sits from ankle to waist high, and many things are stones." },
  bushes: { rank: [0.15, 0.97], words: "A bush grows knee to head high, and many things are bushes." },
  trees: { rank: [0.35, 1], words: "A tree grows tall over a person, and many things are trees." },
  buildings: { rank: [0.97, 1], words: "A building is as big as a house, and buildings are scarce: few things in a world are one." },
  landmarks: { rank: [0.98, 1], words: "A landmark rises over everything around it, and landmarks are the rarest: a world holds only a handful." },
} as const satisfies Readonly<Record<string, { readonly rank: readonly [number, number]; readonly words: string }>>;

export type Size = keyof typeof SIZES;

/** A form's look: its character in its own words, then its size's, offered only within its size's range. */
const sized = (size: Size, vibe: string, ...suits: string[]): Look => ({ doc: `${vibe} ${SIZES[size].words}`, suits, needs: [{ rank: SIZES[size].rank }] });

/**
 * What a thing stands as when it is flowers, a stone, a bush or a tree: one of
 * the lab's trees (`rule` "trees" and its flora preset), drawn with the woods,
 * or one of the understory's own blueprints (`rule` and which of its
 * presets). Either way standing hundreds costs no draw calls of its own. Each
 * look says only what its form is like, never what kind of code suits it:
 * importance decides what is offered, and character decides Jev's pick.
 */
export const FORMS: Readonly<Record<string, { readonly look: Look; readonly rule: string; readonly preset: number }>> = {
  "Lantern willow": { look: sized("trees", "A weeping willow hung with lanterns: soft, glowing and lingering.", "hub", "large", "render", "light", "water"), rule: "trees", preset: 0 },
  Fir: { look: sized("trees", "A dark fir: watchful and unbending.", "test", "rust", "engine"), rule: "trees", preset: 1 },
  Cherry: { look: sized("trees", "A cherry in blossom: bright and young.", "renderer", "lab", "app", "typescript"), rule: "trees", preset: 2 },
  "Autumn maple": { look: sized("trees", "A broad maple turning gold: rich and full of years.", "source", "large", "typescript", "class"), rule: "trees", preset: 3 },
  "Standing stone": { look: sized("stones", "A lone upright stone: stern, still and solitary.", "function", "exported", "hub", "medium"), rule: "rocks", preset: 1 },
  "Mossy boulder": { look: sized("stones", "A broad boulder gone green with moss: heavy, old and unhurried.", "large", "class", "rust", "engine"), rule: "rocks", preset: 0 },
  "Stone family": { look: sized("stones", "A big stone among its small ones: close-knit and huddled.", "class", "geometry", "primitives"), rule: "rocks", preset: 3 },
  "Bench stone": { look: sized("stones", "A low flat stone to sit on: humble and restful.", "small", "test", "constant"), rule: "rocks", preset: 2 },
  "Box mound": { look: sized("bushes", "A clipped box bush: neat, prim and kept just so.", "small", "function", "typescript", "renderer"), rule: "shrubs", preset: 0 },
  Blueberry: { look: sized("bushes", "A blueberry bush: homely and generous.", "function", "test", "world"), rule: "shrubs", preset: 1 },
  Rhododendron: { look: sized("bushes", "A rhododendron in flower: showy and a little proud.", "renderer", "lab", "app", "immersive"), rule: "shrubs", preset: 2 },
  "Feather shrub": { look: sized("bushes", "A tall, feathery shrub: airy and restless.", "type", "schema", "terrain"), rule: "shrubs", preset: 3 },
  Bluebells: { look: sized("flowers", "A carpet of bluebells in the shade: quiet and shy, easy to walk past.", "type", "schema", "kinds"), rule: "flowers", preset: 2 },
  Daisies: { look: sized("flowers", "A drift of daisies in the open: cheerful and plain.", "constant", "config", "small"), rule: "flowers", preset: 0 },
};

/** The forms Jev composes part by part once it chooses one, as it composes an entity's: a building, or a landmark. */
export const COMPOSED_FORMS: Readonly<Record<string, Look & { readonly composes: "building" | "landmark" }>> = {
  Building: { ...sized("buildings", "A building a person walks up to and around: lived in and busy, a place that holds people.", "surface", "service", "app", "large"), composes: "building" },
  Landmark: { ...sized("landmarks", "A great landmark seen and steered by from far away: grand and commanding.", "hub", "root", "repository"), composes: "landmark" },
};

/** Whether an area's land holds water, and the reason each choice gives. Running water is what a waterwheel needs. */
export const WATERS: Readonly<Record<string, Look>> = {
  "No water": look("No water: the area's code stands on its own, reading little from its neighbors and passing little on.", "dry", "still", "docs", "config", "test"),
  "A brook": { ...look("A brook runs through: the area's code flows, one file feeding the next along chains of its own imports.", "flow", "large"), holds: ["running water"] },
  "A trickle": { ...look("A thin trickle: a little flows through, files passing a few things along to each other.", "flow", "small"), holds: ["running water"] },
  "A still pond": look("A still pond gathers: much of the code leans on this area, and what it holds settles here.", "crossroads", "schema", "data"),
};

/** An area's ground, and what that means on it: how large the trees its definitions stand as grow (`stature`). */
export interface Character {
  readonly look: Look;
  readonly stature: number;
}

export const CHARACTERS: Readonly<Record<string, Character>> = {
  "Deep wood": {
    look: look("A deep wood's floor: thick shrubs in the shade, and its trees grow tall: a large body of code dense with its own logic.", "large", "flow", "geometry", "building", "landmark", "engine", "rust"),
    stature: 1.15,
  },
  "Groves and clearings": {
    look: look("Clearings with an even scatter of stones, shrubs and flowers: code whose files each keep to themselves.", "medium", "renderer", "render", "immersive", "app", "terrain"),
    stature: 1,
  },
  "Old meadow": {
    look: look("An old meadow thick with flowers, where trees grow large and broad: code that describes or configures, or is small and settled.", "docs", "config", "small", "still", "root", "repository", "data", "markdown"),
    stature: 1.3,
  },
  "Rocky heath": {
    look: look("A dry, rocky heath of stones and low scrub, where trees stay small and wind-bent: hard-working code that checks or runs other code, spare and plain.", "test", "script", "tools", "realize", "dry"),
    stature: 0.85,
  },
  "Wet hollow": {
    look: look("A wet hollow of reeds and marsh flowers on soft ground: ground much of the code leans on, where what it holds settles.", "crossroads", "schema", "world", "service"),
    stature: 1,
  },
};

/** A hand-filled blueprint, by the name of its look: for a world written by hand, such as the proving ground. */
export function presetBlueprint(as: "building" | "landmark" | "land" | "trail" | "world", look: string): Blueprint {
  const found =
    as === "land"
      ? LANDS[look]?.biome
      : as === "world"
        ? WORLD_PRESETS.find((p) => p.name === look)?.world
        : (as === "building" ? STRUCTURE_PRESETS : as === "landmark" ? LANDMARK_PRESETS : TRAIL_PRESETS).find((p) => p.name === look)?.blueprint;
  if (found === undefined) throw new Error(`There is no ${as} called ${look}.`);
  return found;
}

/** What Jev composes the world from, part by part: the sky, each land, building, landmark and trail's kind, and every primitive that could fill a part. */
export const COMPOSING: Composing = { building: structure, landmark, world, biome, link, lib: new Library(PRIMITIVES) };

export const LOOKS: Looks = {
  compose: COMPOSING,
  building: BUILDINGS,
  landmark: LANDMARKS,
  form: { ...Object.fromEntries(Object.entries(FORMS).map(([k, f]) => [k, f.look])), ...COMPOSED_FORMS },
  water: WATERS,
  character: Object.fromEntries(Object.entries(CHARACTERS).map(([k, c]) => [k, c.look])),
};
