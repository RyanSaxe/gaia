// Color families from the world design system. Jev chooses a family by its
// description. The colors are hand-picked constants, never generated.

import type { Palette, Rgb } from "@gaia/schema";

export const PALETTE_FAMILIES = {
  "spring-meadow": "Fresh yellow-greens with pale bark and white flowers",
  "deep-forest": "Dark, cool greens with brown-black bark",
  "teal-gold": "Blue-green leaves with warm amber accents",
  "autumn-ember": "Orange and red leaves with dark bark",
  "cherry-blossom": "Soft pinks over grey-brown bark",
  "silver-birch": "Pale silver bark with bright lime leaves",
  "desert-sage": "Dusty grey-greens with ochre bark",
  "lantern-dusk": "Deep teal leaves with glowing gold accents",
  "bluebell-wood": "Cool green leaves with blue-violet flowers",
} as const;

export type PaletteFamily = keyof typeof PALETTE_FAMILIES;

/**
 * The options `palette@1` offers Jev, each described by the feel it gives a thing, so Jev chooses by mood. A land's
 * native families use the descriptions in `PALETTE_FAMILIES` instead, so the land request does not change.
 */
export const COLOR_FEELS: Readonly<Record<PaletteFamily, string>> = {
  "spring-meadow": "Fresh yellow-greens with pale bark and white flowers, for code that feels fresh, young and full of promise",
  "deep-forest": "Dark, cool greens with brown-black bark, for code that feels deep, serious and long established",
  "teal-gold": "Blue-green leaves with warm amber accents, for code that feels balanced, warm and well kept",
  "autumn-ember": "Orange and red leaves with dark bark, for code that feels mature, rich and in its later years",
  "cherry-blossom": "Soft pinks over grey-brown bark, for code that feels tender, delightful and a little fleeting",
  "silver-birch": "Pale silver bark with bright lime leaves, for code that feels light, clean and quick",
  "desert-sage": "Dusty grey-greens with ochre bark, for code that feels dry, spare and hardy",
  "lantern-dusk": "Deep teal leaves with glowing gold accents, for code that feels guiding and quietly glowing, a light in the evening",
  "bluebell-wood": "Cool green leaves with blue-violet flowers, for code that feels shy, cool and shaded",
};

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Each family's colors at full vitality. `fruit` is the ripe fruit and `berry` the dark berries that suit the family. */
const HEALTHY: Record<PaletteFamily, { bark: number; leaf: number; bloom: number; fruit: number; berry: number }> = {
  "spring-meadow": { bark: 0x8a7560, leaf: 0x8fbf4a, bloom: 0xf4f1e6, fruit: 0xd2553a, berry: 0x3e1a3c },
  "deep-forest": { bark: 0x4a3a2e, leaf: 0x2f6b3e, bloom: 0xd9c37a, fruit: 0xa8352c, berry: 0x2c1830 },
  "teal-gold": { bark: 0x6b5a48, leaf: 0x3f9a8a, bloom: 0xf2b84b, fruit: 0xe2a23e, berry: 0x2a2242 },
  "autumn-ember": { bark: 0x4d3b2f, leaf: 0xd9772e, bloom: 0xb83a2a, fruit: 0xc2352a, berry: 0x4a1424 },
  "cherry-blossom": { bark: 0x6e5d58, leaf: 0xf2b8c6, bloom: 0xfde4ea, fruit: 0xd2506a, berry: 0x4a1838 },
  "silver-birch": { bark: 0xd8d4c8, leaf: 0xa8cf3f, bloom: 0xf6e7a1, fruit: 0xdcc24e, berry: 0x321e3a },
  "desert-sage": { bark: 0x9b7a4c, leaf: 0x93a58a, bloom: 0xe0b47a, fruit: 0xd89356, berry: 0x3c2034 },
  "lantern-dusk": { bark: 0x3d3442, leaf: 0x2a6f73, bloom: 0xffc65c, fruit: 0xeea544, berry: 0x2e1c40 },
  "bluebell-wood": { bark: 0x6a5e58, leaf: 0x5f9a5a, bloom: 0x8088dc, fruit: 0x8a3a5e, berry: 0x5266a8 },
};

/**
 * Each family's understory colors: rock and moss, wildflower stems and
 * centers (`eye`), the pale wood where a fallen log or stump is cut or split,
 * and mushroom caps and stalks.
 */
