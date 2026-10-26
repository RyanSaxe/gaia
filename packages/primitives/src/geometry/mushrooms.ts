// Mushrooms: stalks under caps in the palette's cap swatch, grown in a ring,
// a huddle or a scatter of little groups, young buttons among them. A cap
// has real thickness: a rounded lip at its margin and ridged gills beneath,
// rising to the stalk. Caps are a little uneven and mottled, and no two caps
// meet. As vitality falls a cap greys and slumps, tipping toward one side
// about a hinge under its rim; then many drop, shrinking down to the ground
// beside their stalk, and the stalk shrivels after. A few hold on, grey and
// slumped, to the end. Gills under each cap glow faintly.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { mushroomParams } from "../wildflowers.ts";
import { PartBuilder, type V3, add, addScaled, basis, clamp, cross, lossThreshold, noise3, normalize, scale } from "./kit.ts";

type Grouping = Resolved<typeof mushroomParams>["grouping"];
type CapShape = Resolved<typeof mushroomParams>["cap"];

interface Mushroom {
  readonly foot: V3;
  /** Height of the cap's crown over the ground. */
  readonly height: number;
  /** The way it leans and, failing, tips: level, unit. */
  readonly lean: V3;
  /** How far it leans that way, radians. */
  readonly tilt: number;
  /** The cap's radius and its crown's height over the rim, meters. */
  readonly radius: number;
  readonly crown: number;
  readonly r: Rand;
}

/**
 * A cap's profile from its crown round its lip to where the gills begin:
 * (share of the radius, share of the crown's height over the rim).
 */
const PROFILES: Record<CapShape, readonly (readonly [number, number])[]> = {
  domed: [[0, 1], [0.3, 0.96], [0.56, 0.85], [0.78, 0.65], [0.93, 0.38], [1, 0.1], [0.98, -0.04], [0.9, -0.09]],
  flat: [[0, 1], [0.16, 0.95], [0.42, 0.84], [0.7, 0.64], [0.9, 0.36], [1, 0.06], [0.98, -0.1], [0.91, -0.15]],
  pointed: [[0, 1], [0.1, 0.9], [0.3, 0.68], [0.54, 0.44], [0.78, 0.2], [0.97, 0.02], [0.96, -0.06], [0.89, -0.08]],
};
/** Per shape: cap radius and crown height over the rim as shares of the mushroom's height, the stalk's radius as a share of the cap's, and its girth from foot to top. */
const FORM: Record<CapShape, { readonly radius: number; readonly crown: number; readonly stalk: number; readonly girth: readonly number[] }> = {
  domed: { radius: 0.32, crown: 0.28, stalk: 0.22, girth: [1.45, 1.28, 1.08, 1, 0.94, 0.9] },
  flat: { radius: 0.42, crown: 0.19, stalk: 0.16, girth: [1.55, 1.2, 0.98, 0.9, 0.84, 0.8] },
  pointed: { radius: 0.22, crown: 0.46, stalk: 0.17, girth: [1.12, 1.06, 1, 0.95, 0.9, 0.86] },
};
/** Where up the stalk each ring of its girth stands. */
const STALK_RINGS = [0, 0.07, 0.25, 0.55, 0.82, 1];
const STALK_SIDES = 9;
/** The share of mushrooms that never drop their caps: they stand slumped and grey to the end. */
const STUBBORN = 0.35;

export function buildMushrooms(p: Resolved<typeof mushroomParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork("mushrooms");
  const caps = new PartBuilder("cap");
  const flesh = new PartBuilder("stalk");
  const spots = new PartBuilder("stalk");
  const s = 0.85 + 0.15 * (ctx.facts.scale ?? 1);
  for (const m of layout(p.grouping, p.cap, p.height * s, r.fork("layout"))) emitMushroom(caps, flesh, spots, m, p.cap);
  const parts = [flesh.part(), caps.part()];
  if (spots.vertexCount > 0) parts.push(spots.part());
  return { parts, anchors: [] };
}

/** The widest a stalk is, as a share of its cap's radius (`FORM`'s stalk times its widest girth), for keeping caps clear of it. */
const STALK_SHARE = 0.35;

/** Where a mushroom's cap sits: the middle of its rim, and the way the cap faces. */
function capOf(m: Mushroom): { rim: V3; axis: V3 } {
  const lean = Math.tan(m.tilt);
  const up = m.height - m.crown;
  // The stalk curves up toward its cap, so the cap faces the sky more than the stalk's lean.
  return { rim: addScaled(addScaled(m.foot, [0, 1, 0], up), m.lean, up * lean), axis: normalize(add([0, 1, 0], scale(m.lean, lean * 0.35))) };
}

