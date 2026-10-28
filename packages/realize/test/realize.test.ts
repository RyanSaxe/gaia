import { describe, expect, it } from "vitest";
import { type AnyPrimitive, type Blueprint, type Built, type Part, Library, type Skeleton, blueprintOf, rand, seedOf } from "@gaia/schema";
import { BUSH_PRIMITIVES, FLORA_PRIMITIVES, PRIMITIVES, STRUCTURE_PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { bush, rock, structure, tree, wildflowers } from "@gaia/kinds";
import { sweep, validate } from "@gaia/world";
import { randomSlots } from "@gaia/world/testing";
import { CHANNEL_MATH, applyVitality, easedClamp, easedStep, mergeParts, realize, resolveParams, rotAt, shownVitality, spinAt, triangleCount } from "@gaia/realize";

const lib = new Library(FLORA_PRIMITIVES);
/** Every tree and bush blueprint from the sweeps of their parts, each frame with each crown. */
const trees = sweep(tree, new Library(TREE_PRIMITIVES), { pairs: [["form", "crown"]] }).blueprints;
const bushes = sweep(bush, new Library(BUSH_PRIMITIVES), { pairs: [["form", "crown"]] }).blueprints;
const firstTree = (where: (bp: Blueprint) => boolean = () => true): Blueprint => trees.find(where) as Blueprint;
/** A plant by the parts that shape it and their settings, as a failure names it. */
const named = (bp: Blueprint): string =>
  ["form", "crown", "bloom", "drift"].flatMap((slot) => (bp.slots[slot] === undefined ? [] : [`${bp.slots[slot].use} (${Object.values(bp.slots[slot].params).flat().join(", ")})`])).join(" with ");
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
    for (const blueprint of trees) {
      const leaves = realize(blueprint, tree, lib, { seed: seedOf("src/app.ts"), facts }).parts.filter((p) => p.swatch === "leaf");
      const tints = new Set(leaves.flatMap((p) => Array.from(p.tint).map((t) => t.toFixed(3))));
      expect(tints.size, named(blueprint)).toBeGreaterThan(3);
    }
  });

  it("gives byte-identical buffers for the same blueprint and seed", () => {
    for (const [blueprint, k] of [...trees.map((b) => [b, tree] as const), ...bushes.map((b) => [b, bush] as const)]) {
      const a = realize(blueprint, k, lib, { seed: seedOf("src/app.ts"), facts });
      const b = realize(blueprint, k, lib, { seed: seedOf("src/app.ts"), facts });
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
    const bp = firstTree();
    const a = realize(bp, tree, lib, { seed: 1, facts });
    const b = realize(bp, tree, lib, { seed: 2, facts });
    expect(bytes((a.parts[0] as Part).positions).equals(bytes((b.parts[0] as Part).positions))).toBe(false);
  });

  it("feeds the bloom slot from the crown, and skips it when the crown is absent", () => {
    const bp = firstTree((b) => b.slots.bloom !== undefined);
    const full = realize(bp, tree, lib, { seed: 3, facts });
    expect(new Set(full.parts.map((p) => p.swatch))).toEqual(new Set(["bark", "leaf", "bloom"]));
    const { crown: _crown, ...rest } = bp.slots;
    const bare = realize({ ...bp, slots: rest }, tree, lib, { seed: 3, facts });
    expect(bare.parts.map((p) => p.swatch)).toEqual(["bark"]);
  });

  it("keeps every tree under 40k triangles", () => {
    const over = trees.filter((bp) => triangleCount(realize(bp, tree, lib, { seed: 11, facts: { scale: 1.4, age: 0 } }).parts) >= 40_000);
    expect(over.map(named)).toEqual([]);
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

  it("shows vitality 0.85 and up fully healthy, 0.45 and below as ruin, and falls evenly between with nothing that jumps", () => {
    for (const v of [0.85, 0.9, 0.99, 1]) expect(shownVitality(v)).toBe(1);
    for (const v of [0, 0.1, 0.36, 0.45]) expect(shownVitality(v)).toBe(0);
    for (let v = 0; v < 1; v += 0.001) {
      expect(shownVitality(v + 0.001)).toBeGreaterThanOrEqual(shownVitality(v));
      if (v > 0.45 && v < 0.849) expect(shownVitality(v + 0.001)).toBeGreaterThan(shownVitality(v));
      // A thousandth of vitality never moves the look by more than a fiftieth.
      expect(shownVitality(v + 0.001) - shownVitality(v)).toBeLessThan(0.02);
    }
  });

  it("never moves the trunk's base, and leaves vanish gradually", () => {
    const bp = firstTree((b) => b.slots.crown?.use === "leaf-clumps@1");
    const plant = realize(bp, tree, lib, { seed: 5, facts });
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
    for (const [blueprint, k] of [...trees.map((b) => [b, tree] as const), ...bushes.map((b) => [b, bush] as const)]) {
      for (const part of realize(blueprint, k, lib, { seed: 9, facts }).parts) {
        for (const ch of [part.channels.loss, part.channels.droop, part.channels.wither, part.channels.glow, part.shade]) {
          expect(Math.min(...ch)).toBeGreaterThanOrEqual(0);
          expect(Math.max(...ch)).toBeLessThanOrEqual(1);
        }
        expect(part.channels.pivot.length).toBe(part.positions.length);
        expect(part.positions.every(Number.isFinite)).toBe(true);
      }
    }
  });
  describe("a change in vitality easing in", () => {
    const smoothstep = (e0: number, e1: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const mean = (f: (x: number) => number, a: number, b: number): number => {
      let sum = 0;
      for (let k = 0; k < 4000; k++) sum += f(a + ((b - a) * (k + 0.5)) / 4000);
      return sum / 4000;
    };

    it("shows every step exactly where it stands once the change has settled", () => {
      const r = rand(seedOf("eased at rest"));
      for (let k = 0; k < 500; k++) {
        const e0 = r.next() * 0.9;
        const e1 = e0 + 0.02 + r.next() * 0.2;
        const v = r.next();
        expect(easedStep(e0, e1, v, 0)).toBe(smoothstep(e0, e1, v));
      }
      const plant = realize(firstTree(), tree, lib, { seed: 5, facts });
      for (const part of plant.parts) {
        for (const v of [0.1, 0.4, 0.7]) {
          const settled = applyVitality(part, v, undefined, undefined, 0);
          const plain = applyVitality(part, v);
          expect(bytes(settled.positions).equals(bytes(plain.positions))).toBe(true);
          expect(bytes(settled.colors).equals(bytes(plain.colors))).toBe(true);
        }
      }
    });

    it("spreads a step over the vitality it has just passed through, as the step's mean across it", () => {
      const r = rand(seedOf("eased spread"));
      for (let k = 0; k < 200; k++) {
        const e0 = r.next() * 0.9;
        const e1 = e0 + 0.02 + r.next() * 0.2;
        const v = r.next();
        const lag = (r.next() - 0.5) * 0.6;
        expect(easedStep(e0, e1, v, lag)).toBeCloseTo(mean((x) => smoothstep(e0, e1, x), v + lag, v), 3);
        const now = r.next() * 3 - 1;
        const was = r.next() * 3 - 1;
        expect(easedClamp(now, was)).toBeCloseTo(mean((u) => Math.min(1, Math.max(0, u)), was, now), 3);
      }
    });

    it("eases a step that a ramp at the film's pace crosses over many frames, not a few", () => {
      // Shown vitality rises from 0 to 1 in 2.7 s, with a frame every 1/60 s. The step is the narrowest band any piece
      // crosses, `lossBand`, at the very start of the change, where the least vitality has been passed through.
      const frame = 1 / 60;
      const dv = frame / 2.7;
      const e0 = 0;
      const e1 = e0 + CHANNEL_MATH.lossBand;
      const keep = Math.exp(-frame / CHANNEL_MATH.vitalityLag);
      // The shown vitality eases toward the given one, and the previous shown value eases toward the shown one
      // (`followVitality` in @gaia/render).
      let [shown, was] = [0, 0];
      let [steppedWorst, easedWorst, stepped, eased] = [0, 0, smoothstep(e0, e1, 0), easedStep(e0, e1, 0, 0)];
      for (let v = dv; v <= 1 + 30 * dv; v += dv) {
        const target = Math.min(1, v);
        shown = target + (shown - target) * keep;
        was = shown + (was - shown) * keep;
        const s = smoothstep(e0, e1, target);
        const e = easedStep(e0, e1, shown, was - shown);
        steppedWorst = Math.max(steppedWorst, Math.abs(s - stepped));
        easedWorst = Math.max(easedWorst, Math.abs(e - eased));
        [stepped, eased] = [s, e];
      }
      expect(easedWorst).toBeLessThan(steppedWorst / 4);
    });
  });
});

describe("structures", () => {
  const structureLib = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const facts = { size: 1.25, floors: 2, reach: 1 };

  /** A thatched cottage with a garden, smoke from its chimney and windows that light. */
  const cottage = blueprintOf("structure", {
    footprint: {
      use: "cottage-plan@1",
      params: { massing: "a single block", shape: "long", size: "modest", storeys: "one storey", heights: "level", roof: "gabled", roofline: "steep", attachments: [], windows: "several", base: "on a stone plinth", character: "gently settled" },
    },
    body: { use: "timber-frame@1", params: { framing: "posts and rails", plaster: "hand-laid" } },
    roof: { use: "thatch@1", params: { thickness: "plump", overhang: "sheltering", chimney: "gable" } },
    openings: { use: "casements@1", params: { panes: "four panes", shutters: true, door: "hooded" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["flower boxes", "lantern", "woodpile"], walk: "stepping stones" } },
    palette: { use: "palette@1", params: { family: "spring-meadow", contrast: "balanced" } },
  });
  /** A stone house with a waterwheel. */
  const mill = blueprintOf("structure", {
    footprint: {
      use: "cottage-plan@1",
      params: { massing: "a long range", shape: "long", size: "roomy", storeys: "two storeys", heights: "stepped", roof: "gabled", roofline: "steep", attachments: [], windows: "several", base: "on a stone plinth", character: "gently settled" },
    },
    body: { use: "fieldstone@1", params: { stones: "mixed sizes", gables: "boards" } },
    roof: { use: "tiles@1", params: { covering: "shingles", overhang: "sheltering", chimney: "gable" } },
    feature: { use: "waterwheel@1", params: { wheel: "a great wheel", drive: "overshot" } },
    openings: { use: "casements@1", params: { panes: "six panes", shutters: true, door: "plank" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["lantern", "woodpile"], walk: "flagstones" } },
    palette: { use: "palette@1", params: { family: "teal-gold", contrast: "balanced" } },
  });

  for (const [name, blueprint] of [["A cottage", cottage], ["A mill", mill]] as const) {
    it(`${name} falls to ruin as vitality drops, and shows none of it while healthy`, () => {
      const parts = mergeParts(realize(blueprint, structure, structureLib, { seed: 4, facts }).parts);
      /** The largest distance a falling piece has moved from where it was built. */
      const moved = (v: number): number =>
        Math.max(
          ...parts.map((p) => {
            const fall = p.channels.fall;
            if (fall === undefined) return 0;
            const at = applyVitality(p, v).positions;
            return at.reduce((m, x, i) => ((fall[Math.floor(i / 3) * 4 + 3] as number) > 0 ? Math.max(m, Math.abs(x - (p.positions[i] as number))) : m), 0);
          }),
        );
      // Overgrowth and rubble are collapsed into their pivots at high vitality, and spread out at low vitality.
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
      // Walls and roofs rot through, with no holes at high vitality and deep ones at low vitality.
      const rotMost = Math.max(...parts.flatMap((p) => (p.channels.rot === undefined ? [] : [Math.max(...p.channels.rot)])));
      expect(rotAt(1)).toBe(0);
      expect(rotMost * rotAt(0.05)).toBeGreaterThan(0.6);
    });
  }

  // Builds 80 whole buildings at their largest: about 3 s alone, longer when the suite runs in parallel.
  it("keeps any building in the type space within 32k triangles and 12 draw calls, at its largest", () => {
    const r = rand(99);
    for (let i = 0; i < 80; i++) {
      const bp = blueprintOf(structure.id, randomSlots(structure, structureLib, () => r.next()));
      const built = realize(bp, structure, structureLib, { seed: i, facts });
      expect(triangleCount(built.parts), JSON.stringify(bp.slots)).toBeLessThan(32_000);
      expect(mergeParts(built.parts).length).toBeLessThanOrEqual(12);
      // Merging keeps every triangle.
      expect(triangleCount(mergeParts(built.parts))).toBe(triangleCount(built.parts));
    }
  }, 30_000);

  it("builds every part of a cottage on the footprint's one plan", () => {
    expect(validate(cottage, structure, structureLib)).toEqual([]);
    const built = realize(cottage, structure, structureLib, { seed: 4, facts });
    expect(built.slots.get("footprint")?.role).toBe("Footprint");
    expect(new Set(built.parts.map((p) => p.swatch))).toEqual(new Set(["masonry", "wall", "timber", "roof", "smoke", "glass", "trim", "leaf", "bloom", "moss"]));
  });

  it("turns a mill's wheel while healthy, slows it as it fails and stops it near the bottom", () => {
    expect(validate(mill, structure, structureLib)).toEqual([]);
    const parts = realize(mill, structure, structureLib, { seed: 4, facts }).parts;
    expect(parts.some((p) => p.channels.spin?.some((x) => x !== 0))).toBe(true);
    expect(spinAt(1)).toBe(1);
    expect(spinAt(0.4)).toBeGreaterThan(0);
    expect(spinAt(0.4)).toBeLessThan(1);
    expect(spinAt(0.05)).toBe(0);
  });

  it("lights windows and smokes only while healthy", () => {
    const built = realize(cottage, structure, structureLib, { seed: 4, facts });
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

describe("the understory", () => {
  const all = new Library(PRIMITIVES);
  const bushLib = new Library(BUSH_PRIMITIVES);
  /** A part at one end of every setting: each scale's lowest level and each choice's first key, or the highest and the last. */
  const atEnd = (p: AnyPrimitive, high: boolean): Record<string, string | boolean | string[]> =>
    Object.fromEntries(
      Object.entries(p.params).map(([name, f]) => {
        const pick = <T>(xs: readonly T[]): T => xs[high ? xs.length - 1 : 0] as T;
        return [name, f.type === "scale" ? pick(f.levels).words : f.type === "choice" ? pick(Object.keys(f.options)) : f.type === "flag" ? high : high ? Object.keys(f.members) : []];
      }),
    );
  /** Every bush frame with every crown, its settings all at their lowest and then all at their highest. */
  const extremes = bushLib.forRole("Skeleton").flatMap((frame) =>
    bushLib.forRole("Foliage").flatMap((crown) =>
      [false, true].map((high) =>
        blueprintOf(bush.id, {
          form: { use: frame.id, params: atEnd(frame, high) },
          bark: { use: "bark@1", params: atEnd(bushLib.get("bark@1"), high) },
          crown: { use: crown.id, params: atEnd(crown, high) },
          motion: { use: "sway@1", params: atEnd(bushLib.get("sway@1"), high) },
          palette: { use: "palette@1", params: atEnd(bushLib.get("palette@1"), high) },
        }),
      ),
    ),
  );
  const groups = [
    { blueprints: [...bushes, ...extremes], kind: bush },
    { blueprints: sweep(rock, all).blueprints, kind: rock },
    { blueprints: sweep(wildflowers, all).blueprints, kind: wildflowers },
  ];
  for (const { blueprints, kind } of groups) {
    it(`stands every ${kind.id} part valid and light enough to place by the hundred`, () => {
      const over: string[] = [];
      for (const blueprint of blueprints) {
        expect(validate(blueprint, kind, all), named(blueprint)).toEqual([]);
        const parts = realize(blueprint, kind, all, { seed: 11, facts: { scale: 1.3, age: 0 } }).parts;
        expect(parts.length, named(blueprint)).toBeGreaterThan(0);
        if (triangleCount(parts) >= 12_000) over.push(named(blueprint));
      }
      expect(over).toEqual([]);
    });
  }

  it("keeps a shrub and a bramble under every crown on the ground: their lowest leaves reach the soil and none sinks into it", () => {
    // Clumps and a mound fill a shrub's frame down to the ground, and strands rest on the soil. A sapling stands on
    // its one stem, with its leaves on the branches above. The test checks each frame at its smallest and largest under
    // each crown.
    const shrubs = [...bushes, ...extremes].filter((b) => b.slots.form?.use !== "sapling@1");
    for (const crown of bushLib.forRole("Foliage")) expect(shrubs.filter((b) => b.slots.crown?.use === crown.id).length, crown.id).toBeGreaterThanOrEqual(4);
    for (const blueprint of shrubs) {
      const leaf = realize(blueprint, bush, all, { seed: 3, facts: { scale: 1, age: 0 } }).parts.find((p) => p.swatch === "leaf")!;
      let low = Infinity;
      for (let i = 1; i < leaf.positions.length; i += 3) low = Math.min(low, leaf.positions[i]!);
      expect(low, named(blueprint)).toBeLessThan(0.1);
      expect(low, named(blueprint)).toBeGreaterThanOrEqual(0);
    }
  });

  it("thins a declining bush to bare twigs: most leaves fall by vitality 0.1, under a third by 0.6, and the stems stay", () => {
    for (const blueprint of bushes) {
      const name = named(blueprint);
      const parts = realize(blueprint, bush, all, { seed: 3, facts: { scale: 1, age: 0 } }).parts;
      // A spray's leaves drop in place around its loss. Anything else collapses onto its pivot.
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
      // A bush thins as its vitality falls, so up to a third of it may be gone by vitality 0.6, but no more.
      expect(fallen(leaf, 0.6), name).toBeLessThan(1 / 3);
      expect(fallen(leaf, 0.1), name).toBeGreaterThan(0.6);
      expect(fallen(bark, 0.1), name).toBe(0);
    }
  });
});
