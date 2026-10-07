import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type Part, Library, type Skeleton, rand, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, PRIMITIVES } from "@gaia/primitives";
import { flora, rock, wildflowers } from "@gaia/kinds";
import { validate } from "@gaia/world";
import { FLORA_PRESETS, FLOWER_PRESETS, ROCK_PRESETS, SHRUB_PRESETS, applyVitality, realize, resolveParams, triangleCount } from "@gaia/realize";

const lib = new Library(FLORA_PRIMITIVES);
const facts = { scale: 1, age: 120 };
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function buffersOf(part: Part): Buffer[] {
  const c = part.channels;
  return [part.positions, part.normals, part.indices, part.shade, c.loss, c.droop, c.wither, c.glow, c.pivot].map(bytes);
}

/** Middle level of every scale, first option of every choice. */
function middleParams(p: AnyPrimitive): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (const [name, f] of Object.entries(p.params)) {
    if (f.type === "scale") out[name] = f.levels[Math.floor(f.levels.length / 2)]?.words ?? "";
    else if (f.type === "choice") out[name] = Object.keys(f.options)[0] ?? "";
    else if (f.type === "flag") out[name] = true;
    else out[name] = Object.keys(f.members);
  }
  return out;
}

type Erased = (params: unknown, ctx: { rand: ReturnType<typeof rand>; facts: Record<string, number> }, input: unknown) => unknown;

function build(p: AnyPrimitive, stored: Record<string, string | boolean | string[]>, input: unknown, seed = 7): unknown {
  const params = resolveParams(p, stored, rand(seed), p.id);
  return (p.build as Erased)(params, { rand: rand(seed).fork(p.id), facts }, input);
}

const skeletons = lib.forRole("Skeleton").map((p) => ({ id: p.id, skel: build(p, middleParams(p), null) as Skeleton }));

describe("realize", () => {
  it("varies hue across a canopy through the tint channel", () => {
    for (const { blueprint } of FLORA_PRESETS) {
      const leaves = realize(blueprint, flora, lib, { seed: seedOf("src/app.ts"), facts }).parts.filter((p) => p.swatch === "leaf");
      const tints = new Set(leaves.flatMap((p) => Array.from(p.tint).map((t) => t.toFixed(3))));
      expect(tints.size).toBeGreaterThan(3);
    }
  });

  it("gives byte-identical buffers for the same blueprint and seed", () => {
    for (const { blueprint } of FLORA_PRESETS) {
      const a = realize(blueprint, flora, lib, { seed: seedOf("src/app.ts"), facts });
      const b = realize(blueprint, flora, lib, { seed: seedOf("src/app.ts"), facts });
      expect(a.parts.length).toBe(b.parts.length);
      a.parts.forEach((part, i) => {
        const other = b.parts[i] as Part;
        buffersOf(part).forEach((buf, k) => expect(buf.equals(buffersOf(other)[k] as Buffer)).toBe(true));
      });
      expect(a.motion).toEqual(b.motion);
      expect(a.palette).toEqual(b.palette);
    }
  });

  it("varies instances of one blueprint by seed", () => {
    const bp = (FLORA_PRESETS[0] as (typeof FLORA_PRESETS)[number]).blueprint;
    const a = realize(bp, flora, lib, { seed: 1, facts });
    const b = realize(bp, flora, lib, { seed: 2, facts });
    expect(bytes((a.parts[0] as Part).positions).equals(bytes((b.parts[0] as Part).positions))).toBe(false);
  });

  it("feeds the bloom slot from the crown, and skips it when the crown is absent", () => {
    const bp = (FLORA_PRESETS[2] as (typeof FLORA_PRESETS)[number]).blueprint;
    const full = realize(bp, flora, lib, { seed: 3, facts });
    expect(full.parts.map((p) => p.swatch)).toEqual(["bark", "leaf", "bloom"]);
    const { crown: _crown, ...rest } = bp.slots;
    const bare = realize({ ...bp, slots: rest }, flora, lib, { seed: 3, facts });
    expect(bare.parts.map((p) => p.swatch)).toEqual(["bark"]);
  });

  it("keeps every preset plant under 40k triangles", () => {
    for (const { name, blueprint } of FLORA_PRESETS) {
      const tris = triangleCount(realize(blueprint, flora, lib, { seed: 11, facts: { scale: 1.4, age: 0 } }).parts);
      expect(tris, name).toBeLessThan(40_000);
    }
  });
});

