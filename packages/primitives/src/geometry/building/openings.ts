// A building's doors and windows, each set in the wall the plan puts it in:
// small-paned casements with stone sills, lamplit at night, and a plank
// door with steps. As the house is abandoned the door swings ajar, panes
// break, shutters hang askew and boards cover windows.

import type { BuildContext, BuildingPlan, Built, Resolved } from "@gaia/schema";
import type { casementsParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, addScaled, cross, lossThreshold, normalize, sub } from "../kit.ts";
import { UP, beam, box, quad } from "../blocks.ts";
import { on, placeOf, still } from "./frame.ts";

export function buildCasements(p: Resolved<typeof casementsParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("casements");
  const glass = new PartBuilder("glass");
  const frame = new PartBuilder("timber", "solid");
  const trim = new PartBuilder("trim", "solid");
  const stone = new PartBuilder("masonry", "solid");
  for (const o of plan.openings) {
    const { wall: w, s } = placeOf(plan, o);
    const y = o.position[1];
    const at = (ds: number, dy: number, d: number): V3 => on(w, s + ds, y + dy, d);
    const hw = o.width / 2;
    const axes = [w.u, UP, w.n] as const;
    const wr = r.fork(`${o.kind}-${s.toFixed(2)}-${y.toFixed(2)}`);
    const pivot = at(0, o.height / 2, 0);
    const wood = (): Channels => still(pivot, 0.5, { tint: (wr.next() - 0.5) * 0.02 });
    if (o.kind === "window") {
      // A dark pane, which breaks as the house fails, and in front of it the
      // lamplit pane, which goes out below its threshold.
      quad(glass, [at(-hw, 0, 0.035), at(hw, 0, 0.035), at(hw, o.height, 0.035), at(-hw, o.height, 0.035)], w.n, 0.2, still(pivot, 1, { rot: 0.85 }));
      const lit: Channels = { loss: lossThreshold(wr.next(), 0.62, 0.2), droop: 0, wither: 0.25, glow: 0.7 + 0.3 * wr.next(), pivot };
      quad(glass, [at(-hw, 0, 0.045), at(hw, 0, 0.045), at(hw, o.height, 0.045), at(-hw, o.height, 0.045)], w.n, [0.55, 0.55, 0.85, 0.85], lit);
      // Frame, glazing bars, sill and lintel.
      const fw = 0.085;
      box(frame, at(0, o.height + fw / 2, 0.07), axes, [hw + fw, fw / 2, 0.05], 0.46, wood());
      box(frame, at(0, -fw / 2 + 0.01, 0.07), axes, [hw + fw, fw / 2, 0.05], 0.4, wood());
      for (const sign of [-1, 1]) box(frame, at(sign * (hw + fw / 2), o.height / 2, 0.07), axes, [fw / 2, o.height / 2 + fw, 0.05], 0.42, wood());
      const bars = p.panes === "four panes" ? { v: 1, h: 1 } : p.panes === "six panes" ? { v: 1, h: 2 } : { v: 0, h: 0 };
      const bar = (): Channels => ({ ...wood(), loss: wr.next() < 0.6 ? lossThreshold(wr.next(), 0.3, 0.05) : 0 });
      for (let i = 1; i <= bars.v; i++) box(frame, at(-hw + (o.width * i) / (bars.v + 1), o.height / 2, 0.06), axes, [0.018, o.height / 2, 0.02], 0.5, bar());
      for (let i = 1; i <= bars.h; i++) box(frame, at(0, (o.height * i) / (bars.h + 1), 0.06), axes, [hw, 0.018, 0.02], 0.5, bar());
      // Some windows are boarded up as the house is abandoned: boards nailed
      // across the frame, each growing out from the side it is nailed to first.
      if (wr.next() < 0.55) {
        const from = 0.24 + 0.14 * wr.next();
        for (let k = 0; k < 3; k++) {
          const c = at((wr.next() - 0.5) * 0.04, o.height * (0.2 + 0.3 * k) + (wr.next() - 0.5) * 0.06, 0.124);
          const tilt = (wr.next() - 0.5) * 0.32;
          const along = normalize(addScaled(w.u, UP, Math.tan(tilt)));
          const half = hw + fw * 0.6;
          const nailed = addScaled(c, along, (k % 2 === 0 ? -1 : 1) * half * 0.94);
          box(frame, c, [along, normalize(cross(w.n, along)), w.n], [half, 0.065, 0.016], 0.5 + 0.12 * wr.next(), { loss: 0, droop: 0, wither: 0.75, glow: 0, pivot: nailed, tint: (wr.next() - 0.5) * 0.04, grow: from - 0.04 * k });
        }
      }
      const sillC = at(0, -0.06, 0.1);
      box(stone, sillC, axes, [hw + 0.14, 0.045, 0.12], 0.62, still(sillC, 0.5));
      // Shutters: upright boards with a ledge; one may hang off its hinge as the house declines.
      if (p.shutters) {
        for (const sign of [-1, 1]) {
          const sw = hw + 0.02;
          const inner = sign * (hw + fw);
          const hinge = at(inner, o.height + fw, 0.05);
          // A loose shutter hangs from its top hinge, swung down and askew.
          const loose = wr.next() < 0.6;
          const swing = -sign * (0.45 + 0.3 * wr.next());
          const ch: Channels = {
            loss: wr.next() < 0.2 ? lossThreshold(wr.next(), 0.22, 0.04) : 0,
            droop: 0.04,
            wither: 0.55 + 0.3 * wr.next(),
            glow: 0,
            pivot: hinge,
            tint: (wr.next() - 0.5) * 0.02,
            ...(loose ? { fall: [w.n[0] * swing, w.n[1] * swing, w.n[2] * swing, 0.42 + 0.16 * wr.next()] as const } : {}),
          };
          const boards = 3;
          for (let k = 0; k < boards; k++) {
            const bc = inner + sign * (sw * (k + 0.5)) / boards;
            box(trim, at(bc, o.height / 2, 0.05), axes, [sw / boards / 2 - 0.008, o.height / 2 + fw * 0.6, 0.022], 0.5 + 0.08 * wr.next(), ch);
          }
          box(trim, at(inner + (sign * sw) / 2, o.height * 0.72, 0.08), axes, [sw / 2 - 0.02, 0.035, 0.012], 0.6, ch);
          box(trim, at(inner + (sign * sw) / 2, o.height * 0.25, 0.08), axes, [sw / 2 - 0.02, 0.035, 0.012], 0.6, ch);
        }
      }
    } else {
      const h = o.height;
      const arched = p.door === "arched";
      // The door leaf swings ajar on its hinges, into the dark, as the house is abandoned.
      const hinge = at(-hw, 0, 0.035);
      const ajar = 1.0 + 0.2 * wr.next();
      const leaf = (wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot: hinge, tint: (wr.next() - 0.5) * 0.02, fall: [0, ajar, 0, 0.46], ...extra });
      // Planks; an arched door's tops follow its arch.
      const planks = 5;
      for (let k = 0; k < planks; k++) {
        const x = -hw + (o.width * (k + 0.5)) / planks;
        const ph = arched ? h - hw + Math.sqrt(Math.max(0, hw * hw - x * x)) : h;
        box(trim, at(x, ph / 2, 0.035), axes, [o.width / planks / 2 - 0.008, ph / 2, 0.03], 0.46 + 0.1 * wr.next(), leaf(0.55));
      }
      for (const ly of [0.28, 0.74]) box(frame, at(0, h * ly, 0.08), axes, [hw - 0.06, 0.06, 0.018], 0.48, leaf(0.5));
      const knob = at(hw * 0.62, h * 0.48, 0.11);
      box(frame, knob, axes, [0.03, 0.03, 0.03], 0.3, leaf(0.5));
      // Frame and lintel; an arched door's frame is a ring of short beams.
      const fw = 0.11;
      if (arched) {
        const spring = h - hw;
        for (const sign of [-1, 1]) box(frame, at(sign * (hw + fw / 2), spring / 2, 0.075), axes, [fw / 2, spring / 2, 0.06], 0.42, wood());
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          const t0 = (i / steps) * Math.PI;
          const t1 = ((i + 1) / steps) * Math.PI;
          const R = hw + fw / 2;
          beam(frame, at(Math.cos(t0) * R, spring + Math.sin(t0) * R, 0.075), at(Math.cos(t1) * R, spring + Math.sin(t1) * R, 0.075), fw, 0.12, w.n, 0.44, wood());
        }
      } else {
        for (const sign of [-1, 1]) box(frame, at(sign * (hw + fw / 2), h / 2, 0.075), axes, [fw / 2, h / 2 + fw, 0.06], 0.42, wood());
        box(frame, at(0, h + fw / 2, 0.08), axes, [hw + fw + 0.12, fw / 2 + 0.02, 0.07], 0.46, wood());
      }
      // A small pitched hood over the door, on two brackets.
      if (p.door === "hooded") {
        const eave = Math.min(h + 0.14, (plan.masses[o.mass]?.wallHeight ?? h + 0.56) - 0.42);
        const peak = eave + 0.32;
        const half = hw + 0.36;
        for (const sign of [-1, 1]) {
          const from = at(0, peak, 0);
          const to = at(sign * half, eave, 0);
          const along = normalize(sub(to, from));
          let slab = normalize(cross(along, w.n));
          if (slab[1] < 0) slab = [-slab[0], -slab[1], -slab[2]];
          const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
          const mid = addScaled(addScaled(from, sub(to, from), 0.5), w.n, 0.36);
          box(trim, mid, [along, slab, w.n], [len / 2 + 0.06, 0.035, 0.36], 0.52, still(at(0, peak, 0), 0.55, { droop: 0.05 }));
        }
        for (const sign of [-1, 1]) beam(frame, at(sign * (hw + 0.16), h - 0.3, 0.02), at(sign * (hw + 0.16), eave - 0.02, 0.55), 0.07, 0.07, w.u, 0.4, wood());
      }
      // Steps up to the floor.
      const n = Math.max(1, Math.round(plan.floor / 0.2));
      const rise = plan.floor / n;
      for (let i = 0; i < n; i++) {
        const top = plan.floor - i * rise;
        const out = 0.36 * (i + 1);
        const sc = on(w, s, (top - 0.4) / 2, out / 2);
        box(stone, sc, axes, [hw + 0.22 - i * 0.02 + 0.03 * wr.next(), (top + 0.4) / 2, out / 2], 0.56 + 0.08 * wr.next(), still(sc, 0.5), { bottom: true });
      }
    }
  }
  return { parts: [glass.part(), frame.part(), trim.part(), stone.part()].filter((part) => part.indices.length > 0), anchors: [] };
}

