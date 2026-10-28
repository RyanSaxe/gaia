import { describe, expect, it } from "vitest";
import { Library, kind, meets, slot } from "@gaia/schema";
import { FLORA_PRIMITIVES, PALETTE_FAMILIES, STRUCTURE_PRIMITIVES, TREE_PRIMITIVES } from "@gaia/primitives";
import { structure, tree } from "@gaia/kinds";
import { assemble, planDetails, planStructure, readStructure, validate } from "@gaia/world";
import { SCANNER, fakeJev } from "./fixtures.ts";

const lib = new Library(TREE_PRIMITIVES);
const subject = {
  id: SCANNER.path,
  state: {
    biome: "A quiet birch wood of small, careful utilities.",
    file: { path: SCANNER.path, symbols: SCANNER.symbols.map((s) => s.name) },
  },
};

describe("a tree's blueprint in two requests", () => {
  it("asks only closed questions Jev can answer", () => {
    const wave = planStructure(tree, lib, subject);
    const types = Object.values(wave.request.questions).map((q) => q.type);
    expect(types.every((t) => t === "choice" || t === "noul" || t === "score")).toBe(true);
    expect(Object.keys(wave.request.questions).sort()).toEqual(["bloom.present", "bloom.use", "crown.use", "form.use"]);
  });

  it("assembles a valid blueprint, and equal answers name the same blueprint", () => {
    const run = () => {
      const s = planStructure(tree, lib, subject);
      const structure = readStructure(tree, lib, s, fakeJev(s.request, { "form.use": "branching@1", "crown.use": "leaf-strands@1" }));
      const d = planDetails(tree, lib, structure, subject);
      return assemble(tree, lib, structure, d, fakeJev(d.request, { "form.habit": "weeping" }));
    };
    const a = run();
    expect(validate(a, tree, lib)).toEqual([]);
    expect(a.slots.form?.params.habit).toBe("weeping");
    expect(run().id).toBe(a.id);
  });

  it("rejects a blueprint with a value Jev could not have chosen", () => {
    const s = planStructure(tree, lib, subject);
    const structure = readStructure(tree, lib, s, fakeJev(s.request));
    const d = planDetails(tree, lib, structure, subject);
    const bp = assemble(tree, lib, structure, d, fakeJev(d.request));
    const broken = { ...bp, slots: { ...bp.slots, form: { use: "branching@1" as const, params: { habit: "spiral" } } } };
    expect(validate(broken, tree, lib).length).toBeGreaterThan(0);
  });

  it("shuffles option order per subject, so Jev's first-option lean spreads out", () => {
    const order = (id: string) => Object.keys((planStructure(tree, lib, { ...subject, id }).request.questions["crown.use"] as { criteria: object }).criteria);
    const orders = new Set(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((id) => order(id).join()));
    expect(orders.size).toBeGreaterThan(1);
    expect(order("a.ts")).toEqual(order("a.ts"));
  });
});

describe("slot dependencies", () => {
  it("drops a slot whose source slot Jev left out", () => {
    // A kind with an optional crown, so the dependency rule has something to drop.
    const shrub = kind({ ...tree, id: "shrub", slots: { ...tree.slots, crown: slot("Foliage", { on: "form", optional: true }) } });
    const s = planStructure(shrub, lib, subject);
    const structure = readStructure(shrub, lib, s, fakeJev(s.request, { "crown.present": false, "bloom.present": true }));
    expect(structure.crown).toBeUndefined();
    expect(structure.bloom).toBeUndefined();
  });

  it("never offers a crownless tree, because a bare tree reads as a dying one", () => {
    const s = planStructure(tree, lib, subject);
    expect(s.request.questions["crown.present"]).toBeUndefined();
    const structure = readStructure(tree, lib, s, fakeJev(s.request));
    expect(structure.crown).toBeDefined();
  });

  it("rejects a stored blueprint with a bloom and no crown", () => {
    const s = planStructure(tree, lib, subject);
    const structure = readStructure(tree, lib, s, fakeJev(s.request));
    const d = planDetails(tree, lib, structure, subject);
    const bp = assemble(tree, lib, structure, d, fakeJev(d.request));
    const { crown: _crown, ...rest } = bp.slots;
    const broken = { ...bp, slots: { ...rest, bloom: { use: "blossoms@1" as const, params: { form: "petals", count: "plenty" } } } };
    expect(validate(broken, tree, lib)).toContain("bloom is on crown, which is absent.");
  });
});

