// Landform primitives: the ground shape of one region. Their declared
// parameters are what Jev fills; each build returns a height field and the
// water beds it holds, in the region's frame. Levels stay gentle on purpose:
// the world's relief budget keeps sight lines short, so no landform is a
// mountain.

import { type BuildContext, type HeightField, type Landform, type StreamBed, primitive, t } from "@gaia/schema";
import { troughOffset } from "./geometry/field.ts";

/** Radians from +x (east) toward +z (south). */
const COMPASS = {
  east: 0,
  south: Math.PI / 2,
  west: Math.PI,
  north: -Math.PI / 2,
} as const;

const seedOf = (ctx: BuildContext, label: string): number => Math.floor(ctx.rand.fork(label).next() * 2 ** 31);
/** The region's width in meters, from the world layout. */
const extentOf = (ctx: BuildContext): number => ctx.facts.extent ?? 150;

const sum = (...of: HeightField[]): HeightField => ({ op: "sum", of });
const scale = (by: number, of: HeightField): HeightField => ({ op: "scale", by, of });
const constant = (value: number): HeightField => ({ op: "constant", value });
const noise = (seed: number, wavelength: number, octaves: number, gain: number, angle = 0, stretch = 1): HeightField => ({
  op: "noise",
  seed,
  wavelength,
  octaves,
  gain,
  angle,
  stretch,
  style: "smooth",
});

// ---------- rolling hills ----------

export const rollingHillsParams = {
  height: t.scale("How high the hills rise above their hollows", {
    "barely rolling": 2.5,
    gentle: 4.5,
    rolling: 7,
    bold: 10,
  }),
  breadth: t.scale("How far apart the hilltops are", {
    "close and lumpy": 32,
    "moderately spaced": 50,
    "broad and sweeping": 78,
  }),
  roughness: t.scale("How uneven the slopes are", { smooth: 0.3, "softly uneven": 0.42, rugged: 0.56 }),
  grain: t.choice("Which way the hills run", {
    round: "No direction: rounded hills every way",
    "north-south": "Long hills running north to south",
    "east-west": "Long hills running east to west",
    diagonal: "Long hills running northeast to southwest",
  }),
};

const GRAIN = { round: 0, "north-south": Math.PI / 2, "east-west": 0, diagonal: -Math.PI / 4 } as const;

export const rollingHills = primitive({
  id: "rolling-hills@1",
  role: "Relief",
  doc: "Rounded grassy hills that roll on in every direction.",
  params: rollingHillsParams,
  build: (p, ctx): Landform => ({
    height: sum(
      scale(p.height * 0.62, noise(seedOf(ctx, "hills"), p.breadth, 4, p.roughness, GRAIN[p.grain], p.grain === "round" ? 1 : 1.9)),
      scale(p.height * 0.1, noise(seedOf(ctx, "swell"), p.breadth * 2.6, 2, 0.5)),
    ),
    water: [],
  }),
});

// ---------- valley ----------

export const valleyParams = {
  depth: t.scale("How far the floor lies below the valley's shoulders", { shallow: 3, moderate: 5, deep: 7 }),
  width: t.scale("How wide the valley is from shoulder to shoulder", { narrow: 44, open: 64, broad: 90 }),
  run: t.choice("Which way the valley runs", {
    "north-south": "From north to south",
    "east-west": "From east to west",
    "northeast-southwest": "From northeast to southwest",
    "northwest-southeast": "From northwest to southeast",
  }),
  fall: t.scale("How steeply the floor descends along the valley", { "nearly level": 0.005, gentle: 0.012, steady: 0.022 }),
  meander: t.scale("How much the valley winds", { straight: 0.08, winding: 0.35, "strongly meandering": 0.6 }),
  stream: t.choice("What runs along the floor", {
    "dry bed": "A grassy floor with no water",
    trickle: "A narrow, shallow trickle",
    brook: "A lively brook",
  }),
};

