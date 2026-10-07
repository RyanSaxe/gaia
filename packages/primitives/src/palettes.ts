// Color families from the world design system. Jev chooses a family by its
// description; the colors themselves are authored, never generated.

import type { Palette, Rgb, SeasonSpec } from "@gaia/schema";
import { keepApart, shiftColor } from "./color.ts";

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

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Healthy colors per family: bark, leaf, bloom. */
const HEALTHY: Record<PaletteFamily, { bark: number; leaf: number; bloom: number }> = {
  "spring-meadow": { bark: 0x8a7560, leaf: 0x8fbf4a, bloom: 0xf4f1e6 },
  "deep-forest": { bark: 0x4a3a2e, leaf: 0x2f6b3e, bloom: 0xd9c37a },
  "teal-gold": { bark: 0x6b5a48, leaf: 0x3f9a8a, bloom: 0xf2b84b },
  "autumn-ember": { bark: 0x4d3b2f, leaf: 0xd9772e, bloom: 0xb83a2a },
  "cherry-blossom": { bark: 0x6e5d58, leaf: 0xf2b8c6, bloom: 0xfde4ea },
  "silver-birch": { bark: 0xd8d4c8, leaf: 0xa8cf3f, bloom: 0xf6e7a1 },
  "desert-sage": { bark: 0x9b7a4c, leaf: 0x93a58a, bloom: 0xe0b47a },
  "lantern-dusk": { bark: 0x3d3442, leaf: 0x2a6f73, bloom: 0xffc65c },
  "bluebell-wood": { bark: 0x6a5e58, leaf: 0x5f9a5a, bloom: 0x8088dc },
};

/**
 * The same families on the ground: the stone a family's rocks are made of,
 * the moss that grows on them, and the stems and eyes of its wildflowers.
 */
const UNDERSTORY: Record<PaletteFamily, { stone: number; moss: number; stem: number; eye: number }> = {
  "spring-meadow": { stone: 0x9b988c, moss: 0x5f8a3e, stem: 0x6f9a3c, eye: 0xf0c43c },
  "deep-forest": { stone: 0x7c807a, moss: 0x427c3c, stem: 0x3f6e38, eye: 0x8a5a2a },
  "teal-gold": { stone: 0x98948a, moss: 0x5c9a6a, stem: 0x4f8a6c, eye: 0xe0902e },
  "autumn-ember": { stone: 0x988a7a, moss: 0x8c9a40, stem: 0x6a7e3a, eye: 0x3a2a20 },
  "cherry-blossom": { stone: 0xa59c9c, moss: 0x8fb27a, stem: 0x6f9a5a, eye: 0xf2d27a },
  "silver-birch": { stone: 0xb0aea5, moss: 0x7a9e48, stem: 0x7fa83e, eye: 0xe8c04a },
  "desert-sage": { stone: 0xbe9f76, moss: 0x9aa77c, stem: 0x8a9a6a, eye: 0xa0662e },
  "lantern-dusk": { stone: 0x6c6878, moss: 0x3f7f6c, stem: 0x356a5e, eye: 0xffd27a },
  "bluebell-wood": { stone: 0x8e9096, moss: 0x5e9a52, stem: 0x4f8a48, eye: 0xf4e7b0 },
};

/** Every family declines toward the same dry, grey-brown tones, so decline reads the same everywhere. */
const DECLINE = { bark: 0x6f6a64, leaf: 0x9a8a5c, bloom: 0x8c7a66, stone: 0xbcb5a8, moss: 0x9e9884, stem: 0x9a8a5c, eye: 0x8c7a66 };

/**
 * A building's colors in each family: walls, timber, roof, the masonry of its
 * base and chimney, painted trim, the lamplight in its windows and its
 * chimney smoke. Each family's buildings belong with its plants.
 */