const UNDERSTORY: Record<PaletteFamily, { stone: number; moss: number; stem: number; eye: number; wood: number; cap: number; stalk: number }> = {
  "spring-meadow": { stone: 0x9b988c, moss: 0x5f8a3e, stem: 0x6f9a3c, eye: 0xf0c43c, wood: 0xd6b98e, cap: 0xcc9e66, stalk: 0xf2e8d0 },
  "deep-forest": { stone: 0x7c807a, moss: 0x427c3c, stem: 0x3f6e38, eye: 0x8a5a2a, wood: 0xb8946a, cap: 0x9a5a34, stalk: 0xdccca8 },
  "teal-gold": { stone: 0x98948a, moss: 0x5c9a6a, stem: 0x4f8a6c, eye: 0xe0902e, wood: 0xcaa67c, cap: 0xd99a48, stalk: 0xf2e2b0 },
  "autumn-ember": { stone: 0x988a7a, moss: 0x8c9a40, stem: 0x6a7e3a, eye: 0x3a2a20, wood: 0xc58e5e, cap: 0xc9944a, stalk: 0xe2cc98 },
  "cherry-blossom": { stone: 0xa59c9c, moss: 0x8fb27a, stem: 0x6f9a5a, eye: 0xf2d27a, wood: 0xd8ad96, cap: 0xb86a78, stalk: 0xf6eee6 },
  "silver-birch": { stone: 0xb0aea5, moss: 0x7a9e48, stem: 0x7fa83e, eye: 0xe8c04a, wood: 0xe8dabc, cap: 0xcc4430, stalk: 0xf6f2e8 },
  "desert-sage": { stone: 0xbe9f76, moss: 0x9aa77c, stem: 0x8a9a6a, eye: 0xa0662e, wood: 0xdcb47e, cap: 0xb87448, stalk: 0xecdcbc },
  "lantern-dusk": { stone: 0x6c6878, moss: 0x3f7f6c, stem: 0x356a5e, eye: 0xffd27a, wood: 0xa68f80, cap: 0xe08a3a, stalk: 0xf0d8a0 },
  "bluebell-wood": { stone: 0x8e9096, moss: 0x5e9a52, stem: 0x4f8a48, eye: 0xf4e7b0, wood: 0xc8ab8a, cap: 0x8f7aa6, stalk: 0xe2daea },
};

/**
 * Mushroom spot colors. The silver-birch family's scarlet caps get white spots,
 * like a fly agaric. Every other family's spots use the cap color, so they do
 * not show.
 */
const SPOTS: Partial<Record<PaletteFamily, number>> = { "silver-birch": 0xf2ede2 };

/** The dry grey-brown colors every family declines toward, so low vitality looks the same in every family. */
const DECLINE = { bark: 0x6f6a64, leaf: 0x9a8a5c, bloom: 0x8c7a66, fruit: 0x6e5236, berry: 0x5e4a42, stone: 0xbcb5a8, moss: 0x9e9884, stem: 0x9a8a5c, eye: 0x8c7a66, wood: 0x9c978e, cap: 0x7a6c5e, stalk: 0xa49884 };

/**
 * Each family's building colors, chosen to suit its plants. `masonry` is the
 * base and chimney, `trim` the paintwork and `glass` the lamplight in the
 * windows. `render` is a tower's plaster, a shade off `wall`, so a timber
 * turret's plaster stands out against a tower behind it.
 */