describe("what a part needs of its place", () => {
  const buildings = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
  const features = STRUCTURE_PRIMITIVES.filter((p) => p.role === "Feature");
  const needing = features.find((p) => (p.needs?.length ?? 0) > 0);
  /** The features a place must provide for `needing`. All of its needs are strings here. */
  const wants = (needing?.needs ?? []).filter((n): n is string => typeof n === "string");
  const offered = (has?: readonly string[]): string[] => [...(planStructure(structure, buildings, { ...subject, ...(has === undefined ? {} : { has }) }).offered?.feature ?? [])].sort();

  it("offers a part only where its place has all it needs, and the rest everywhere", () => {
    expect(needing).toBeDefined();
    expect(offered()).toEqual(features.filter((p) => p !== needing).map((p) => p.id).sort());
    expect(offered(wants)).toEqual(features.map((p) => p.id).sort());
  });

  it("keeps Jev's pick among what was offered, and never stands a part the place was not offered, whatever Jev answered", () => {
    const id = needing?.id ?? "";
    const there = planStructure(structure, buildings, { ...subject, has: wants });
    expect(readStructure(structure, buildings, there, fakeJev(there.request, { "feature.present": true, "feature.use": id })).feature).toBe(id);
    const elsewhere = planStructure(structure, buildings, subject);
    const answers = { ...fakeJev(elsewhere.request, { "feature.present": true }), "feature.use": { type: "choice" as const, choice: id, probabilities: { [id]: 1 }, confidence: 1 } };
    // readStructure rejects a pick it did not offer, or ignores it when only one part was offered.
    const picked = (): string | undefined => {
      try {
        return readStructure(structure, buildings, elsewhere, answers).feature;
      } catch {
        return undefined;
      }
    };
    expect(picked()).not.toBe(id);
  });

  it("offers what needs a range of rank only to a thing whose rank lies in it, ends included, and to no place without a rank", () => {
    const needs = ["running water", { rank: [0.9, 1] as const }];
    expect(meets(needs, { has: ["running water"], rank: 0.95 })).toBe(true);
    expect(meets(needs, { has: ["running water"], rank: 0.9 })).toBe(true);
    expect(meets(needs, { has: ["running water"], rank: 0.89 })).toBe(false);
    expect(meets(needs, { has: [], rank: 0.95 })).toBe(false);
    expect(meets(needs, { has: ["running water"] })).toBe(false);
    expect(meets(undefined, { has: [] })).toBe(true);
  });
});

describe("narrowing a choice to a region's native families", () => {
  it("offers only the native families, and every family when the region names none", () => {
    const structure = { form: "branching@1", bark: "bark@1", crown: "leaf-clumps@1", motion: "sway@1", palette: "palette@1" };
    const family = (narrow: readonly string[]) => {
      const q = planDetails(tree, lib, structure, subject, { narrow: { "palette.family": narrow } }).request.questions["palette.family"];
      return Object.keys((q as { criteria: object }).criteria).sort();
    };
    expect(family(["deep-forest", "silver-birch"])).toEqual(["deep-forest", "silver-birch"]);
    expect(family([]).length).toBe(Object.keys(PALETTE_FAMILIES).length);
  });

  it("fills in the one family a region names, asking nothing about it", () => {
    const structure = { form: "branching@1", bark: "bark@1", crown: "leaf-clumps@1", motion: "sway@1", palette: "palette@1" };
    const d = planDetails(tree, lib, structure, subject, { narrow: { "palette.family": ["teal-gold"] } });
    expect(d.request.questions["palette.family"]).toBeUndefined();
    expect(assemble(tree, lib, structure, d, fakeJev(d.request)).slots.palette?.params.family).toBe("teal-gold");
  });
});

describe("a value the place settles", () => {
  it("is filled in and never asked, while the slot's other values are", () => {
    const structure = { form: "branching@1", bark: "bark@1", crown: "leaf-clumps@1", motion: "sway@1", palette: "palette@1" };
    const d = planDetails(tree, lib, structure, subject, { fixed: { "form.habit": "weeping" } });
    expect(d.request.questions["form.habit"]).toBeUndefined();
    expect(d.request.questions["form.density"]).toBeDefined();
    const bp = assemble(tree, lib, structure, d, fakeJev(d.request));
    expect(bp.slots.form?.params.habit).toBe("weeping");
    expect(validate(bp, tree, lib)).toEqual([]);
  });
});
