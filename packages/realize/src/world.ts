// Turns the world's and a region's blueprints into the numbers every material
// reads at one hour. The slots are chosen independently; this is where they
// meet: the hour tints the sky and night deepens it, the region's air pulls
// the horizon and fog toward its own color, the season turns the region's
// ground, and the sun or moon colors the clouds.

import type {
  AccentSpec,
  AnyKind,
  AtmosphereSpec,
  Blueprint,
  CloudSpec,
  DaySpec,
  GroundSpec,
  Library,
  LightSpec,
  MoonSpec,
  NativeFamilies,
  Rgb,
  SeasonSpec,
  SkySpec,
  StarSpec,
  WindSpec,
} from "@gaia/schema";
import { hex, mixLab, seasonGround, shiftColor } from "@gaia/primitives";
import { lightAt } from "./day.ts";
import { buildSlots } from "./realize.ts";

/** A blueprint with the kind it fills. */
export interface Filled {
  readonly blueprint: Blueprint;
  readonly kind: AnyKind;
}

/** What the whole world shares at one hour: one sky over every region. */
export interface SkyLook {
  readonly light: LightSpec;
  readonly sky: {
    readonly zenith: Rgb;
    readonly horizon: Rgb;
    readonly clouds: CloudSpec;
    readonly cloudLit: Rgb;
    readonly cloudShade: Rgb;
    readonly moon: MoonSpec;
    readonly stars: StarSpec;
  };
  readonly season: SeasonSpec;
  readonly wind: WindSpec;
}

/** What one region grows and breathes, with the world's season applied. */
export interface RegionLook {
  readonly ground: GroundSpec;
  /** The ground's decline color: shared by every world, like component decline. */
  readonly groundDecline: Rgb;
  readonly air: AtmosphereSpec;
  readonly drift: AccentSpec | null;
  /** Palette families native to the region; empty means every family. */
  readonly natives: readonly string[];
}

/** The sky seen from one region: the shared sky with that region's air in front of it. */
export interface WorldLook {
  readonly light: LightSpec;
  readonly sky: SkyLook["sky"] & { readonly mid: Rgb };
  readonly fog: { readonly color: Rgb; readonly density: number; readonly mist: number };
  readonly season: SeasonSpec;
  readonly ground: GroundSpec;
  readonly groundDecline: Rgb;
  readonly drift: AccentSpec | null;
  readonly specks: number;
  readonly wind: WindSpec;
}

/** Dry, grey-brown grass: what the ground declines toward in every world. */
export const GROUND_DECLINE: Rgb = hex(0xb1a17a);

/** The air of a region whose biome chose none: clear, with no tint. */
export const CLEAR_AIR: AtmosphereSpec = { tint: hex(0xc8dcec), tintAmount: 0, density: 0.0035, mist: 0, specks: 0 };

const DEEP_ZENITH: Rgb = hex(0x2c3a78);
const CLOUD_WHITE: Rgb = hex(0xfdfcf8);
/** The night sky: a deep blue that lightens toward the horizon, never black. */
const NIGHT_ZENITH: Rgb = hex(0x0f1b44);
const NIGHT_HORIZON: Rgb = hex(0x2c4475);
const NO_SHIFT = { hue: 0, pull: 0, maxTurn: 0, chroma: 1, lightness: 0 };

function slotOutput<T>(built: ReturnType<typeof buildSlots>, name: string): T {
  const out = built.get(name)?.output;
  if (out === undefined) throw new Error(`The blueprint has no ${name}.`);
  return out as T;
}

export function realizeSky(world: Filled, lib: Library, seed: number, hour: number): SkyLook {
  const built = buildSlots(world.blueprint, world.kind, lib, { seed, facts: {} });
  const day = slotOutput<DaySpec>(built, "light");
  const light = lightAt(day, hour);
  const sky = slotOutput<SkySpec>(built, "sky");
  const night = light.nightness;
  const dayZenith = mixLab(mixLab(sky.zenith, DEEP_ZENITH, light.zenithDim), light.horizonGlow, light.glow * 0.12);
  const dayHorizon = mixLab(sky.horizon, light.horizonGlow, light.glow);
  // Night keeps a trace of the world's own sky, so a lavender world has a lavender night.
  const zenith = mixLab(dayZenith, NIGHT_ZENITH, night * 0.94);
  const horizon = mixLab(dayHorizon, mixLab(NIGHT_HORIZON, light.moonColor, 0.12), night * 0.92);
  // By night, clouds are silvered by the moon instead of whitened by the sun.
  const dayLit = mixLab(CLOUD_WHITE, light.sunColor, 0.12 + light.glow * 0.45);
  const nightLit = mixLab(mixLab(horizon, zenith, 0.25), light.moonColor, 0.32);
  const cloudLit = mixLab(dayLit, nightLit, night);
  const cloudShade = mixLab(mixLab(cloudLit, light.shadowColor, 0.6), zenith, 0.2 + night * 0.3);
  return {
    light,
    sky: { zenith, horizon, clouds: sky.clouds, cloudLit, cloudShade, moon: day.moon, stars: day.stars },
    season: slotOutput<SeasonSpec>(built, "season"),
    wind: slotOutput<WindSpec>(built, "wind"),
  };
}

export function realizeRegion(region: Filled, lib: Library, seed: number, season: SeasonSpec): RegionLook {
  const built = buildSlots(region.blueprint, region.kind, lib, { seed, facts: {} });
  const accent = built.get("accents")?.output as AccentSpec | undefined;
  let drift: AccentSpec | null = null;
  if (accent !== undefined) {
    const color =
      accent.form === "leaves" ? season.fall : accent.form === "petals" ? shiftColor(accent.color, season.swatches.bloom ?? NO_SHIFT) : accent.color;
    drift = { ...accent, color };
  }
  return {
    ground: seasonGround(slotOutput<GroundSpec>(built, "cover"), season),
    groundDecline: GROUND_DECLINE,
    air: (built.get("air")?.output as AtmosphereSpec | undefined) ?? CLEAR_AIR,
    drift,
    natives: slotOutput<NativeFamilies>(built, "natives").families,
  };
}

/** Composes the shared sky at `hour` with one region's air and ground, as seen from inside that region. */
export function realizeWorld(world: Filled, region: Filled, lib: Library, seed: number, hour: number): WorldLook {
  const sky = realizeSky(world, lib, seed, hour);
  const local = realizeRegion(region, lib, seed, sky.season);
  // The air sits in front of the sunset; at night its color fades into the dark.
  const tint = mixLab(local.air.tint, sky.sky.horizon, sky.light.nightness * 0.75);
  const horizon = mixLab(sky.sky.horizon, tint, local.air.tintAmount * 0.5);
  const fog = mixLab(horizon, tint, local.air.tintAmount * 0.5);
  return {
    light: sky.light,
    sky: { ...sky.sky, horizon, mid: mixLab(sky.sky.zenith, horizon, 0.5) },
    fog: { color: fog, density: local.air.density, mist: local.air.mist },
    season: sky.season,
    ground: local.ground,
    groundDecline: local.groundDecline,
    drift: local.drift,
    specks: local.air.specks,
    wind: sky.wind,
  };
}
