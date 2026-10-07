// Biome primitives: what one region of the world grows and breathes. Each
// directory's biome picks its own ground cover, air and drifting accents, and
// names the palette families native to it.

import type { AccentForm, GroundSpec, NativeFamilies } from "@gaia/schema";
import { primitive, t } from "@gaia/schema";
import { hex } from "./color.ts";
import { PALETTE_FAMILIES } from "./palettes.ts";

// ---------- atmosphere ----------

const AIRS = {
  clear: { tint: 0xc8dcec, tintAmount: 0, density: 0.0035, mist: 0, specks: 0 },
  "hazy gold": { tint: 0xf0d49c, tintAmount: 0.55, density: 0.009, mist: 0.12, specks: 0 },
  "blue haze": { tint: 0x9fbde0, tintAmount: 0.45, density: 0.008, mist: 0.08, specks: 0 },
  "morning mist": { tint: 0xe2e9ec, tintAmount: 0.5, density: 0.006, mist: 0.35, specks: 0 },
  "pollen-filled": { tint: 0xf1e2a8, tintAmount: 0.32, density: 0.0065, mist: 0.06, specks: 1 },
} as const;

export const air = primitive({
  id: "air@1",
  role: "Atmosphere",
  doc: "What hangs in the air between you and the distance.",
  params: {
    air: t.choice("The character of the air", {
      clear: "Crisp, clean air",
      "hazy gold": "Warm golden haze",
      "blue haze": "Distance fades into soft blue",
      "morning mist": "White mist lying low on the ground",
      "pollen-filled": "Air thick with drifting golden pollen",
    }),
    distance: t.scale("How far you can see", { "for miles": 0.55, "softened distance": 1, "close and dreamy": 1.7 }),
  },
  build: (p) => {
    const a = AIRS[p.air];
    return { tint: hex(a.tint), tintAmount: a.tintAmount, density: a.density * p.distance, mist: a.mist, specks: a.specks };
  },
});

// ---------- ground cover ----------

interface Cover {
  readonly soil: number;
  readonly low: number;
  readonly high: number;
  readonly tip: number;
  readonly height: number;
  readonly width: number;
  readonly density: number;
  readonly clump: number;
  readonly flowers: readonly [number, number, number];
}

const COVERS = {
  "lush grass": { soil: 0x6f8f4a, low: 0x5a9146, high: 0x9ccc68, tip: 0xb6da80, height: 0.4, width: 0.045, density: 1, clump: 0, flowers: [0xf6f1e0, 0xf5d45c, 0xb9a5e8] },
  "golden steppe": { soil: 0xa69660, low: 0x9a8c4c, high: 0xd6c07a, tip: 0xecdb9e, height: 0.5, width: 0.035, density: 0.85, clump: 0.15, flowers: [0xf3e6c4, 0xe9a24c, 0xc96a5a] },
  "silver grass": { soil: 0x7c875a, low: 0x748658, high: 0xb4c09c, tip: 0xeae6da, height: 0.85, width: 0.03, density: 0.62, clump: 0.35, flowers: [0xf2efe6, 0xd8c9e6, 0xf0d9a0] },
  moss: { soil: 0x4f7a3c, low: 0x4c7c3a, high: 0x86b04e, tip: 0xa6c660, height: 0.09, width: 0.06, density: 1, clump: 0.1, flowers: [0xf4f0e2, 0xe8c45a, 0xd88aa0] },
  heather: { soil: 0x6a6048, low: 0x6a5a6c, high: 0xa47cae, tip: 0xc89cd0, height: 0.26, width: 0.05, density: 0.95, clump: 0.3, flowers: [0xd9a8de, 0xf2d7f0, 0x9c6fb8] },
  "sand and scrub": { soil: 0xd4c19a, low: 0x87905c, high: 0xb1b278, tip: 0xcdc694, height: 0.3, width: 0.04, density: 0.45, clump: 0.8, flowers: [0xf2c45a, 0xe8836a, 0xf4efe0] },
  "clover meadow": { soil: 0x5e8944, low: 0x4f8b42, high: 0x8ec45e, tip: 0xa4d07a, height: 0.18, width: 0.07, density: 1, clump: 0, flowers: [0xf3f0f2, 0xe7a5c8, 0xc9b6ec] },
} as const satisfies Record<string, Cover>;

export const groundCover = primitive({
  id: "ground-cover@1",
  role: "Ground",
  doc: "What grows over the open ground between the components.",
  params: {
    cover: t.choice("What covers the ground", {
      "lush grass": "Soft green grass",
      "golden steppe": "Dry golden grassland",
      "silver grass": "Tall pale plumed grass that ripples in the wind",
      moss: "A deep cushion of moss",
      heather: "Low purple heather",
      "sand and scrub": "Pale sand with clumps of scrub",
      "clover meadow": "A low carpet of clover",
    }),
    length: t.scale("How tall the cover grows", { cropped: 0.65, natural: 1, "tall and unkempt": 1.45 }),
    wildflowers: t.scale("How many wildflowers", { none: 0, "a scattering": 0.03, "drifts of them": 0.11 }),
  },
  build: (p): GroundSpec => {
    const c: Cover = COVERS[p.cover];
    return {
      soil: hex(c.soil),
      low: hex(c.low),
      high: hex(c.high),
      tip: hex(c.tip),
      height: c.height * p.length,
      width: c.width,
      density: c.density,
      clump: c.clump,
      flowers: p.wildflowers,
      flowerColors: c.flowers.map(hex),
    };
  },
});

// ---------- ambient accents ----------

const ACCENTS = {
  "drifting petals": { form: "petals", color: 0xf7d8e0, size: 0.075, glow: 0 },
  "fireflies at dusk": { form: "fireflies", color: 0xf6ea8c, size: 0.07, glow: 1 },
  "motes of light": { form: "motes", color: 0xfff2cc, size: 0.04, glow: 0.6 },
  "falling leaves": { form: "leaves", color: 0xd9a04a, size: 0.1, glow: 0 },
  "dandelion seeds": { form: "seeds", color: 0xf6f4ee, size: 0.055, glow: 0.1 },
} as const satisfies Record<string, { form: AccentForm; color: number; size: number; glow: number }>;

export const drift = primitive({
  id: "drift@1",
  role: "Accents",
  doc: "Small living things drifting through the air. Always subtle.",
  params: {
    form: t.choice("What drifts through the air", {
      "drifting petals": "Pale petals carried on the breeze",
      "fireflies at dusk": "Fireflies blinking low over the ground",
      "motes of light": "Tiny motes of light hanging in the sunbeams",
      "falling leaves": "Leaves spinning down, in the season's color",
      "dandelion seeds": "Dandelion seeds floating past",
    }),
    amount: t.scale("How many", { "a few": 70, some: 180, many: 380 }),
  },
  build: (p) => {
    const a = ACCENTS[p.form];
    return { form: a.form, color: hex(a.color), count: Math.round(p.amount), size: a.size, glow: a.glow };
  },
});

// ---------- native families ----------

export const nativeFamilies = primitive({
  id: "native-families@1",
  role: "Natives",
  doc: "The palette families that grow naturally in this region.",
  params: { families: t.set("Which palette families belong here?", PALETTE_FAMILIES) },
  build: (p): NativeFamilies => ({ families: p.families }),
});

export const BIOME_PRIMITIVES = [air, groundCover, drift, nativeFamilies];