const BUILDING: Record<PaletteFamily, { wall: number; render: number; timber: number; roof: number; masonry: number; trim: number; glass: number }> = {
  "spring-meadow": { wall: 0xf1e4c8, render: 0xd9c6a2, timber: 0x6b4f3a, roof: 0x8f7f62, masonry: 0xa89d8a, trim: 0x7fa36a, glass: 0xffbf66 },
  "deep-forest": { wall: 0xd9c9a8, render: 0xbcaa86, timber: 0x3f2e22, roof: 0x8a7a4c, masonry: 0x878274, trim: 0x46704f, glass: 0xffb85c },
  "teal-gold": { wall: 0xf2ede2, render: 0xdccdb0, timber: 0x5b4a3a, roof: 0x4f8a86, masonry: 0xb0a48f, trim: 0xd9a443, glass: 0xffc46a },
  "autumn-ember": { wall: 0xe9c690, render: 0xd1a880, timber: 0x4a3426, roof: 0xa65a42, masonry: 0x9c8f80, trim: 0x9e3d2c, glass: 0xffb055 },
  "cherry-blossom": { wall: 0xf3ddd5, render: 0xddbfb0, timber: 0x6e5d58, roof: 0x7d89a2, masonry: 0xb4aca6, trim: 0xc48896, glass: 0xffc87a },
  "silver-birch": { wall: 0xf5f2e9, render: 0xdad3c4, timber: 0x8f8a80, roof: 0xa3a59c, masonry: 0xc4c0b5, trim: 0x86a852, glass: 0xffd27a },
  "desert-sage": { wall: 0xe2c59b, render: 0xf0dfc4, timber: 0x8a6a46, roof: 0xc4703f, masonry: 0xc2ab88, trim: 0x7f9a7a, glass: 0xffbe68 },
  "lantern-dusk": { wall: 0x9eaab6, render: 0x8d8b94, timber: 0x3d3442, roof: 0x35565c, masonry: 0x6f6d78, trim: 0xe0aa4a, glass: 0xffc65c },
  "bluebell-wood": { wall: 0xe6e5df, render: 0xcac6c0, timber: 0x5a4e48, roof: 0x6a7480, masonry: 0x9a9a9e, trim: 0x7078c0, glass: 0xffc470 },
};

/** The colors buildings decline toward: grime, moss and dark, empty windows. */
const BUILDING_DECLINE = { wall: 0x8f8f7c, render: 0x8c897a, timber: 0x55504a, roof: 0x6c7050, masonry: 0x77766c, trim: 0x77706a, glass: 0x2c323b };
const SMOKE = { healthy: 0xf2eee8, decline: 0x8a8580 };

function buildingSwatches(family: PaletteFamily, contrast: number): Record<string, Palette["swatches"][string]> {
  const b = BUILDING[family];
  const out: Record<string, Palette["swatches"][string]> = {
    smoke: { healthy: hex(SMOKE.healthy), decline: hex(SMOKE.decline) },
  };
  for (const name of ["wall", "render", "timber", "roof", "masonry", "trim", "glass"] as const) {
    out[name] = { healthy: contrasted(hex(b[name]), contrast), decline: hex(BUILDING_DECLINE[name]) };
  }
  return out;
}

function contrasted(c: Rgb, contrast: number): Rgb {
  const mean = (c[0] + c[1] + c[2]) / 3;
  const f = (x: number): number => Math.min(1, Math.max(0, mean + (x - mean) * contrast));
  return [f(c[0]), f(c[1]), f(c[2])];
}

export function paletteOf(family: PaletteFamily, contrast: number): Palette {
  const h = HEALTHY[family];
  const u = UNDERSTORY[family];
  return {
    swatches: {
      bark: { healthy: contrasted(hex(h.bark), contrast), decline: hex(DECLINE.bark) },
      leaf: { healthy: contrasted(hex(h.leaf), contrast), decline: hex(DECLINE.leaf) },
      bloom: { healthy: contrasted(hex(h.bloom), contrast), decline: hex(DECLINE.bloom) },
      fruit: { healthy: contrasted(hex(h.fruit), contrast), decline: hex(DECLINE.fruit) },
      berry: { healthy: contrasted(hex(h.berry), contrast), decline: hex(DECLINE.berry) },
      stone: { healthy: contrasted(hex(u.stone), contrast), decline: hex(DECLINE.stone) },
      moss: { healthy: contrasted(hex(u.moss), contrast), decline: hex(DECLINE.moss) },
      stem: { healthy: contrasted(hex(u.stem), contrast), decline: hex(DECLINE.stem) },
      eye: { healthy: contrasted(hex(u.eye), contrast), decline: hex(DECLINE.eye) },
      wood: { healthy: contrasted(hex(u.wood), contrast), decline: hex(DECLINE.wood) },
      cap: { healthy: contrasted(hex(u.cap), contrast), decline: hex(DECLINE.cap) },
      stalk: { healthy: contrasted(hex(u.stalk), contrast), decline: hex(DECLINE.stalk) },
      spot: { healthy: contrasted(hex(SPOTS[family] ?? u.cap), contrast), decline: hex(DECLINE.cap) },
      ...buildingSwatches(family, contrast),
    },
  };
}
