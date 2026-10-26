// Mushrooms: pale stalks under caps in the palette's cap swatch, grown in a
// ring, a huddle or a loose scatter, a few young buttons among them. As
// vitality falls a cap greys and slumps, tipping toward one side about a
// hinge under its rim; then many drop, shrinking down to the ground beside
// their stalk, and the stalk shrivels after. A few hold on, grey and
// slumped, to the end. Gills under each cap glow faintly.

import type { BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { mushroomParams } from "../wildflowers.ts";
import { PartBuilder, type V3, add, addScaled, basis, clamp, lossThreshold, normalize, scale } from "./kit.ts";

type Grouping = Resolved<typeof mushroomParams>["grouping"];
type CapShape = Resolved<typeof mushroomParams>["cap"];

interface Mushroom {
  readonly foot: V3;
  /** Height of the cap's crown over the ground. */
  readonly height: number;
  /** The way it leans and, failing, tips: level, unit. */
  readonly lean: V3;
  /** How far it leans that way, radians, and its cap's size as a share of its shape's. */
  readonly tilt: number;
  readonly capSize: number;
  readonly r: Rand;
}

/** A cap's profile from its crown to its rim: (share of the radius, share of the crown's height over the rim). */
const PROFILES: Record<CapShape, readonly (readonly [number, number])[]> = {
  domed: [[0, 1], [0.36, 0.95], [0.66, 0.8], [0.87, 0.55], [0.99, 0.25], [1, 0.04], [0.93, -0.06]],
  flat: [[0, 1], [0.14, 0.92], [0.34, 0.72], [0.62, 0.45], [0.86, 0.2], [1, 0]],
  pointed: [[0, 1], [0.1, 0.9], [0.3, 0.68], [0.55, 0.42], [0.8, 0.17], [1, 0]],
};
/** Per shape: cap radius and crown height over the rim as shares of the mushroom's height, and the stalk's radius as a share of the cap's. */
const FORM: Record<CapShape, { readonly radius: number; readonly crown: number; readonly stalk: number }> = {
  domed: { radius: 0.36, crown: 0.3, stalk: 0.24 },
  flat: { radius: 0.46, crown: 0.2, stalk: 0.15 },
  pointed: { radius: 0.27, crown: 0.42, stalk: 0.2 },
};
const SIDES = 14;
const STALK_SIDES = 7;
/** The share of mushrooms that never drop their caps: they stand slumped and grey to the end. */
const STUBBORN = 0.35;

export function buildMushrooms(p: Resolved<typeof mushroomParams>, ctx: BuildContext): Built {
  const r = ctx.rand.fork("mushrooms");
  const caps = new PartBuilder("cap");
  const flesh = new PartBuilder("stalk");
  const s = 0.85 + 0.15 * (ctx.facts.scale ?? 1);
  for (const m of layout(p.grouping, p.height * s, r.fork("layout"))) emitMushroom(caps, flesh, m, p.cap);
  return { parts: [flesh.part(), caps.part()], anchors: [] };
}

function layout(grouping: Grouping, tallest: number, r: Rand): Mushroom[] {
  const out: Mushroom[] = [];
  const spot = (x: number, z: number, height: number, lean: V3, tilt = r.range(0.02, 0.12), capSize = 1): void => {
    out.push({ foot: [x, -0.02, z], height, lean: normalize(lean), tilt, capSize, r: r.fork(`m${out.length}`) });
  };
  const away = (x: number, z: number): V3 => normalize([x + 1e-3, 0, z]);
  const far = (x: number, z: number, gap: number): boolean => out.every((m) => Math.hypot(m.foot[0] - x, m.foot[2] - z) > gap);
  if (grouping === "ring") {
    const radius = 0.45 + 0.9 * tallest;
    const n = Math.round((Math.PI * 2 * radius) / (0.3 + 0.35 * tallest));
    const gap = Math.floor(r.next() * n);
    for (let k = 0; k < n; k++) {
      if (k === gap) continue;
      const a = ((k + r.range(-0.2, 0.2)) / n) * Math.PI * 2;
      const d = radius * r.range(0.9, 1.08);
      spot(Math.cos(a) * d, Math.sin(a) * d, tallest * r.range(0.72, 1), add(away(Math.cos(a), Math.sin(a)), [r.range(-0.6, 0.6), 0, r.range(-0.6, 0.6)]));
    }
  } else if (grouping === "cluster") {
    const n = 6 + Math.floor(r.next() * 3);
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const a = r.next() * Math.PI * 2;
      const d = k === 0 ? 0 : (0.04 + 0.1 * Math.sqrt(r.next())) * (0.6 + tallest);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!far(x, z, 0.04 + 0.05 * tallest)) continue;
      // The middle stands tallest; the outer ones lean out from it, their caps smaller, so the caps crowd without meeting.
      const edge = d / (0.14 * (0.6 + tallest));
      spot(x, z, tallest * (1 - 0.3 * edge) * r.range(0.85, 1.05), k === 0 ? [r.range(-1, 1), 0, r.range(-1, 1)] : away(x, z), k === 0 ? 0.04 : 0.16 + 0.22 * edge, 0.8);
      k++;
    }
  } else {
    const n = 5 + Math.floor(r.next() * 3);
    const reach = 0.7 + 1.1 * tallest;
    for (let k = 0, tries = 0; k < n && tries < 300; tries++) {
      const a = r.next() * Math.PI * 2;
      const d = reach * Math.sqrt(r.next());
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!far(x, z, 0.25 + 0.4 * tallest)) continue;
      spot(x, z, tallest * r.range(0.72, 1), [r.range(-1, 1), 0, r.range(-1, 1)]);
      k++;
    }
  }
  // The tallest stands as tall as asked.
  const most = Math.max(...out.map((m) => m.height));
  out.splice(0, out.length, ...out.map((m) => ({ ...m, height: (m.height * tallest) / most })));
  // Young buttons at the feet of a few.
  for (const m of out.slice(0, Math.ceil(out.length / 3))) {
    const a = m.r.next() * Math.PI * 2;
    const d = m.height * 0.45;
    spot(m.foot[0] + Math.cos(a) * d, m.foot[2] + Math.sin(a) * d, m.height * m.r.range(0.32, 0.45), [Math.cos(a), 0, Math.sin(a)], m.r.range(0.1, 0.25), m.capSize);
  }
  return out;
}

