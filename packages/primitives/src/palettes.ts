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
};

/** Every family declines toward the same dry, grey-brown tones, so decline reads the same everywhere. */
const DECLINE = { bark: 0x6f6a64, leaf: 0x9a8a5c, bloom: 0x8c7a66 };

function contrasted(c: Rgb, contrast: number): Rgb {
  const mean = (c[0] + c[1] + c[2]) / 3;
  const f = (x: number): number => Math.min(1, Math.max(0, mean + (x - mean) * contrast));
  return [f(c[0]), f(c[1]), f(c[2])];
}

export function paletteOf(family: PaletteFamily, contrast: number): Palette {
  const h = HEALTHY[family];
  return {
    swatches: {
      bark: { healthy: contrasted(hex(h.bark), contrast), decline: hex(DECLINE.bark) },
      leaf: { healthy: contrasted(hex(h.leaf), contrast), decline: hex(DECLINE.leaf) },
      bloom: { healthy: contrasted(hex(h.bloom), contrast), decline: hex(DECLINE.bloom) },
    },
  };
}

/**
 * How far apart, in OKLab, a swatch's healthy and decline colors must stay
 * after the world's season shifts the healthy one. Bark sits near grey in
 * every family, so its floor is lower; leaves and blooms carry the decline read.
 */
export const DECLINE_MARGIN: Readonly<Record<string, number>> = { bark: 0.05, leaf: 0.09, bloom: 0.09 };
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
