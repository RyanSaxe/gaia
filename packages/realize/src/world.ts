// Turns the world's and a region's blueprints into the numbers every material
// reads at one hour. The slots are chosen independently; this is where they
// meet: the hour tints the sky and night deepens it, the region's air pulls
// the horizon and fog toward its own color, and the sun or moon colors the
// clouds.

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
  SkySpec,
  StarSpec,
  WindSpec,
} from "@gaia/schema";
import { hex, mixLab, shiftColor } from "@gaia/primitives";
import { lightAt } from "./day.ts";
import { AIR } from "./sky.ts";
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
    /** The light a low sun throws on clouds from beneath and on their edges facing it. */
    readonly cloudGlow: Rgb;
    readonly moon: MoonSpec;
    readonly stars: StarSpec;
  };
  readonly wind: WindSpec;
}

/** What one region grows and breathes. */
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
/** How much richer than the sun's light a low sun's glow on clouds is: a little deeper and half again as strong in color. */
const CLOUD_GLOW = { hue: 0, pull: 0, maxTurn: 0, chroma: 1.5, lightness: -0.03 } as const;

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
  // The sun's own light and the hour's glow, deepened, as clouds catch it when the sun is low.
  const cloudGlow = shiftColor(mixLab(light.sunColor, light.horizonGlow, 0.4), CLOUD_GLOW);
  return {
    light,
    sky: { zenith, horizon, clouds: sky.clouds, cloudLit, cloudShade, cloudGlow, moon: day.moon, stars: day.stars },
    wind: slotOutput<WindSpec>(built, "wind"),
  };
}

export function realizeRegion(region: Filled, lib: Library, seed: number): RegionLook {
  const built = buildSlots(region.blueprint, region.kind, lib, { seed, facts: {} });
  return {
    ground: slotOutput<GroundSpec>(built, "cover"),
    groundDecline: GROUND_DECLINE,
    air: airOf(built),
    drift: (built.get("accents")?.output as AccentSpec | undefined) ?? null,
    natives: slotOutput<NativeFamilies>(built, "natives").families,
  };
}

const airOf = (built: ReturnType<typeof buildSlots>): AtmosphereSpec => (built.get("air")?.output as AtmosphereSpec | undefined) ?? CLEAR_AIR;

/** One region's air, as `realizeRegion` gives it. */
export function regionAir(region: Filled, lib: Library, seed: number): AtmosphereSpec {
  return airOf(buildSlots(region.blueprint, region.kind, lib, { seed, facts: {} }));
}

/**
 * The air where several regions meet, each region's weighed by `weights` (one
 * per region, at any scale): its density, mist and specks by weight, and its
 * tint by how strongly each one tints, so a clear region's tint, which pulls
 * nothing, colors nothing.
 */
export function mixAir(airs: readonly AtmosphereSpec[], weights: ArrayLike<number>): AtmosphereSpec {
  let total = 0;
  let pull = 0;
  let tint = CLEAR_AIR.tint;
  let density = 0;
  let mist = 0;
  let specks = 0;
  airs.forEach((air, i) => {
    const w = Math.max(0, weights[i] ?? 0);
    total += w;
    density += w * air.density;
    mist += w * air.mist;
    specks += w * air.specks;
    if (w * air.tintAmount <= 0) return;
    pull += w * air.tintAmount;
    tint = mixLab(tint, air.tint, (w * air.tintAmount) / pull);
  });
  if (total <= 0) return CLEAR_AIR;
  return { tint, tintAmount: pull / total, density: density / total, mist: mist / total, specks: specks / total };
}

/**
 * What the air over failing ground turns toward. Murk gathers once the ground around has declined past `from`, so
 * tired ground keeps its air and failing ground clouds it, and at full decline the haze is `thicken` times as dense,
 * low mist gathers by `mist`, and the tint greys toward `tint`, pulling the horizon and fog by at least `pull`.
 */
export const MURK = { from: 0.3, tint: hex(0x7f7b6e), pull: 0.75, thicken: 3.5, mist: 0.3 } as const;

/**
 * The air over ground that has declined by `decline` (0 thriving, 1 all it will: `groundDecline` of the ground
 * around the eye), thickening and greying as it fails. Thriving ground leaves the air exactly as it was.
 */
export function murkyAir(air: AtmosphereSpec, decline: number): AtmosphereSpec {
  const t = Math.min(1, Math.max(0, (decline - MURK.from) / (1 - MURK.from)));
  const d = t * t * (3 - 2 * t);
  if (d === 0) return air;
  return {
    tint: mixLab(air.tint, MURK.tint, d),
    tintAmount: air.tintAmount + (Math.max(air.tintAmount, MURK.pull) - air.tintAmount) * d,
    density: air.density * (1 + (MURK.thicken - 1) * d),
    mist: Math.min(1, air.mist + MURK.mist * d),
    specks: air.specks,
  };
}

/**
 * The air as an eye `height` meters above the land looks through it: the same at eye level, and from
 * `AIR.thinFrom` up its haze and low mist thin as `AIR.thinScale / (AIR.thinScale + meters above that)`, so a view
 * from high over the land sees all of it, softened by distance.
 */
export function airFromHeight(air: AtmosphereSpec, height: number): AtmosphereSpec {
  const above = height - AIR.thinFrom;
  if (!(above > 0)) return air;
  const thin = AIR.thinScale / (AIR.thinScale + above);
  return { ...air, density: air.density * thin, mist: air.mist * thin };
}

/** The shared sky seen through `air`: its horizon pulled toward the air's tint, and the fog the air lays over distance. */
export function throughAir(sky: SkyLook, air: AtmosphereSpec): Pick<WorldLook, "sky" | "fog"> {
  // The air sits in front of the sunset; at night its color fades into the dark.
  const tint = mixLab(air.tint, sky.sky.horizon, sky.light.nightness * 0.75);
  const horizon = mixLab(sky.sky.horizon, tint, air.tintAmount * 0.5);
  // Night air is only moonlit: distance dims the land a little rather than washing it pale.
  const fog = mixLab(mixLab(horizon, tint, air.tintAmount * 0.5), sky.sky.zenith, sky.light.nightness * 0.3);
  return {
    sky: { ...sky.sky, horizon, mid: mixLab(sky.sky.zenith, horizon, 0.5) },
    fog: { color: fog, density: air.density, mist: air.mist },
  };
}

/** Composes the shared sky at `hour` with one region's air and ground, as seen from inside that region. */
export function realizeWorld(world: Filled, region: Filled, lib: Library, seed: number, hour: number): WorldLook {
  const sky = realizeSky(world, lib, seed, hour);
  const local = realizeRegion(region, lib, seed);
  return {
    light: sky.light,
    ...throughAir(sky, local.air),
    ground: local.ground,
    groundDecline: local.groundDecline,
    drift: local.drift,
    specks: local.air.specks,
    wind: sky.wind,
  };
}
