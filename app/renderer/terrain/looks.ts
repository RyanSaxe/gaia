// What a codebase's world is made from. Jev composes its sky, its lands,
// its buildings, landmarks and trails part by part (`COMPOSING`), and
// chooses among the looks here for what is still a choice: what each entity,
// file and definition stands as (`FORMS`, offered by importance through
// `SIZES`) and whether a land holds water. Each option's words are what Jev
// reads.

import { biome, landmark, link, structure, world } from "@gaia/kinds";
import { PRIMITIVES } from "@gaia/primitives";
import { Library } from "@gaia/schema";
import type { Composing, Look, Looks } from "@gaia/world";

const look = (doc: string): Look => ({ doc });

/**
 * Available size ranges by importance rank within the world. Overlapping
 * ranges let Jev choose by character. Reserving the highest ranks for trees
 * and landmarks prevents buildings from crowding out those silhouettes.
 */
export const SIZES = {
  flowers: { rank: [0, 0.45], words: "Flowers grow low in the grass, and many things are flowers." },
  stones: { rank: [0, 0.45], words: "A stone sits from ankle to waist high, and many things are stones." },
  bushes: { rank: [0.15, 0.75], words: "A bush grows knee to head high, and many things are bushes." },
  trees: { rank: [0.3, 1], words: "A tree grows tall over a person, and many things are trees." },
  buildings: { rank: [0.9, 0.997], words: "A building is as big as a house, and buildings are scarce: few things in a world are one." },
  landmarks: { rank: [0.98, 1], words: "A landmark rises over everything around it, and landmarks are the rarest: a world holds only a handful." },
} as const satisfies Readonly<Record<string, { readonly rank: readonly [number, number]; readonly words: string }>>;

export type Size = keyof typeof SIZES;

/** A form's look: its character in its own words, then its size's, offered only within its size's range. */
const sized = (size: Size, vibe: string): Look => ({ doc: `${vibe} ${SIZES[size].words}`, needs: [{ rank: SIZES[size].rank }] });

/**
 * What a thing stands as when it is flowers, a stone, a bush or a tree: one of
 * the world's trees (`rule` "trees" and its flora preset), drawn with the woods,
 * or one of the understory's own blueprints (`rule` and which of its
 * presets). Either way standing hundreds costs no draw calls of its own. Each
 * look says only what its form is like, never what kind of code suits it:
 * importance decides what is offered, and character decides Jev's pick.
 */
export const FORMS: Readonly<Record<string, { readonly look: Look; readonly rule: string; readonly preset: number }>> = {
  "Lantern willow": { look: sized("trees", "A weeping willow hung with lanterns: gentle and guiding, lighting the way for others."), rule: "trees", preset: 0 },
  Fir: { look: sized("trees", "A dark fir: watchful and unbending."), rule: "trees", preset: 1 },
  Cherry: { look: sized("trees", "A cherry in full blossom: eager and lively, quick to lend a hand."), rule: "trees", preset: 2 },
  "Autumn maple": { look: sized("trees", "A broad maple turning gold: sheltering, rich and full of years, with much leaning on it."), rule: "trees", preset: 3 },
  "Standing stone": { look: sized("stones", "A lone upright stone: stern, still and solitary."), rule: "rocks", preset: 1 },
  "Mossy boulder": { look: sized("stones", "A broad boulder gone green with moss: heavy, old and unhurried."), rule: "rocks", preset: 0 },
  "Stone family": { look: sized("stones", "A big stone among its small ones: close-knit and huddled."), rule: "rocks", preset: 3 },
  "Bench stone": { look: sized("stones", "A low flat stone worn smooth by sitting: drowsy, idle and content."), rule: "rocks", preset: 2 },
  "Box mound": { look: sized("bushes", "A box bush clipped into a hard square: strict and severe."), rule: "shrubs", preset: 0 },
  Blueberry: { look: sized("bushes", "A blueberry bush, low and thick with berries: cosy and a little untidy."), rule: "shrubs", preset: 1 },
  Rhododendron: { look: sized("bushes", "A rhododendron in flower: showy and a little proud."), rule: "shrubs", preset: 2 },
  "Feather shrub": { look: sized("bushes", "A tall, feathery shrub: airy and restless."), rule: "shrubs", preset: 3 },
  Bluebells: { look: sized("flowers", "A carpet of bluebells in the shade: quiet and shy, keeping to itself."), rule: "flowers", preset: 1 },
  Daisies: { look: sized("flowers", "A drift of daisies in the open: simple and sunny, plain to see."), rule: "flowers", preset: 0 },
};

/** The forms Jev composes part by part once it chooses one, as it composes an entity's: a building, or a landmark. */
export const COMPOSED_FORMS: Readonly<Record<string, Look & { readonly composes: "building" | "landmark" }>> = {
  Building: { ...sized("buildings", "A building a person walks up to and around: lived in and busy, a place that holds people."), composes: "building" },
  Landmark: { ...sized("landmarks", "A great landmark seen and steered by from far away: grand and commanding."), composes: "landmark" },
};

/**
 * Whether an area's land holds water, the reason each choice gives, and the stream or pond it settles in the land
 * composed for the area, so the water is asked once. Running water is what a waterwheel needs.
 */
export const WATERS: Readonly<Record<string, Look>> = {
  "No water": { ...look("No water: the area's code stands on its own, reading little from its neighbors and passing little on."), settles: { "relief.stream": "dry bed", "relief.pond": false } },
  "A brook": { ...look("A brook runs through: the area's code flows, one file feeding the next along chains of its own imports."), holds: ["running water"], settles: { "relief.stream": "brook", "relief.pond": false } },
  "A trickle": { ...look("A thin trickle: a little flows through, files passing a few things along to each other."), holds: ["running water"], settles: { "relief.stream": "trickle", "relief.pond": false } },
  "A still pond": { ...look("A still pond gathers: much of the code leans on this area, and what it holds settles here."), settles: { "relief.stream": "dry bed", "relief.pond": true } },
};

/**
 * Primitives built and drawn but not offered to Jev yet, while their look is judged: offering one changes the
 * questions of every part it could fill, so Jev's kept answers would have to be asked again.
 */
const NOT_OFFERED: ReadonlySet<string> = new Set(["windmill@1"]);

/** What Jev composes the world from, part by part: the sky, each land, building, landmark and trail's kind, and every primitive that could fill a part. */
export const COMPOSING: Composing = { building: structure, landmark, world, biome, link, lib: new Library(PRIMITIVES.filter((p) => !NOT_OFFERED.has(p.id))) };

export const LOOKS: Looks = {
  compose: COMPOSING,
  form: { ...Object.fromEntries(Object.entries(FORMS).map(([k, f]) => [k, f.look])), ...COMPOSED_FORMS },
  water: WATERS,
};
