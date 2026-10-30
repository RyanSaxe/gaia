import { describe, expect, it } from "vitest";
import { Library, kind, slot } from "@gaia/schema";
import { TREE_PRIMITIVES } from "@gaia/primitives";
import { tree } from "@gaia/kinds";
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

  it("rejects a blueprint that does not hold together: a value Jev could not have chosen, or a part on a missing part", () => {
    const s = planStructure(tree, lib, subject);
    const structure = readStructure(tree, lib, s, fakeJev(s.request));
    const d = planDetails(tree, lib, structure, subject);
    const bp = assemble(tree, lib, structure, d, fakeJev(d.request));
    const broken = { ...bp, slots: { ...bp.slots, form: { use: "branching@1" as const, params: { habit: "spiral" } } } };
    expect(validate(broken, tree, lib).length).toBeGreaterThan(0);
    const { crown: _crown, ...rest } = bp.slots;
    const bloomOnNothing = { ...bp, slots: { ...rest, bloom: { use: "blossoms@1" as const, params: { form: "petals", count: "plenty" } } } };
    expect(validate(bloomOnNothing, tree, lib).length).toBeGreaterThan(0);
    // When Jev leaves out a part, what stands on it is dropped too. A kind with an optional crown lets Jev leave it out.
    const shrub = kind({ ...tree, id: "shrub", slots: { ...tree.slots, crown: slot("Foliage", { on: "form", optional: true }) } });
    const bare = planStructure(shrub, lib, subject);
    const read = readStructure(shrub, lib, bare, fakeJev(bare.request, { "crown.present": false, "bloom.present": true }));
    expect(read.crown).toBeUndefined();
    expect(read.bloom).toBeUndefined();
  });
});
