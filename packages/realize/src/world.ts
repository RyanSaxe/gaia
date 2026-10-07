// Turns a world blueprint into the numbers every material reads. The slots
// are chosen independently; this is where they meet: the hour tints the sky,
// the air pulls the horizon and fog toward its own color, the season turns the
// ground, and the light colors the clouds.

import type {
  AccentSpec,
  AtmosphereSpec,
  Blueprint,
  CloudSpec,
  GroundSpec,
  Kind,
  Library,
  LightSpec,
  Rgb,
  SeasonSpec,
  SkySpec,
  WindSpec,
} from "@gaia/schema";
import { hex, mixLab, seasonGround, shiftColor } from "@gaia/primitives";
import { buildSlots } from "./realize.ts";

export interface WorldLook {
  readonly light: LightSpec;
  readonly sky: {
    readonly zenith: Rgb;
    readonly mid: Rgb;
    readonly horizon: Rgb;
    readonly clouds: CloudSpec;
    readonly cloudLit: Rgb;
    readonly cloudShade: Rgb;
  };
  readonly fog: { readonly color: Rgb; readonly density: number; readonly mist: number };
  readonly season: SeasonSpec;
  /** The ground with the season applied. */
  readonly ground: GroundSpec;
  /** The ground's decline color: shared by every world, like component decline. */
  readonly groundDecline: Rgb;
  readonly drift: AccentSpec | null;
  readonly specks: number;
  readonly wind: WindSpec;
}

/** Dry, grey-brown grass: what the ground declines toward in every world. */
export const GROUND_DECLINE: Rgb = hex(0xb1a17a);

const DEEP_ZENITH: Rgb = hex(0x2c3a78);
const CLOUD_WHITE: Rgb = hex(0xfdfcf8);

function slotOutput<T>(built: ReturnType<typeof buildSlots>, name: string): T {
  const out = built.get(name)?.output;
  if (out === undefined) throw new Error(`The world has no ${name}.`);
  return out as T;
}

/** Composes a world blueprint's slot outputs into one look. */
export function realizeWorld(bp: Blueprint, k: Kind, lib: Library, seed: number): WorldLook {
  const built = buildSlots(bp, k, lib, { seed, facts: {} });
  const light = slotOutput<LightSpec>(built, "light");
  const sky = slotOutput<SkySpec>(built, "sky");
  const season = slotOutput<SeasonSpec>(built, "season");
  const air = slotOutput<AtmosphereSpec>(built, "air");
  const ground = slotOutput<GroundSpec>(built, "ground");
  const wind = slotOutput<WindSpec>(built, "wind");
  const accent = built.get("drift")?.output as AccentSpec | undefined;

  // The hour first, then the air: haze sits in front of the sunset.
  let horizon = mixLab(sky.horizon, light.horizonGlow, light.glow);
  let zenith = mixLab(sky.zenith, DEEP_ZENITH, light.zenithDim);
  zenith = mixLab(zenith, light.horizonGlow, light.glow * 0.12);
  horizon = mixLab(horizon, air.tint, air.tintAmount * 0.5);
  const fog = mixLab(horizon, air.tint, air.tintAmount * 0.5);
  const mid = mixLab(zenith, horizon, 0.5);

  const cloudLit = mixLab(CLOUD_WHITE, light.sunColor, 0.12 + light.glow * 0.45);
  const cloudShade = mixLab(mixLab(cloudLit, light.shadowColor, 0.6), zenith, 0.2);

  let drift: AccentSpec | null = null;
  if (accent !== undefined) {
    const color =
      accent.form === "leaves"
        ? season.fall
        : accent.form === "petals"
          ? shiftColor(accent.color, season.swatches.bloom ?? { hue: 0, pull: 0, maxTurn: 0, chroma: 1, lightness: 0 })
          : accent.color;
    drift = { ...accent, color };
  }

  return {
    light,
    sky: { zenith, mid, horizon, clouds: sky.clouds, cloudLit, cloudShade },
    fog: { color: fog, density: air.density, mist: air.mist },
    season,
    ground: seasonGround(ground, season),
    groundDecline: GROUND_DECLINE,
    drift,
    specks: air.specks,
    wind,
  };
}
