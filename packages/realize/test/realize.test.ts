import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Built, type Part, Library, type Skeleton, blueprintOf, rand, seedOf } from "@gaia/schema";
import { FLORA_PRIMITIVES, PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { flora, rock, structure, wildflowers } from "@gaia/kinds";
import { randomSlots, validate } from "@gaia/world";
import { FLORA_PRESETS, FLOWER_PRESETS, ROCK_PRESETS, SHRUB_PRESETS, STRUCTURE_PRESETS, applyVitality, mergeParts, realize, resolveParams, rotAt, spinAt, triangleCount } from "@gaia/realize";

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
    const bp = (FLORA_PRESETS[0] as (typeof FLORA_PRESETS)[number]).blueprint;
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

describe("structures", () => {
  const structureLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const facts = { size: 1.25, floors: 2, reach: 1 };

  for (const { name, blueprint } of STRUCTURE_PRESETS) {
    it(`${name} is a valid structure blueprint`, () => {
      expect(validate(blueprint, structure, structureLib)).toEqual([]);
    });

    it(`${name} stays within 32k triangles and draws in at most 11 calls`, () => {
      const built = realize(blueprint, structure, structureLib, { seed: 4, facts });
      expect(triangleCount(built.parts)).toBeLessThan(32_000);
      expect(mergeParts(built.parts).length).toBeLessThanOrEqual(11);
      expect(triangleCount(mergeParts(built.parts))).toBe(triangleCount(built.parts));
    });

    it(`${name} falls to ruin as vitality drops, and shows none of it while healthy`, () => {
      const parts = mergeParts(realize(blueprint, structure, structureLib, { seed: 4, facts }).parts);
      /** How far the falling pieces stand from where they were built, at most. */
      const moved = (v: number): number =>
        Math.max(
          ...parts.map((p) => {
            const fall = p.channels.fall;
            if (fall === undefined) return 0;
            const at = applyVitality(p, v).positions;
            return at.reduce((m, x, i) => ((fall[Math.floor(i / 3) * 4 + 3] as number) > 0 ? Math.max(m, Math.abs(x - (p.positions[i] as number))) : m), 0);
          }),
        );
      // Overgrowth and rubble are gone into their pivots while healthy, and spread out when failing.
      const grown = (v: number): number =>
        Math.max(
          ...parts.map((p) => {
            const grow = p.channels.grow;
            if (grow === undefined) return 0;
            const at = applyVitality(p, v).positions;
            return at.reduce((m, x, i) => ((grow[Math.floor(i / 3)] as number) > 0 ? Math.max(m, Math.abs(x - (p.channels.pivot[i] as number))) : m), 0);
          }),
        );
      expect(grown(1)).toBe(0);
      expect(grown(0.05)).toBeGreaterThan(0.3);
      // Doors swing, shutters hang and chimneys topple: whole meters, not a tremble.
      expect(moved(0.05) - moved(1)).toBeGreaterThan(1);
      // Walls and roofs rot through: no holes while healthy, deep ones when failing.
      const rotMost = Math.max(...parts.flatMap((p) => (p.channels.rot === undefined ? [] : [Math.max(...p.channels.rot)])));
      expect(rotAt(1)).toBe(0);
      expect(rotMost * rotAt(0.05)).toBeGreaterThan(0.6);
    });
  }

  // Builds 80 whole buildings at their largest: about 3 s alone, longer when the suite runs in parallel.
  it("keeps any building in the type space within 32k triangles and 11 draw calls, at its largest", () => {
    const r = rand(99);
    for (let i = 0; i < 80; i++) {
      const bp = blueprintOf(structure.id, randomSlots(structure, structureLib, () => r.next()));
      const built = realize(bp, structure, structureLib, { seed: i, facts });
      expect(triangleCount(built.parts), JSON.stringify(bp.slots)).toBeLessThan(32_000);
      expect(mergeParts(built.parts).length).toBeLessThanOrEqual(11);
    }
  }, 30_000);

  it("builds every part of a cottage on the footprint's one plan", () => {
    const built = realize((STRUCTURE_PRESETS[0] as (typeof STRUCTURE_PRESETS)[number]).blueprint, structure, structureLib, { seed: 4, facts });
    expect(built.slots.get("footprint")?.role).toBe("Footprint");
    expect(new Set(built.parts.map((p) => p.swatch))).toEqual(new Set(["masonry", "wall", "timber", "roof", "smoke", "glass", "trim", "leaf", "bloom", "moss"]));
  });

  it("turns a mill's wheel while healthy, slows it as it fails and stops it near the bottom", () => {
    const mill = STRUCTURE_PRESETS.find((p) => p.blueprint.slots.feature?.use === "waterwheel@1");
    expect(mill).toBeDefined();
    const parts = realize((mill as (typeof STRUCTURE_PRESETS)[number]).blueprint, structure, structureLib, { seed: 4, facts }).parts;
    expect(parts.some((p) => p.channels.spin?.some((x) => x !== 0))).toBe(true);
    expect(spinAt(1)).toBe(1);
    expect(spinAt(0.4)).toBeGreaterThan(0);
    expect(spinAt(0.4)).toBeLessThan(1);
    expect(spinAt(0.05)).toBe(0);
  });

  it("lights windows and smokes only while healthy", () => {
    const built = realize((STRUCTURE_PRESETS[0] as (typeof STRUCTURE_PRESETS)[number]).blueprint, structure, structureLib, { seed: 4, facts });
    const emitted = (v: number) => built.parts.filter((p) => p.swatch === "glass").reduce((sum, p) => sum + applyVitality(p, v).emission.reduce((a, b) => a + b, 0), 0);
    expect(emitted(1)).toBeGreaterThan(emitted(0.4) * 2);
    const smoke = built.parts.find((p) => p.swatch === "smoke") as Part;
    const spread = (v: number) => {
      const pos = applyVitality(smoke, v).positions;
      return pos.reduce((m, x, i) => Math.max(m, Math.abs(x - (smoke.channels.pivot[i] as number))), 0);
    };
    expect(spread(1)).toBeGreaterThan(0.3);
    expect(spread(0.2)).toBe(0);
  });
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

  it("thins a declining bush to bare twigs: most leaves fall by vitality 0.1, few by 0.6, and the stems stay", () => {
    for (const { name, blueprint } of SHRUB_PRESETS) {
      const parts = realize(blueprint, flora, all, { seed: 3, facts: { scale: 1, age: 0 } }).parts;
      // A spray's leaves drop in place around its loss; anything else collapses onto its pivot.
      const fallen = (part: Part, v: number): number => {
        const pos = applyVitality(part, v).positions;
        let gone = 0;
        for (let i = 0; i < pos.length; i += 3) {
          const d = Math.hypot(pos[i]! - part.channels.pivot[i]!, pos[i + 1]! - part.channels.pivot[i + 1]!, pos[i + 2]! - part.channels.pivot[i + 2]!);
          if (d < 1e-5 || part.channels.loss[i / 3]! > v) gone++;
        }
        return gone / (pos.length / 3);
      };
      const leaf = parts.find((p) => p.swatch === "leaf")!;
      const bark = parts.find((p) => p.swatch === "bark")!;
      expect(fallen(leaf, 0.6), name).toBeLessThan(0.25);
      expect(fallen(leaf, 0.1), name).toBeGreaterThan(0.6);
      expect(fallen(bark, 0.1), name).toBe(0);
    }
  });
});
