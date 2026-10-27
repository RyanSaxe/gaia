// What a codebase's world is made from. Jev composes its sky, its lands,
// its buildings, landmarks, trails, trees, bushes, stones and flowers part by
// part (`COMPOSING`), and the bushes of the wild past the land, and chooses
// among the looks here for what is still a choice: what each entity, file and
// definition stands as (`FORMS` and `COMPOSED_FORMS`, offered by importance
// through `SIZES`) and whether a land holds water. Each option's words are
// what Jev reads.

import { biome, bush, landmark, link, rock, structure, tree, wildBush, wildflowers, world } from "@gaia/kinds";
import { BUSH_PRIMITIVES, PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { Library } from "@gaia/schema";
import type { Composing, Look, Looks, StandsAs } from "@gaia/world";

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
 * A form of a size that Jev composes part by part once it is chosen, as a building is: the part a person sees first,
 * which choosing the form settles (its frame, and its frame's habit), and Jev chooses the rest.
 */
const first = (size: Size, as: StandsAs, vibe: string, slot: string, use: string, fixed?: Readonly<Record<string, string>>): Look => ({
  ...sized(size, vibe),
  composes: as,
  first: { slot, use, ...(fixed === undefined ? {} : { fixed }) },
});

/**
 * What a thing stands as when it is flowers, a stone, a bush or a tree: the
 * one part a person sees first, which Jev then composes the rest of. Each
 * look says only what its form is like, never what kind of code suits it:
 * importance decides what is offered, and character decides Jev's pick.
 */
export const FORMS: Readonly<Record<string, Look>> = {
  "Upright tree": first("trees", "tree", "An upright tree, one leader driving up through its limbs: bold and striving, climbing past its neighbors to lead.", "form", "branching@1", { "form.habit": "upright" }),
  "Spreading tree": first("trees", "tree", "A spreading tree, broader than it is tall, its low limbs reaching wide: easy and welcoming, letting much rest in its shade.", "form", "branching@1", { "form.habit": "spreading" }),
  "Weeping tree": first("trees", "tree", "A weeping tree whose limbs arch over and hang toward the ground: soft and easygoing, swaying low in the breeze.", "form", "branching@1", { "form.habit": "weeping" }),
  "Columnar tree": first("trees", "tree", "A columnar tree, narrow and tall with its limbs held close: exacting and formal, standing to attention.", "form", "branching@1", { "form.habit": "columnar" }),
  Fir: first("trees", "tree", "A dark fir, one straight trunk ringed with limbs: quiet and steady, keeping watch through every season.", "form", "spire@1"),
  Mound: first("bushes", "bush", "A plump, rounded mound of a bush: cosy and rounded, comfortable where it is.", "form", "thicket@1", { "form.habit": "mound" }),
  "Spreading bush": first("bushes", "bush", "A low bush spilling outward over the ground: friendly and easygoing, at home anywhere.", "form", "thicket@1", { "form.habit": "spreading" }),
  "Vase bush": first("bushes", "bush", "A bush of upright stems flaring like a vase: lively and cheerful, reaching up and out.", "form", "thicket@1", { "form.habit": "vase" }),
  Scrub: first("bushes", "bush", "Low wiry scrub, its stems forking and arching over: tough and wiry, making do with little.", "form", "thicket@1", { "form.habit": "scrub" }),
  Bramble: first("bushes", "bush", "A bramble whose long canes arch over and root back into the soil: knotted and prickly, catching on everything.", "form", "bramble@1"),
  Sapling: first("bushes", "bush", "A young sapling no taller than a person: new and hopeful, still finding its shape.", "form", "sapling@1"),
  Boulder: first("stones", "stone", "A boulder half sunk in the ground: solid and steady, holding firm.", "form", "boulder@1"),
  "Flat stone": first("stones", "stone", "A low flat stone worn smooth by sitting: idle and drowsy, content to doze.", "form", "flat-stone@1"),
  "Stone family": first("stones", "stone", "A big stone among its small ones: warm and companionable, a big one keeping its little ones close.", "form", "stone-cluster@1"),
  Ledge: first("stones", "stone", "A ledge of bedrock breaking through the turf: foundational, the old ground everything else rests on.", "form", "outcrop@1"),
  "Fallen log": first("stones", "stone", "A fallen log lying in the grass: peaceful and spent, its long work done.", "form", "fallen-log@1"),
  "Old stump": first("stones", "stone", "An old stump with its roots still in the ground: worn and stubborn, still holding on to its roots.", "form", "stump@1"),
  Daisies: first("flowers", "flowers", "A drift of daisies in the open: plain and friendly, simple to take in at a glance.", "drift", "daisies@1"),
  Poppies: first("flowers", "flowers", "Poppies cupped open in the grass: bright and warm, quick to catch the eye.", "drift", "cups@1"),
  Bluebells: first("flowers", "flowers", "A carpet of bluebells in the shade: quiet and shy, keeping to itself.", "drift", "bells@1"),
  Lupines: first("flowers", "flowers", "Upright spires of lupines: neat and upright, each in its proper place.", "drift", "spikes@1"),
  Ferns: first("flowers", "flowers", "Ferns unrolling from their crowns: old and settled, unchanged for ages.", "drift", "ferns@1"),
  Mushrooms: first("flowers", "flowers", "Mushrooms springing up out of the ground: earthy and hidden, busy out of sight in the damp.", "drift", "mushrooms@1"),
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
 * The wild past the land, which stands for no code: its two grounds, in the ground cover's own words, tall unkempt
 * green grass and dry golden grass in patches through it. Jev composes a bush for each from the world around it.
 */
export const WILD_GROUNDS = [
  { cover: "lush grass", length: "tall and unkempt", wildflowers: "a scattering" },
  { cover: "golden steppe", length: "tall and unkempt", wildflowers: "none" },
] as const;

/**
 * What Jev composes the world from, part by part: the sky, each land, building, landmark, trail, tree, bush, stone,
 * drift of flowers and wild bush's kind, and every primitive that could fill a part. A tree and a bush, the wild's
 * too, are offered only their own size's parts.
 */
export const COMPOSING: Composing = {
  building: structure,
  landmark,
  world,
  biome,
  link,
  tree,
  bush,
  stone: rock,
  flowers: wildflowers,
  wildBush,
  lib: new Library(PRIMITIVES),
  offered: { tree: new Library(TREE_PRIMITIVES), bush: new Library(BUSH_PRIMITIVES), wildBush: new Library(BUSH_PRIMITIVES) },
};

export const LOOKS: Looks = {
  compose: COMPOSING,
  form: { ...FORMS, ...COMPOSED_FORMS },
  water: WATERS,
  wild: WILD_GROUNDS,
};
