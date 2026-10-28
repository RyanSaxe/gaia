// The options a codebase's world is made from. Jev composes the sky, lands,
// buildings, landmarks, trails, trees, bushes, stones, flowers and wild bushes
// part by part (`COMPOSING`), and picks each entity's, file's and definition's
// form (`FORMS`, `COMPOSED_FORMS`, offered by importance through `SIZES`) and
// each land's water (`WATERS`). Each option's text is what Jev reads.

import { biome, bush, landmark, link, rock, structure, tree, wildBush, wildflowers, world } from "@gaia/kinds";
import { BUSH_PRIMITIVES, PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { Library } from "@gaia/schema";
import type { Composing, Look, Looks, FormKind } from "@gaia/world";

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

/** A form's look: its own character text followed by its size's, offered only within its size's rank range. */
const sized = (size: Size, vibe: string): Look => ({ doc: `${vibe} ${SIZES[size].words}`, needs: [{ rank: SIZES[size].rank }] });

/**
 * A form that Jev composes part by part once chosen, as it does a building. Choosing the form fixes the part a person
 * sees first, its frame and the frame's habit, and Jev chooses the rest.
 */
const first = (size: Size, as: FormKind, vibe: string, slot: string, use: string, fixed?: Readonly<Record<string, string>>): Look => ({
  ...sized(size, vibe),
  composes: as,
  first: { slot, use, ...(fixed === undefined ? {} : { fixed }) },
});

/**
 * The forms for flowers, a stone, a bush or a tree. Each fixes the part a
 * person sees first, and Jev composes the rest. Each look describes only what
 * the form is like, never what kind of code suits it: importance limits what
 * is offered, and character drives Jev's pick. Jev picks its most likely
 * form, which usually leads the next by only a few points, so a few words can
 * move a form's share by tens of points. After any change, ask the first
 * question again and compare the spread of picks.
 */
export const FORMS: Readonly<Record<string, Look>> = {
  "Upright tree": first("trees", "tree", "An upright tree with one leader rising through its limbs. It feels bold and ambitious, taller than its neighbors.", "form", "branching@1", { "form.habit": "upright" }),
  "Spreading tree": first("trees", "tree", "A spreading tree, broader than it is tall, with low, wide limbs. It feels easy and welcoming, with room for much in its shade.", "form", "branching@1", { "form.habit": "spreading" }),
  "Weeping tree": first("trees", "tree", "A weeping tree whose limbs arch over and hang toward the ground. It feels soft and easygoing, swaying low in the breeze.", "form", "branching@1", { "form.habit": "weeping" }),
  "Columnar tree": first("trees", "tree", "A columnar tree, narrow and tall, with its limbs held close. It feels exacting and formal.", "form", "branching@1", { "form.habit": "columnar" }),
  Fir: first("trees", "tree", "A dark fir, one straight trunk ringed with limbs. It feels quiet and steady, the same through every season.", "form", "spire@1"),
  Mound: first("bushes", "bush", "A plump, rounded mound of a bush. It feels cosy and comfortable.", "form", "thicket@1", { "form.habit": "mound" }),
  "Spreading bush": first("bushes", "bush", "A low bush spreading outward over the ground. It feels friendly, easygoing and adaptable.", "form", "thicket@1", { "form.habit": "spreading" }),
  "Vase bush": first("bushes", "bush", "A bush of upright stems flaring like a vase. It feels lively and cheerful.", "form", "thicket@1", { "form.habit": "vase" }),
  Scrub: first("bushes", "bush", "Low wiry scrub with forking, arching stems. It feels tough and spare, getting by on little.", "form", "thicket@1", { "form.habit": "scrub" }),
  Bramble: first("bushes", "bush", "A bramble whose long canes arch over and root back into the soil. It feels knotted and prickly, snagging on everything.", "form", "bramble@1"),
  Sapling: first("bushes", "bush", "A young sapling no taller than a person. It feels hopeful and untried, still taking shape.", "form", "sapling@1"),
  Boulder: first("stones", "stone", "A boulder half sunk in the ground. It feels solid, steady and firm.", "form", "boulder@1"),
  "Flat stone": first("stones", "stone", "A low flat stone worn smooth by people sitting on it. It feels idle, drowsy and slow.", "form", "flat-stone@1"),
  "Stone family": first("stones", "stone", "A big stone among smaller ones. It feels close-knit and loyal, like a family that keeps together.", "form", "stone-cluster@1"),
  Ledge: first("stones", "stone", "A ledge of bedrock breaking through the turf. It feels foundational and sure, the old ground everything else rests on.", "form", "outcrop@1"),
  "Fallen log": first("stones", "stone", "A fallen log lying in the grass. It feels peaceful, spent and finished.", "form", "fallen-log@1"),
  "Old stump": first("stones", "stone", "An old stump with its roots still in the ground. It feels worn, stubborn and persistent.", "form", "stump@1"),
  Daisies: first("flowers", "flowers", "A drift of daisies in the open. It feels plain and friendly, easy to take in at a glance.", "drift", "daisies@1"),
  Poppies: first("flowers", "flowers", "Poppies cupped open in the grass. They feel quick and fleeting, here for a moment and then gone.", "drift", "cups@1"),
  Bluebells: first("flowers", "flowers", "A carpet of bluebells in the shade. It feels quiet, shy and private.", "drift", "bells@1"),
  Lupines: first("flowers", "flowers", "Upright spires of lupines. They feel neat and exact, one of many alike.", "drift", "spikes@1"),
  Ferns: first("flowers", "flowers", "Ferns unrolling from their crowns. They feel old, settled and unchanged for ages.", "drift", "ferns@1"),
  Mushrooms: first("flowers", "flowers", "Mushrooms springing up out of the ground. They feel odd and unexpected, found in damp corners few people visit.", "drift", "mushrooms@1"),
};

/** The forms Jev composes part by part once chosen, as for an entity: a building or a landmark. */
export const COMPOSED_FORMS: Readonly<Record<string, Look & { readonly composes: "building" | "landmark" }>> = {
  Building: { ...sized("buildings", "A building a person walks up to and around. It feels lived in and busy, a place for people."), composes: "building" },
  Landmark: { ...sized("landmarks", "A great landmark that a person sees and navigates by from far away. It feels grand and commanding."), composes: "landmark" },
};

/**
 * The water options for an area's land. Each option's text is the reason for the choice, and `settles` fixes the
 * stream or pond in the land composed for the area, so Jev is asked about water once. A waterwheel needs running water.
 */
export const WATERS: Readonly<Record<string, Look>> = {
  "No water": { ...look("No water. The area's code is self-contained: it imports little from other areas, and little imports it."), settles: { "relief.stream": "dry bed", "relief.pond": false } },
  "A brook": { ...look("A brook runs through it. The area's files import each other in long chains, one file to the next."), holds: ["running water"], settles: { "relief.stream": "brook", "relief.pond": false } },
  "A trickle": { ...look("A thin trickle runs through it. A few of the area's files import each other."), holds: ["running water"], settles: { "relief.stream": "trickle", "relief.pond": false } },
  "A still pond": { ...look("A still pond. Much of the rest of the codebase imports this area."), settles: { "relief.stream": "dry bed", "relief.pond": true } },
};

/**
 * The two grounds of the wild past the land, which represents no code, in the ground cover's own words: tall unkempt
 * green grass, and dry golden grass in patches through it. Jev composes a bush for each from the world around it.
 */
export const WILD_GROUNDS = [
  { cover: "lush grass", length: "tall and unkempt", wildflowers: "a scattering" },
  { cover: "golden steppe", length: "tall and unkempt", wildflowers: "none" },
] as const;

/**
 * The kinds Jev composes the world from part by part: the sky, each land, building, landmark, trail, tree, bush,
 * stone, drift of flowers and wild bush, and every primitive that could fill a part. A tree, a bush and a wild bush
 * are offered only their own size's parts.
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