/** Whether `a`'s cap would cut into `b`'s cap or stalk. */
function meets(a: Mushroom, b: Mushroom): boolean {
  const ca = capOf(a).rim;
  const cb = capOf(b).rim;
  const across = Math.hypot(ca[0] - cb[0], ca[2] - cb[2]);
  const overlap = ca[1] - 0.2 * a.crown < cb[1] + b.crown && cb[1] - 0.2 * b.crown < ca[1] + a.crown;
  if (overlap && across < (a.radius + b.radius) * 1.04) return true;
  // b's stalk where a's cap stands, if a's cap is below b's.
  if (ca[1] + a.crown > cb[1]) return false;
  const k = clamp((ca[1] - b.foot[1]) / Math.max(cb[1] - b.foot[1], 1e-3), 0, 1);
  const sx = b.foot[0] + (cb[0] - b.foot[0]) * k;
  const sz = b.foot[2] + (cb[2] - b.foot[2]) * k;
  return Math.hypot(ca[0] - sx, ca[2] - sz) < a.radius + b.radius * STALK_SHARE + 0.01;
}

function layout(grouping: Grouping, shape: CapShape, tallest: number, r: Rand): Mushroom[] {
  const form = FORM[shape];
  const wants: Mushroom[] = [];
  const spot = (x: number, z: number, height: number, lean: V3, tilt = r.range(0.03, 0.18), size = r.range(0.85, 1.15)): void => {
    const fr = r.fork(`m${wants.length}`);
    wants.push({ foot: [x, -0.03, z], height, lean: normalize(lean), tilt, radius: height * form.radius * size, crown: height * form.crown * (0.7 + 0.3 * size), r: fr });
  };
  const away = (x: number, z: number): V3 => normalize([x + 1e-3, 0, z]);
  const jitter = (): V3 => [r.range(-1, 1), 0, r.range(-1, 1)];
  if (grouping === "ring") {
    const radius = 0.45 + 0.9 * tallest;
    const n = Math.round((Math.PI * 2 * radius) / (0.26 + 0.3 * tallest));
    const gap = Math.floor(r.next() * n);
    for (let k = 0; k < n; k++) {
      if (k === gap) continue;
      const a = ((k + r.range(-0.25, 0.25)) / n) * Math.PI * 2;
      const d = radius * r.range(0.9, 1.08);
      spot(Math.cos(a) * d, Math.sin(a) * d, tallest * r.range(0.62, 1), add(away(Math.cos(a), Math.sin(a)), scale(jitter(), 0.7)));
    }
  } else if (grouping === "cluster") {
    const n = 7 + Math.floor(r.next() * 4);
    for (let k = 0; k < n; k++) {
      const a = r.next() * Math.PI * 2;
      const d = k === 0 ? 0 : (0.03 + 0.1 * Math.sqrt(r.next())) * (0.6 + tallest);
      const edge = d / (0.13 * (0.6 + tallest));
      // Small caps of much a size, the outer ones leaning out and a little lower, so they crowd in tiers.
      spot(Math.cos(a) * d, Math.sin(a) * d, tallest * (1 - 0.25 * edge) * r.range(0.8, 1.05), k === 0 ? jitter() : away(Math.cos(a), Math.sin(a)), k === 0 ? 0.04 : 0.2 + 0.25 * edge, r.range(0.55, 0.75));
    }
  } else {
    // Little groups dotted about, each of one to three (slender caps two to four), keeping their distance.
    const groups = shape === "pointed" ? 6 + Math.floor(r.next() * 3) : 4 + Math.floor(r.next() * 3);
    const reach = 0.7 + 1.1 * tallest;
    const centers: [number, number][] = [];
    for (let tries = 0; centers.length < groups && tries < 300; tries++) {
      const a = r.next() * Math.PI * 2;
      const d = reach * Math.sqrt(r.next());
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (centers.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 0.3 + 0.35 * tallest)) continue;
      centers.push([x, z]);
    }
    for (const [cx, cz] of centers) {
      const count = (shape === "pointed" ? 2 : 1) + Math.floor(r.next() * 3);
      for (let k = 0; k < count; k++) {
        const a = r.next() * Math.PI * 2;
        const d = k === 0 ? 0 : r.range(0.05, 0.12) * (0.6 + tallest);
        spot(cx + Math.cos(a) * d, cz + Math.sin(a) * d, tallest * r.range(0.6, 1) * (k === 0 ? 1 : 0.85), k === 0 ? jitter() : away(Math.cos(a), Math.sin(a)));
      }
    }
  }
  // The tallest stands as tall as asked.
  const most = Math.max(...wants.map((m) => m.height));
  const sized = wants.map((m) => ({ ...m, height: (m.height * tallest) / most, radius: (m.radius * tallest) / most, crown: (m.crown * tallest) / most }));
  // Young buttons at the feet of a few.
  for (const m of sized.slice(0, Math.ceil(sized.length / 3))) {
    const a = m.r.next() * Math.PI * 2;
    const d = m.radius * 1.4;
    const h = m.height * m.r.range(0.3, 0.42);
    sized.push({ ...m, foot: [m.foot[0] + Math.cos(a) * d, -0.03, m.foot[2] + Math.sin(a) * d], height: h, lean: [Math.cos(a), 0, Math.sin(a)], tilt: m.r.range(0.08, 0.22), radius: h * form.radius * 0.85, crown: h * form.crown * 1.15, r: m.r.fork("button") });
  }
  return settle(sized);
}