describe("vitality response", () => {
  const geometryPrimitives = lib.forRole("Surface").concat(lib.forRole("Foliage"), lib.forRole("Ornament"));

  const inputsFor = (p: AnyPrimitive): { label: string; input: unknown }[] => {
    if (p.role !== "Ornament") return skeletons.map((s) => ({ label: s.id, input: s.skel }));
    // Ornaments hang on what foliage offers.
    return lib.forRole("Foliage").flatMap((f) =>
      skeletons.map((s) => ({ label: `${f.id} on ${s.id}`, input: (build(f, middleParams(f), s.skel) as Built).anchors })),
    );
  };

  for (const p of geometryPrimitives) {
    it(`${p.id} looks different at vitality 0 and 1`, () => {
      for (const { label, input } of inputsFor(p)) {
        const built = build(p, middleParams(p), input) as Built;
        expect(built.parts.length, label).toBeGreaterThan(0);
        for (const part of built.parts) {
          expect(part.shade.length, label).toBeGreaterThan(0);
          const dead = applyVitality(part, 0);
          const alive = applyVitality(part, 1);
          const moved = !bytes(dead.positions).equals(bytes(alive.positions));
          const recolored = !bytes(dead.colors).equals(bytes(alive.colors));
          expect(moved || recolored, `${p.id} ${label}`).toBe(true);
        }
      }
    });
  }

  it("never moves the trunk's base, and leaves vanish gradually", () => {
    const bp = (FLORA_PRESETS[3] as (typeof FLORA_PRESETS)[number]).blueprint;
    const plant = realize(bp, flora, lib, { seed: 5, facts });
    const leaf = plant.parts.find((p) => p.swatch === "leaf") as Part;
    const lost = (v: number) => Array.from(leaf.channels.loss).filter((t) => t > v).length / leaf.channels.loss.length;
    expect(lost(0.9)).toBe(0);
    expect(lost(0.5)).toBeLessThan(0.25);
    expect(lost(0.25)).toBeGreaterThan(0.2);
    expect(lost(0.05)).toBeGreaterThan(0.75);
    const bark = plant.parts.find((p) => p.swatch === "bark") as Part;
    expect(applyVitality(bark, 0).positions.slice(0, 3)).toEqual(bark.positions.slice(0, 3));
  });

  it("keeps every channel in range", () => {
    for (const { blueprint } of FLORA_PRESETS) {
      for (const part of realize(blueprint, flora, lib, { seed: 9, facts }).parts) {
        for (const ch of [part.channels.loss, part.channels.droop, part.channels.wither, part.channels.glow, part.shade]) {
          expect(Math.min(...ch)).toBeGreaterThanOrEqual(0);
          expect(Math.max(...ch)).toBeLessThanOrEqual(1);
        }
        expect(part.channels.pivot.length).toBe(part.positions.length);
        expect(part.positions.every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe("presets", () => {
  for (const { name, blueprint } of FLORA_PRESETS) {
    it(`${name} is a valid flora blueprint`, () => {
      expect(validate(blueprint, flora, lib)).toEqual([]);
    });
  }
});

describe("understory presets", () => {
  const all = new Library(PRIMITIVES);
  const groups = [
    { presets: SHRUB_PRESETS, kind: flora, budget: 12_000 },
    { presets: ROCK_PRESETS, kind: rock, budget: 12_000 },
    { presets: FLOWER_PRESETS, kind: wildflowers, budget: 12_000 },
  ];
  for (const { presets, kind, budget } of groups) {
    for (const { name, blueprint } of presets) {
      it(`${name} is a valid ${kind.id} blueprint, light enough to place by the hundred`, () => {
        expect(validate(blueprint, kind, all)).toEqual([]);
        const parts = realize(blueprint, kind, all, { seed: 11, facts: { scale: 1.3, age: 0 } }).parts;
        expect(parts.length).toBeGreaterThan(0);
        expect(triangleCount(parts)).toBeLessThan(budget);
      });
    }
  }

  it("keeps a bush on the ground: its lowest leaves reach the soil", () => {
    for (const { blueprint } of SHRUB_PRESETS) {
      const leaf = realize(blueprint, flora, all, { seed: 3, facts: { scale: 1, age: 0 } }).parts.find((p) => p.swatch === "leaf")!;
      let low = Infinity;
      for (let i = 1; i < leaf.positions.length; i += 3) low = Math.min(low, leaf.positions[i]!);
      expect(low).toBeLessThan(0.1);
      expect(low).toBeGreaterThanOrEqual(0);
    }
  });
});