const BUILDING: Record<PaletteFamily, { wall: number; timber: number; roof: number; masonry: number; trim: number; glass: number }> = {
  "spring-meadow": { wall: 0xf1e4c8, timber: 0x6b4f3a, roof: 0x8f7f62, masonry: 0xa89d8a, trim: 0x7fa36a, glass: 0xffbf66 },
  "deep-forest": { wall: 0xd9c9a8, timber: 0x3f2e22, roof: 0x8a7a4c, masonry: 0x878274, trim: 0x46704f, glass: 0xffb85c },
  "teal-gold": { wall: 0xf2ede2, timber: 0x5b4a3a, roof: 0x4f8a86, masonry: 0xb0a48f, trim: 0xd9a443, glass: 0xffc46a },
  "autumn-ember": { wall: 0xe9c690, timber: 0x4a3426, roof: 0xa65a42, masonry: 0x9c8f80, trim: 0x9e3d2c, glass: 0xffb055 },
  "cherry-blossom": { wall: 0xf3ddd5, timber: 0x6e5d58, roof: 0x7d89a2, masonry: 0xb4aca6, trim: 0xc48896, glass: 0xffc87a },
  "silver-birch": { wall: 0xf5f2e9, timber: 0x8f8a80, roof: 0xa3a59c, masonry: 0xc4c0b5, trim: 0x86a852, glass: 0xffd27a },
  "desert-sage": { wall: 0xe2c59b, timber: 0x8a6a46, roof: 0xc4703f, masonry: 0xc2ab88, trim: 0x7f9a7a, glass: 0xffbe68 },
  "lantern-dusk": { wall: 0x9eaab6, timber: 0x3d3442, roof: 0x35565c, masonry: 0x6f6d78, trim: 0xe0aa4a, glass: 0xffc65c },
  "bluebell-wood": { wall: 0xe6e5df, timber: 0x5a4e48, roof: 0x6a7480, masonry: 0x9a9a9e, trim: 0x7078c0, glass: 0xffc470 },
};

/** Buildings decline toward grime, moss and dark, empty windows. */
const BUILDING_DECLINE = { wall: 0x8f8f7c, timber: 0x55504a, roof: 0x6c7050, masonry: 0x77766c, trim: 0x77706a, glass: 0x2c323b };
const SMOKE = { healthy: 0xf2eee8, decline: 0x8a8580 };

function buildingSwatches(family: PaletteFamily, contrast: number): Record<string, Palette["swatches"][string]> {
  const b = BUILDING[family];
  const out: Record<string, Palette["swatches"][string]> = {
    smoke: { healthy: hex(SMOKE.healthy), decline: hex(SMOKE.decline) },
  };
  for (const name of ["wall", "timber", "roof", "masonry", "trim", "glass"] as const) {
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
      stone: { healthy: contrasted(hex(u.stone), contrast), decline: hex(DECLINE.stone) },
      moss: { healthy: contrasted(hex(u.moss), contrast), decline: hex(DECLINE.moss) },
      stem: { healthy: contrasted(hex(u.stem), contrast), decline: hex(DECLINE.stem) },
      eye: { healthy: contrasted(hex(u.eye), contrast), decline: hex(DECLINE.eye) },
      ...buildingSwatches(family, contrast),
    },
  };
}

/**
 * How far apart, in OKLab, a swatch's healthy and decline colors must stay
 * after the world's season shifts the healthy one. Bark sits near grey in
 * every family, so its floor is lower; leaves and blooms carry the decline read.
 */
export const DECLINE_MARGIN: Readonly<Record<string, number>> = { bark: 0.05, leaf: 0.09, bloom: 0.09, stone: 0.05, moss: 0.09, stem: 0.09, eye: 0.07 };
const DEFAULT_MARGIN = 0.09;

/**
 * A component's palette under the world's season. Only healthy colors move;
 * decline is shared by every world, and each shifted color is pushed clear of
 * its decline color so decline always reads as decline.
 */
export function seasonPalette(palette: Palette, season: SeasonSpec): Palette {
  const swatches: Record<string, Palette["swatches"][string]> = {};
  for (const [name, swatch] of Object.entries(palette.swatches)) {
    const shift = season.swatches[name];
    const healthy = shift === undefined ? swatch.healthy : shiftColor(swatch.healthy, shift);
    swatches[name] = { healthy: keepApart(healthy, swatch.decline, DECLINE_MARGIN[name] ?? DEFAULT_MARGIN), decline: swatch.decline };
  }
  return { swatches };
}
