// A windmill's sails turn about its windshaft and sweep clear of its body at
// every turn; as it fails they stop before its cap lists, and the cap lists
// about the windshaft itself, so the sails never leave their shaft.

import { describe, expect, it } from "vitest";
import { type Built, type Part, rand } from "@gaia/schema";
import { windmill } from "@gaia/primitives";
import { resolveParams, spinAt } from "@gaia/realize";

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

const BODIES = ["a stone tower mill", "a timber smock mill", "a post mill"] as const;
const SAILS = ["four canvas sails", "four lattice sails", "six sails"] as const;
const HEIGHTS = ["a stout mill", "a towering mill"] as const;

const mills = BODIES.flatMap((body) => SAILS.flatMap((sails) => HEIGHTS.map((height) => ({ body, sails, height }))));
const buildOf = (stored: Record<string, string>): Built =>
  (windmill.build as Erased)(resolveParams(windmill, stored, rand(4), windmill.id), { rand: rand(4).fork("windmill"), facts: { scale: 1 } }, null) as Built;
const at = (a: Float32Array, i: number, width: number): number[] => Array.from(a.subarray(i * width, i * width + width));

/** Every turning vertex of a mill: where it stands, its pivot and its spin. */
function turning(built: Built): { p: number[]; pivot: number[]; spin: number[] }[] {
  return built.parts.flatMap((part: Part) => {
    const spin = part.channels.spin;
    if (spin === undefined) return [];
    return Array.from({ length: part.shade.length }, (_, i) => ({ p: at(part.positions, i, 3), pivot: at(part.channels.pivot, i, 3), spin: at(spin, i, 3) })).filter((v) => Math.hypot(...v.spin) > 0);
  });
}

describe("a windmill", () => {
  // Builds eighteen mills; the clearance case turns each sail through a full turn: a few seconds alone.
  it.each(mills)("turns its sails about one windshaft, and they clear the body at every turn: %o", { timeout: 30_000 }, (stored) => {
    const built = buildOf(stored);
    const sails = turning(built);
    expect(sails.length).toBeGreaterThan(0);
    const [hub, axis] = [sails[0]?.pivot ?? [], sails[0]?.spin ?? []];
    for (const v of sails) {
      expect(v.pivot).toEqual(hub);
      expect(v.spin).toEqual(axis);
    }
    // The body's front, in half-meter cells across and up: the farthest forward any solid of it reaches.
    const cell = (x: number, y: number): string => `${Math.floor(x / 0.5)},${Math.floor(y / 0.5)}`;
    const front = new Map<string, number>();
    for (const part of built.parts.filter((p) => p.collision === "solid")) {
      for (let i = 0; i < part.shade.length; i++) {
        const [x, y, z] = at(part.positions, i, 3) as [number, number, number];
        front.set(cell(x, y), Math.max(front.get(cell(x, y)) ?? -Infinity, z));
      }
    }
    const rate = Math.hypot(...axis);
    const k = axis.map((c) => c / rate) as [number, number, number];
    // The sails themselves, not the windshaft and poll end, which run back into the cap.
    const offAxis = (v: { p: number[] }): number => {
      const o = v.p.map((x, i) => x - (hub[i] as number));
      const along = o.reduce((sum, x, i) => sum + x * (k[i] as number), 0);
      return Math.hypot(...o.map((x, i) => x - along * (k[i] as number)));
    };
    const blades = sails.filter((v) => offAxis(v) > 0.6);
    for (let step = 0; step < 24; step++) {
      const angle = (step / 24) * Math.PI * 2;
      const [c, s] = [Math.cos(angle), Math.sin(angle)];
      for (const v of blades) {
        const o = v.p.map((x, i) => x - (hub[i] as number)) as [number, number, number];
        const d = (o[0] * k[0] + o[1] * k[1] + o[2] * k[2]) * (1 - c);
        const q = [0, 1, 2].map((i) => (hub[i] as number) + o[i]! * c + (k[(i + 1) % 3]! * o[(i + 2) % 3]! - k[(i + 2) % 3]! * o[(i + 1) % 3]!) * s + k[i]! * d) as [number, number, number];
        expect(q[2], `${JSON.stringify(stored)} at ${step * 15} degrees`).toBeGreaterThan(front.get(cell(q[0], q[1])) ?? -Infinity);
        expect(q[1], `${JSON.stringify(stored)}: a sail's tip sweeps the ground`).toBeGreaterThan(1.5);
      }
    }
  });

  it.each(mills)("stops its sails before its cap lists, and the cap lists about the windshaft: %o", (stored) => {
    const built = buildOf(stored);
    const axis = turning(built)[0]?.spin ?? [];
    const rate = Math.hypot(...axis);
    let listing = 0;
    for (const part of built.parts) {
      const fall = part.channels.fall;
      if (fall === undefined) continue;
      for (let i = 0; i < part.shade.length; i++) {
        const [x, y, z, from] = at(fall, i, 4) as [number, number, number, number];
        if (from === 0) continue;
        listing++;
        // The shown vitality the list starts at: the sails turn at a tenth of their speed or less by then.
        expect(spinAt(from)).toBeLessThan(0.1);
        const most = Math.hypot(x, y, z);
        expect(Math.abs((x * axis[0]! + y * axis[1]! + z * axis[2]!) / (most * rate))).toBeCloseTo(1, 5);
        expect(part.channels.spin === undefined || Math.hypot(...at(part.channels.spin, i, 3)) === 0).toBe(true);
      }
    }
    expect(listing).toBeGreaterThan(0);
  });
});