function emitMushroom(caps: PartBuilder, flesh: PartBuilder, m: Mushroom, shape: CapShape): void {
  const form = FORM[shape];
  const radius = m.height * form.radius * m.capSize * m.r.range(0.88, 1.12);
  const crown = m.height * form.crown * (0.4 + 0.6 * m.capSize);
  const lean = Math.tan(m.tilt);
  const axis = normalize(add([0, 1, 0], scale(m.lean, lean)));
  const rim = addScaled(addScaled(m.foot, [0, 1, 0], m.height - crown), m.lean, (m.height - crown) * lean);
  // Failing, the cap slumps about a hinge under its rim on the far side, and drops beside the stalk.
  const hinge = addScaled(rim, m.lean, -0.5 * radius);
  const fallTo = addScaled(m.foot, m.lean, radius * 0.9);
  const stubborn = m.r.next() < STUBBORN;
  const capLoss = stubborn ? 0 : lossThreshold(m.r.next(), 0.5, 0.05);
  const capCh = { loss: capLoss, droop: 0.45, wither: 1, glow: 0, pivot: fallTo, bough: hinge, tint: m.r.range(-0.03, 0.03) };
  const [u, v] = basis(axis);
  const wobble = m.r.next() * Math.PI * 2;
  const around = (rho: number, eta: number, a: number): V3 => {
    const wob = 1 + 0.05 * Math.sin(a * 3 + wobble);
    const out = add(scale(u, Math.cos(a) * rho * radius * wob), scale(v, Math.sin(a) * rho * radius * wob));
    return addScaled(add(rim, out), axis, eta * crown);
  };
  const ring = (rho: number, eta: number, j: number): V3 => around(rho, eta, (j / SIDES) * Math.PI * 2);
  const radialAt = (a: number): V3 => add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
  const radial = (j: number): V3 => radialAt((j / SIDES) * Math.PI * 2);
  // The cap's top, a surface turned from its profile, its crown lightest.
  const profile = PROFILES[shape];
  const apex = caps.vertex(ring(0, 1, 0), axis, 0.9, capCh);
  const rows: number[] = [];
  for (let i = 1; i < profile.length; i++) {
    const [rho, eta] = profile[i] as readonly [number, number];
    const [r0, e0] = profile[i - 1] as readonly [number, number];
    const [r1, e1] = (profile[i + 1] ?? profile[i]) as readonly [number, number];
    const tr = (r1 - r0) * radius;
    const te = (e1 - e0) * crown;
    rows.push(caps.vertexCount);
    for (let j = 0; j < SIDES; j++) {
      const n = normalize(add(scale(radial(j), -te), scale(axis, tr)));
      caps.vertex(ring(rho, eta, j), n, 0.88 - 0.4 * (i / profile.length), capCh);
    }
  }
  for (let j = 0; j < SIDES; j++) caps.triangle(apex, (rows[0] as number) + j, (rows[0] as number) + ((j + 1) % SIDES));
  for (let k = 0; k + 1 < rows.length; k++) band(caps, rows[k] as number, rows[k + 1] as number, SIDES);
  // A domed cap is flecked with pale spots, like a fly agaric's, riding the cap as it slumps.
  if (shape === "domed") {
    const spotCh = { ...capCh, wither: 0.9 };
    const count = 6 + Math.floor(m.r.next() * 5);
    for (let k = 0; k < count; k++) {
      const a = m.r.next() * Math.PI * 2;
      // On the cap's facets, not the round surface they cut across, so no spot stands proud of the cap's outline.
      const half = Math.PI / SIDES;
      const rho = ((0.12 + 0.6 * Math.sqrt(m.r.next())) * Math.cos(half)) / Math.cos(((a % (2 * half)) + 2 * half) % (2 * half) - half);
      const i = profile.findIndex(([pr]) => pr >= rho);
      const [r0, e0] = profile[i - 1] as readonly [number, number];
      const [r1, e1] = profile[i] as readonly [number, number];
      const eta = e0 + ((e1 - e0) * (rho - r0)) / (r1 - r0);
      const n = normalize(add(scale(radialAt(a), -(e1 - e0) * crown), scale(axis, (r1 - r0) * radius)));
      const center = addScaled(around(rho, eta, a), n, 0.0015);
      const [su, sv] = basis(n);
      const size = radius * m.r.range(0.06, 0.11);
      const hub = flesh.vertex(center, n, 0.85, spotCh);
      for (let j = 0; j < 5; j++) {
        const b = (j / 5) * Math.PI * 2;
        flesh.vertex(addScaled(addScaled(center, su, Math.cos(b) * size * m.r.range(0.8, 1.2)), sv, Math.sin(b) * size * m.r.range(0.8, 1.2)), n, 0.8, spotCh);
      }
      for (let j = 0; j < 5; j++) flesh.triangle(hub, hub + 1 + j, hub + 1 + ((j + 1) % 5));
    }
  }
  // The gills beneath, ridged, rising from the rim to the stalk, in the stalk's pale flesh.
  const stalkTop = radius * form.stalk;
  const [lastR, lastE] = profile[profile.length - 1] as readonly [number, number];
  const gillCh = { ...capCh, wither: 0.85, glow: 0.18 };
  const under: number[] = [];
  for (const [rho, eta, shade] of [[lastR, lastE, 0.55], [0.6, lastE + 0.08, 0.35], [(stalkTop / radius) * 1.1, lastE + 0.16, 0.3]] as const) {
    under.push(flesh.vertexCount);
    for (let j = 0; j < SIDES; j++) {
      const ridge = rho < lastR && rho > 0.3 ? (j % 2 === 0 ? 0.03 : -0.03) : 0;
      flesh.vertex(ring(rho, eta + ridge, j), normalize(addScaled(scale(axis, -1), radial(j), 0.25)), shade, gillCh);
    }
  }
  for (let k = 0; k + 1 < under.length; k++) band(flesh, under[k] as number, under[k + 1] as number, SIDES);
  // The stalk: a bulb at its foot, tapering a little, up into the cap.
  const stalkCh = { loss: stubborn ? 0 : clamp(capLoss * 0.5, 0.02, 0.3), droop: 0, wither: 0.7, glow: 0, pivot: m.foot, bough: m.foot };
  // The stalk reaches well up into the cap, so a slumping cap never shows its top.
  const into = addScaled(rim, axis, (lastE + 0.32) * crown);
  const stalkRows: number[] = [];
  for (const [t, girth] of [[0, 1.35], [0.12, 1.08], [0.5, 1], [0.85, 0.9], [1, 0.86]] as const) {
    const c = add(add(scale(m.foot, 1 - t), scale(into, t)), scale(m.lean, Math.sin(Math.PI * t) * 0.03 * m.height));
    stalkRows.push(flesh.vertexCount);
    for (let j = 0; j < STALK_SIDES; j++) {
      const a = (j / STALK_SIDES) * Math.PI * 2;
      const n = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
      flesh.vertex(addScaled(c, n, stalkTop * girth), n, 0.5 + 0.25 * t, stalkCh);
    }
  }
  for (let k = 0; k + 1 < stalkRows.length; k++) band(flesh, stalkRows[k + 1] as number, stalkRows[k] as number, STALK_SIDES);
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