const RUN = {
  "north-south": Math.PI / 2,
  "east-west": 0,
  "northeast-southwest": (3 * Math.PI) / 4,
  "northwest-southeast": Math.PI / 4,
} as const;

const STREAM = { "dry bed": null, trickle: { width: 2.4, depth: 0.45 }, brook: { width: 3.8, depth: 0.7 } } as const;

export const valley = primitive({
  id: "valley@1",
  role: "Relief",
  doc: "A long valley between two gentle shoulders, with a stream bed along its floor.",
  params: valleyParams,
  build: (p, ctx): Landform => {
    const extent = extentOf(ctx);
    const angle = RUN[p.run];
    const trough = {
      op: "trough",
      seed: seedOf(ctx, "axis"),
      angle,
      halfWidth: p.width / 2,
      meander: p.meander,
      meanderWavelength: 120,
    } as const;
    const height = sum(
      constant(-p.depth * 0.6),
      scale(p.depth, trough),
      { op: "plane", angle, grade: p.fall, reach: extent * 0.6 },
      // Shoulders roll; the floor stays smooth for the stream.
      { op: "product", of: [trough, scale(p.depth * 0.32, noise(seedOf(ctx, "shoulders"), 42, 3, 0.45))] },
    );
    const water: StreamBed[] = [];
    const bed = STREAM[p.stream];
    if (bed !== null) {
      // From the high end (+u, where the plane rises) to the low end.
      const reach = extent * 0.6;
      const points: number[] = [];
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let u = reach; u >= -reach; u -= 2) {
        const off = troughOffset(trough, u);
        points.push(u * c - off * s, u * s + off * c);
      }
      water.push({ kind: "stream", path: new Float32Array(points), width: bed.width, depth: bed.depth });
    }
    return { height, water };
  },
});

// ---------- terraces ----------

export const terracesParams = {
  form: t.choice("How the steps are laid out", {
    hillside: "Straight steps climbing across the region",
    "terraced hill": "Rings of steps around a rounded hill",
  }),
  rise: t.scale("How tall each step is", { "knee-high": 0.6, "waist-high": 1.1, "head-high": 1.8, tall: 2.6 }),
  climb: t.scale("How high the steps climb in all", { "a low rise": 4, "a hillside": 7, "a tall hillside": 10 }),
  facing: t.choice("Which way the steps look out", {
    north: "Toward the north",
    east: "Toward the east",
    south: "Toward the south",
    west: "Toward the west",
  }),
  edge: t.scale("How each step meets the next", { "soft and grassy": 0.7, crisp: 0.4 }),
};

/** Risers never get steeper than this, whatever the edge: steps stay climbable. */
const RISER_GRADE = 0.7;

export const terraces = primitive({
  id: "terraces@1",
  role: "Relief",
  doc: "Low earthen steps climbing a slope, like old rice terraces.",
  params: terracesParams,
  build: (p, ctx): Landform => {
    const extent = extentOf(ctx);
    const out = COMPASS[p.facing];
    const wobble = scale(p.rise * 0.45, noise(seedOf(ctx, "wobble"), 38, 2, 0.4));
    let base: HeightField;
    let grade: number;
    if (p.form === "hillside") {
      const reach = extent * 0.45;
      grade = p.climb / (2 * reach * Math.tanh(1));
      base = sum({ op: "plane", angle: out + Math.PI, grade, reach }, wobble);
    } else {
      const radius = extent * 0.42;
      grade = (1.5 * p.climb) / radius;
      base = sum(scale(p.climb, { op: "dome", radius }), wobble);
    }
    // A riser climbs one step over `riser` of the tread's run, so its grade is base grade * 1.5 / riser.
    const riser = Math.min(0.92, Math.max(p.edge, (1.5 * grade * 1.3) / RISER_GRADE));
    return {
      height: sum(constant(-p.climb * 0.45), { op: "terrace", step: p.rise, riser, of: base }),
      water: [],
    };
  },
});

// ---------- basin ----------

