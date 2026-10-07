// The small, lived-in things around a building: the walk to its door,
// flower boxes under the windows, a lantern, a woodpile and a fence. As the
// house is left, the flowers die, boxes tip off their brackets, the lantern
// hangs askew and pickets lean and fall.

import type { BuildContext, BuildingPlan, Built, Vec3, Resolved } from "@gaia/schema";
import type { cottageGardenParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, addScaled, icosphere, lossThreshold, normalize, sub } from "../kit.ts";
import { UP, beam, box, flatStone, log } from "../blocks.ts";
import { type Wall, clearings, hidden, on, placeOf, sameWall, shownWalls, still } from "./frame.ts";

export function buildGarden(p: Resolved<typeof cottageGardenParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("garden");
  const walk = new PartBuilder("masonry", "walkable");
  const wood = new PartBuilder("timber", "solid");
  const paint = new PartBuilder("trim", "solid");
  const leaf = new PartBuilder("leaf");
  const bloom = new PartBuilder("bloom");
  const lamp = new PartBuilder("glass");
  const fence = new PartBuilder("wall", "solid");
  const extras = new Set(p.extras);
  const door = plan.openings.find((o) => o.kind === "door");
  const steps = Math.max(1, Math.round(plan.floor / 0.2));
  const blob = icosphere(0);

  const sphere = (b: PartBuilder, c: Vec3, radii: Vec3, shade: number, ch: Channels): void => {
    const base = b.vertexCount;
    for (const q of blob.points) b.vertex([c[0] + q[0] * radii[0], c[1] + q[1] * radii[1], c[2] + q[2] * radii[2]], q, shade + 0.18 * q[1], ch);
    for (const [a, bb, cc] of blob.triangles) b.triangle(base + a, base + bb, base + cc);
  };

  // The walk: stones leading out from the doorstep.
  if (door !== undefined) {
    const { wall: w, s } = placeOf(plan, door);
    const start = 0.36 * steps + 0.42;
    const flags = p.walk === "flagstones";
    const count = flags ? 10 : 6;
    const gapLen = flags ? 0.4 : 0.66;
    for (let i = 0; i < count; i++) {
      const d = start + i * gapLen;
      const sway = Math.sin(i * 0.55 + r.next() * 0.3) * 0.22;
      const cols = flags ? [-0.21, 0.21] : [0];
      for (const col of cols) {
        const q = on(w, s + sway + col + (r.next() - 0.5) * 0.08, 0, d);
        const radius = flags ? 0.2 + 0.03 * r.next() : 0.27 + 0.07 * r.next();
        flatStone(walk, q[0], q[2], radius, 0.045, 0.52 + 0.14 * r.next(), still(q, 0.45 + 0.35 * r.next(), { tint: (r.next() - 0.5) * 0.04 }), r);
      }
    }
  }

  // Flower boxes under the ground-floor windows: flowers go first, then the leaves wilt.
  if (extras.has("flower boxes")) {
    // Under the ground-floor windows that look toward the walk, so a big house keeps its budget.
    const boxed = plan.openings.filter((o) => o.kind === "window" && o.position[1] < plan.floor + 1.5 && o.normal[2] > 0.3).slice(0, 6);
    for (const o of boxed) {
      const { wall: w, s } = placeOf(plan, o);
      const y = o.position[1] - 0.12;
      const hw = o.width / 2 + 0.06;
      const boxC = on(w, s, y - 0.1, 0.24);
      // As the house fails, a box tips forward off its brackets, its dead plants with it.
      const pivot = on(w, s, y - 0.2, 0.13);
      const tip = 0.85 + 0.3 * r.next();
      const fall = [w.u[0] * tip, w.u[1] * tip, w.u[2] * tip, 0.26 + 0.1 * r.next()] as const;
      box(paint, boxC, [w.u, UP, w.n], [hw, 0.1, 0.11], 0.5, still(pivot, 0.5, { fall }));
      for (let i = 0; i < 6; i++) {
        const x = -hw + 0.1 + ((2 * hw - 0.2) * i) / 5;
        const c = on(w, s + x, y + 0.03 + 0.03 * r.next(), 0.24 + (r.next() - 0.5) * 0.08);
        sphere(leaf, c, [0.12, 0.09, 0.1], 0.45 + 0.15 * r.next(), { loss: lossThreshold(r.next(), 0.3, 0.04), droop: 0.5, wither: 0.85, glow: 0, pivot, tint: (r.next() - 0.5) * 0.04, fall });
      }
      for (let i = 0; i < 3; i++) {
        const c = on(w, s - hw + 0.15 + (2 * hw - 0.3) * r.next(), y - 0.12, 0.36);
        sphere(leaf, c, [0.07, 0.14, 0.05], 0.4, { loss: lossThreshold(r.next(), 0.35, 0.04), droop: 0.6, wither: 0.85, glow: 0, pivot, tint: 0, fall });
      }
      for (let i = 0; i < 9; i++) {
        const c = on(w, s - hw + 0.08 + (2 * hw - 0.16) * r.next(), y + 0.09 + 0.05 * r.next(), 0.2 + 0.12 * r.next());
        sphere(bloom, c, [0.055, 0.045, 0.055], 0.62, { loss: lossThreshold(r.next(), 0.72, 0.25), droop: 0.3, wither: 0.9, glow: 0, pivot, tint: (r.next() - 0.5) * 0.12, fall });
      }
    }
  }

  // A lantern on a bracket beside the door, lit at night while the code is healthy.
  if (extras.has("lantern") && door !== undefined) {
    const { wall: w, s } = placeOf(plan, door);
    const free = (side: number): boolean =>
      !plan.openings.some((o) => o !== door && sameWall(placeOf(plan, o).wall, w) && Math.abs(placeOf(plan, o).s - (s + side * (door.width / 2 + 0.38))) < o.width / 2 + 0.55);
    const side = free(1) ? 1 : -1;
    const ls = s + side * (door.width / 2 + 0.38);
    const ly = plan.floor + door.height * 0.92;
    // The bracket works loose from the wall and the lantern hangs askew.
    const mount = on(w, ls, ly + 0.25, 0);
    const sag = 0.55;
    const hang = { fall: [w.u[0] * sag, w.u[1] * sag, w.u[2] * sag, 0.36] as const };
    beam(wood, mount, on(w, ls, ly + 0.25, 0.42), 0.05, 0.05, w.u, 0.35, still(mount, 0.5, hang));
    const c = on(w, ls, ly, 0.4);
    box(wood, addScaled(c, UP, 0.16), [w.u, UP, w.n], [0.11, 0.025, 0.11], 0.35, still(mount, 0.5, hang));
    box(wood, addScaled(c, UP, -0.15), [w.u, UP, w.n], [0.09, 0.02, 0.09], 0.35, still(mount, 0.5, hang));
    box(lamp, c, [w.u, UP, w.n], [0.075, 0.13, 0.075], 0.8, { loss: lossThreshold(r.next(), 0.42, 0.25), droop: 0, wither: 0.4, glow: 1, pivot: mount, ...hang });
  }

  // Split logs stacked against the longest bare stretch of a side wall, end grain out.
  if (extras.has("woodpile")) {
    const walls = shownWalls(plan).filter((w) => w.mass === 0 && Math.abs(w.n[2]) < 1e-6);
    let best: { w: Wall; s0: number; s1: number } | null = null;
    for (const w of walls) {
      const holes = clearings(plan, w, 0.1)
        .filter((h) => h.y0 < 1.3 + plan.floor)
        .map((h) => [h.s0, h.s1] as const);
      // Where another mass or a lean-to stands against the wall, there is no room either.
      for (let s = 0.25; s < w.length; s += 0.5) if (hidden(plan, w, s, 0.5) || hidden(plan, w, s, 1.2)) holes.push([s - 0.3, s + 0.3] as const);
      holes.sort((a, b) => a[0] - b[0]);
      let from = 0.25;
      for (const [h0, h1] of [...holes, [w.length - 0.25, w.length] as const]) {
        if (h0 - from > (best === null ? 0 : best.s1 - best.s0)) best = { w, s0: from, s1: h0 };
        from = Math.max(from, h1);
      }
    }
    if (best !== null) {
      const { w } = best;
      const len = Math.min(2.2, best.s1 - best.s0);
      const s0 = best.s0 + (best.s1 - best.s0 - len) / 2;
      const rad = 0.085;
      const rows = 5;
      for (let row = 0; row < rows; row++) {
        const n = Math.floor((len - row * rad) / (rad * 2.05));
        for (let i = 0; i < n; i++) {
          const s = s0 + rad + row * rad + i * rad * 2.05;
          const yy = rad * 0.8 + row * rad * 1.75;
          const from = on(w, s, yy, 0.12);
          const to = on(w, s, yy, 0.62 + 0.05 * r.next());
          const pivot = on(w, s, 0, 0.35);
          log(wood, from, to, rad * (0.9 + 0.2 * r.next()), 0.45 + 0.12 * r.next(), { loss: row >= 2 ? lossThreshold(r.next(), 0.35, 0.05) : 0, droop: 0, wither: 0.5, glow: 0, pivot, tint: (r.next() - 0.5) * 0.03 });
        }
      }
    }
  }

  // A low picket fence around the front garden, with a gap where the walk passes.
  if (extras.has("fence")) {
    const hw = plan.width / 2 + 0.35;
    const front = plan.depth / 2 + 3.4;
    const back = plan.depth / 2 - 0.25;
    const gateX = door?.position[0] ?? 0;
    const runs: [V3, V3][] = [
      [[-hw, 0, back], [-hw, 0, front]],
      [[-hw, 0, front], [hw, 0, front]],
      [[hw, 0, front], [hw, 0, back]],
    ];
    for (const [a, b2] of runs) {
      const len = Math.hypot(b2[0] - a[0], b2[2] - a[2]);
      const u = normalize(sub(b2, a));
      const n: V3 = [u[2], 0, -u[0]];
      const count = Math.floor(len / 0.2);
      for (let i = 0; i <= count; i++) {
        const q = addScaled(a, u, (len * i) / count);
        if (Math.abs(q[2] - front) < 0.01 && Math.abs(q[0] - gateX) < 0.62) continue;
        const h = 0.78 + 0.06 * Math.sin(i * 0.9);
        const base: V3 = [q[0], -0.25, q[2]];
        // Pickets lean every which way as the garden is left, then some fall.
        const leanBy = (r.next() < 0.5 ? -1 : 1) * (0.2 + 0.55 * r.next());
        const ch: Channels = {
          loss: r.next() < 0.22 ? lossThreshold(r.next(), 0.32, 0.04) : 0,
          droop: 0.04,
          wither: 0.6,
          glow: 0,
          pivot: base,
          tint: 0,
          fall: [u[0] * leanBy, 0, u[2] * leanBy, 0.3 + 0.32 * r.next()],
        };
        box(fence, [q[0], (h - 0.25) / 2, q[2]], [u, UP, n], [0.035, (h + 0.25) / 2, 0.014], 0.55 + 0.08 * r.next(), ch);
      }
      for (const ry of [0.22, 0.58]) {
        const segs = Math.max(1, Math.round(len / 2));
        for (let k = 0; k < segs; k++) {
          const p0 = addScaled(a, u, (len * k) / segs);
          const p1 = addScaled(a, u, (len * (k + 1)) / segs);
          const mid = addScaled(p0, sub(p1, p0), 0.5);
          if (Math.abs(mid[2] - front) < 0.01 && Math.abs(mid[0] - gateX) < 0.62 + len / segs / 2) {
            for (const [x0, x1] of [[p0[0], gateX - 0.62], [gateX + 0.62, p1[0]]] as const) {
              if (Math.abs(x1 - x0) > 0.1) beam(fence, [Math.min(x0, x1), ry, front - 0.03], [Math.max(x0, x1), ry, front - 0.03], 0.07, 0.025, n, 0.5, still([gateX, 0, front], 0.6, { droop: 0.05 }));
            }
            continue;
          }
          beam(fence, addScaled([p0[0], ry, p0[2]], n, -0.03), addScaled([p1[0], ry, p1[2]], n, -0.03), 0.07, 0.025, n, 0.5, still(p0, 0.6, { droop: 0.05 }));
        }
      }
    }
  }

  const parts = [walk, wood, paint, leaf, bloom, lamp, fence].filter((b) => b.triangleCount > 0).map((b) => b.part());
  // A walk is always there, so the dressing always has a part.
  return { parts, anchors: [] };
}