/** Stands the tallest first; each one after leans further out, stands lower or grows a smaller cap until its cap meets no other cap or stalk, or is left out. */
function settle(wants: readonly Mushroom[]): Mushroom[] {
  const placed: Mushroom[] = [];
  for (const want of [...wants].sort((a, b) => b.height - a.height)) {
    let m = want;
    for (let tries = 0; tries < 18 && placed.some((o) => meets(m, o) || meets(o, m)); tries++) {
      const step = tries % 3;
      m = step === 0 ? { ...m, tilt: Math.min(0.5, m.tilt + 0.07) } : step === 1 ? { ...m, radius: m.radius * 0.88, crown: m.crown * 0.94 } : { ...m, height: m.height * 0.9, radius: m.radius * 0.95, crown: m.crown * 0.92 };
    }
    if (!placed.some((o) => meets(m, o) || meets(o, m))) placed.push(m);
  }
  return placed;
}

function emitMushroom(caps: PartBuilder, flesh: PartBuilder, spots: PartBuilder, m: Mushroom, shape: CapShape): void {
  const form = FORM[shape];
  const { radius, crown } = m;
  const { rim, axis: capAxis } = capOf(m);
  // The cap sits a little askew on its stalk.
  const axis = normalize(add(capAxis, [m.r.range(-0.1, 0.1), 0, m.r.range(-0.1, 0.1)]));
  const sides = m.height < 0.25 ? 14 : 20;
  // Failing, the cap slumps about a hinge under its rim on the far side, and drops beside the stalk.
  const hinge = addScaled(rim, m.lean, -0.5 * radius);
  const fallTo = addScaled(m.foot, m.lean, radius * 0.9);
  const stubborn = m.r.next() < STUBBORN;
  const capLoss = stubborn ? 0 : lossThreshold(m.r.next(), 0.5, 0.05);
  const tint = m.r.range(-0.015, 0.015);
  const tone = m.r.range(-0.07, 0.07);
  const capCh = { loss: capLoss, droop: 0.45, wither: 1, glow: 0, pivot: fallTo, bough: hinge, tint };
  const [u, v] = basis(axis);
  const seed = Math.floor(m.r.next() * 1e6);
  const squash = m.r.range(-0.06, 0.06);
  const squashAt = m.r.next() * Math.PI;
  const wave = shape === "flat" ? m.r.range(0.03, 0.07) : 0.015;
  const waves = 5 + Math.floor(m.r.next() * 3);
  const phase = m.r.next() * Math.PI * 2;
  // An uneven cap: a little oval, its margin lumpy and, on a flat cap, wavy.
  const around = (rho: number, eta: number, a: number): V3 => {
    const lump = 1 + squash * Math.cos(2 * (a - squashAt)) + 0.035 * noise3(Math.cos(a) * 1.8, Math.sin(a) * 1.8, rho * 2, seed);
    const out = add(scale(u, Math.cos(a) * rho * radius * lump), scale(v, Math.sin(a) * rho * radius * lump));
    return addScaled(add(rim, out), axis, (eta + wave * Math.sin(a * waves + phase) * rho * rho * rho) * crown);
  };
  const radialAt = (a: number): V3 => add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
  // Mottled: the cap's own shade wanders in soft blotches, darker toward its lip.
  const mottle = (p: V3): number => tone + 0.14 * noise3(p[0] * (3 / radius), p[1] * (3 / radius), p[2] * (3 / radius), seed + 7);
  const hue = (p: V3): number => tint + 0.012 * noise3(p[0] * (2 / radius), p[1] * (2 / radius), p[2] * (2 / radius), seed + 11);
  const profile = PROFILES[shape];
  // Flat and pointed caps darken toward their middle, as many do.
  const shades = shape === "domed" ? [0.7, 0.74, 0.78, 0.78, 0.74, 0.66, 0.5, 0.42] : [0.5, 0.56, 0.66, 0.74, 0.76, 0.68, 0.52, 0.42];
  const shadeOf = (i: number): number => shades[i] ?? 0.6;
  const capShade = (i: number, p: V3): number => shadeOf(i) + mottle(p);
  const normalOf = (i: number, a: number): V3 => {
    const [r0, e0] = profile[Math.max(0, i - 1)] as readonly [number, number];
    const [r1, e1] = profile[Math.min(profile.length - 1, i + 1)] as readonly [number, number];
    return normalize(add(scale(radialAt(a), -(e1 - e0) * crown), scale(axis, (r1 - r0) * radius)));
  };
  const apexAt = around(0, 1, 0);
  const apex = caps.vertex(apexAt, axis, capShade(0, apexAt), { ...capCh, tint: hue(apexAt) });
  const rows: number[] = [];
  for (let i = 1; i < profile.length; i++) {
    const [rho, eta] = profile[i] as readonly [number, number];
    rows.push(caps.vertexCount);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const p = around(rho, eta, a);
      caps.vertex(p, normalOf(i, a), capShade(i, p), { ...capCh, tint: hue(p) });
    }
  }
  for (let j = 0; j < sides; j++) caps.triangle(apex, (rows[0] as number) + j, (rows[0] as number) + ((j + 1) % sides));
  for (let k = 0; k + 1 < rows.length; k++) band(caps, rows[k] as number, rows[k + 1] as number, sides);
  // Pale spots on domed and flat caps, shaded as the cap beneath them.
  if (shape !== "pointed") {
    const count = 8 + Math.floor(m.r.next() * 6);
    for (let k = 0; k < count; k++) {
      const a = m.r.next() * Math.PI * 2;
      // On the round surface the cap's facets cut inside of, so no spot stands proud of the cap's outline.
      const rho = (0.1 + 0.62 * Math.sqrt(m.r.next())) * Math.cos(Math.PI / sides);
      const i = profile.findIndex(([pr]) => pr >= rho);
      const [r0, e0] = profile[i - 1] as readonly [number, number];
      const [r1, e1] = profile[i] as readonly [number, number];
      const along = (rho - r0) / (r1 - r0);
      const eta = e0 + (e1 - e0) * along;
      // Lit and shaded exactly as the cap beneath, so only the swatch tells a spot from its cap.
      const n = normalize(add(scale(normalOf(i - 1, a), 1 - along), scale(normalOf(i, a), along)));
      const center = addScaled(around(rho, eta, a), n, 0.002);
      const [su, sv] = basis(n);
      const size = radius * m.r.range(0.045, 0.085);
      const shade = shadeOf(i - 1) + (shadeOf(i) - shadeOf(i - 1)) * along + mottle(center);
      const ch = { ...capCh, tint: hue(center) };
      const hub = spots.vertex(center, n, shade, ch);
      for (let j = 0; j < 6; j++) {
        const b = (j / 6) * Math.PI * 2;
        spots.vertex(addScaled(addScaled(center, su, Math.cos(b) * size * m.r.range(0.75, 1.2)), sv, Math.sin(b) * size * m.r.range(0.75, 1.2)), n, shade, ch);
      }
      for (let j = 0; j < 6; j++) spots.triangle(hub, hub + 1 + j, hub + 1 + ((j + 1) % 6));
    }
  }
  // The gills beneath, ridged, rising from the lip to the stalk, in the stalk's pale flesh.
  // A small cap still stands on a stalk thick enough to carry it.
  const stalkTop = Math.max(radius * form.stalk, 0.028 * m.height);
  const [lastR, lastE] = profile[profile.length - 1] as readonly [number, number];
  const gillCh = { ...capCh, wither: 0.85, glow: 0.12, tint: tint * 0.5 };
  const under: number[] = [];
  for (const [rho, eta, shade] of [[lastR, lastE, 0.5], [0.62, lastE + 0.1, 0.4], [(stalkTop / radius) * 1.15, lastE + 0.2, 0.34]] as const) {
    under.push(flesh.vertexCount);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ridge = rho < lastR && rho > 0.3 ? (j % 2 === 0 ? 0.025 : -0.025) : 0;
      flesh.vertex(around(rho, eta + ridge, a), normalize(addScaled(scale(axis, -1), radialAt(a), 0.25)), shade, gillCh);
    }
  }
  for (let k = 0; k + 1 < under.length; k++) band(flesh, under[k] as number, under[k + 1] as number, sides);
  // The stalk: swollen at its foot, stained by the soil, bowed a little, up into the cap.
  const stalkCh = { loss: stubborn ? 0 : clamp(capLoss * 0.5, 0.02, 0.3), droop: 0, wither: 0.7, glow: 0, pivot: m.foot, bough: m.foot, tint: tint * 0.4 };
  const into = addScaled(rim, axis, (lastE + 0.36) * crown);
  const side = normalize(cross([0, 1, 0], m.lean));
  const bow = m.r.range(-0.04, 0.04) * m.height;
  // It leaves its foot leaning out and turns up under its cap: out quickly low down, straight up near the top.
  const rise: V3 = [0, into[1] - m.foot[1], 0];
  const reach: V3 = [into[0] - m.foot[0], 0, into[2] - m.foot[2]];
  const stalkRows: number[] = [];
  STALK_RINGS.forEach((t, k) => {
    const c = add(add(add(m.foot, scale(rise, t)), scale(reach, 1 - (1 - t) * (1 - t))), scale(side, Math.sin(2 * Math.PI * t) * bow));
    const along = normalize(add(rise, scale(reach, 2 * (1 - t))));
    const su = normalize(addScaled(side, along, -(side[0] * along[0] + side[1] * along[1] + side[2] * along[2])));
    const sv = normalize(cross(along, su));
    stalkRows.push(flesh.vertexCount);
    for (let j = 0; j < STALK_SIDES; j++) {
      const a = (j / STALK_SIDES) * Math.PI * 2;
      const n = add(scale(su, Math.cos(a)), scale(sv, Math.sin(a)));
      const rough = 1 + 0.06 * noise3(Math.cos(a) * 2, t * 4, Math.sin(a) * 2, seed + 3);
      flesh.vertex(addScaled(c, n, stalkTop * (form.girth[k] ?? 1) * rough), n, 0.34 + 0.4 * Math.sqrt(t) + 0.05 * noise3(j * 0.9, t * 6, 0, seed + 5), stalkCh);
    }
  });
  for (let k = 0; k + 1 < stalkRows.length; k++) band(flesh, stalkRows[k + 1] as number, stalkRows[k] as number, STALK_SIDES);
  // Most grown domed and flat caps leave a skirt hanging round the stalk under them, as fly agarics and parasols do.
  if (shape !== "pointed" && m.height > 0.25 && m.r.next() < 0.75) {
    const t = 0.8;
    const c = add(add(add(m.foot, scale(rise, t)), scale(reach, 1 - (1 - t) * (1 - t))), scale(side, Math.sin(2 * Math.PI * t) * bow));
    const along = normalize(add(rise, scale(reach, 2 * (1 - t))));
    const su = normalize(addScaled(side, along, -(side[0] * along[0] + side[1] * along[1] + side[2] * along[2])));
    const sv = normalize(cross(along, su));
    const skirt: number[] = [];
    for (const [reachOut, drop, shade] of [[1.05, 0, 0.62], [2, 0.045, 0.5]] as const) {
      skirt.push(flesh.vertexCount);
      for (let j = 0; j < STALK_SIDES; j++) {
        const a = (j / STALK_SIDES) * Math.PI * 2;
        const n = add(scale(su, Math.cos(a)), scale(sv, Math.sin(a)));
        const frill = 1 + 0.12 * noise3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 1, seed + 9);
        flesh.vertex(addScaled(addScaled(c, n, stalkTop * 0.92 * reachOut * frill), along, -drop * m.height), normalize(addScaled(n, along, 0.6)), shade, stalkCh);
      }
    }
    band(flesh, skirt[0] as number, skirt[1] as number, STALK_SIDES);
  }
}

/** Quads between two rings of `sides` vertices, front faces outward when `a` is the upper ring of a surface turned about its axis. */
function band(out: PartBuilder, a: number, b: number, sides: number): void {
  for (let j = 0; j < sides; j++) {
    const a0 = a + j;
    const a1 = a + ((j + 1) % sides);
    const b0 = b + j;
    const b1 = b + ((j + 1) % sides);
    out.triangle(a0, b0, a1);
    out.triangle(a1, b0, b1);
  }
}