export const basinParams = {
  depth: t.scale("How deep the hollow is", { "a shallow dip": 2.5, "a bowl": 4.5, "a deep hollow": 6.5 }),
  size: t.scale("How wide the hollow is", { small: 26, medium: 36, wide: 48 }),
  rim: t.scale("How the edge meets the land around it", {
    "melting into the land": 0,
    "a soft rim": 0.22,
    "a raised rim": 0.45,
  }),
  pond: t.flag("Does water collect at the bottom?", "A pond fills the bottom", "A dry, grassy hollow"),
};

export const basin = primitive({
  id: "basin@1",
  role: "Relief",
  doc: "A round hollow in the land that may hold a pond.",
  params: basinParams,
  build: (p, ctx): Landform => ({
    height: sum(
      constant(p.depth * 0.3),
      scale(-p.depth, { op: "dome", radius: p.size }),
      scale(p.rim * p.depth, { op: "ring", radius: p.size, width: p.size * 0.35 }),
      scale(0.9, noise(seedOf(ctx, "floor"), 36, 3, 0.45)),
    ),
    water: p.pond ? [{ kind: "pond", x: 0, z: 0, radius: p.size * 0.55, depth: Math.min(1.3, p.depth * 0.25) }] : [],
  }),
});

// ---------- dunes ----------

export const dunesParams = {
  height: t.scale("How tall the ridges are", { ripples: 1, "low dunes": 2, "tall dunes": 3.2 }),
  spacing: t.scale("How far apart the ridges are", { tight: 20, even: 28, wide: 40 }),
  wind: t.choice("Which way the wind that shaped them blows", {
    "from the west": "Ridges run north to south, steep faces to the east",
    "from the north": "Ridges run east to west, steep faces to the south",
    "from the east": "Ridges run north to south, steep faces to the west",
    "from the south": "Ridges run east to west, steep faces to the north",
  }),
  wander: t.scale("How regular the ridges are", { regular: 0.15, wavering: 0.45, broken: 0.9 }),
};

const WIND = { "from the west": COMPASS.east, "from the north": COMPASS.south, "from the east": COMPASS.west, "from the south": COMPASS.north } as const;

export const dunes = primitive({
  id: "dunes@1",
  role: "Relief",
  doc: "Long, gentle wind-shaped ridges, like grassy dunes.",
  params: dunesParams,
  build: (p, ctx): Landform => ({
    height: sum(
      constant(-p.height * 0.4),
      scale(p.height, { op: "dunes", seed: seedOf(ctx, "dunes"), wavelength: p.spacing, angle: WIND[p.wind], wander: p.wander }),
      scale(0.7, noise(seedOf(ctx, "swell"), 70, 2, 0.5)),
    ),
    water: [],
  }),
});

// ---------- meadow ----------

export const meadowParams = {
  undulation: t.scale("How much the ground undulates", {
    "flat as a lawn": 0.5,
    "softly undulating": 1.4,
    "gently uneven": 2.4,
  }),
  tilt: t.scale("How much the whole meadow leans", { level: 0, "slightly tilted": 0.015, tilted: 0.035 }),
  facing: t.choice("Which way it leans", {
    north: "Down toward the north",
    east: "Down toward the east",
    south: "Down toward the south",
    west: "Down toward the west",
  }),
};

export const meadow = primitive({
  id: "meadow@1",
  role: "Relief",
  doc: "Open, nearly flat ground with a soft undulation.",
  params: meadowParams,
  build: (p, ctx): Landform => ({
    height: sum(scale(p.undulation, noise(seedOf(ctx, "meadow"), 55, 3, 0.4)), {
      op: "plane",
      angle: COMPASS[p.facing] + Math.PI,
      grade: p.tilt,
      reach: extentOf(ctx) * 0.5,
    }),
    water: [],
  }),
});

export const RELIEF_PRIMITIVES = [rollingHills, valley, terraces, basin, dunes, meadow];
