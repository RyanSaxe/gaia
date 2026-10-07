import { describe, expect, it } from "vitest";
import { Library } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { assemble, planDetails, planStructure, readStructure, validate } from "@gaia/world";
import { SCANNER, fakeJev } from "./fixtures.ts";

const lib = new Library(FLORA_PRIMITIVES);
const subject = {
  id: SCANNER.path,
  state: {
    biome: "A quiet birch wood of small, careful utilities.",
    file: { path: SCANNER.path, doc: SCANNER.doc, symbols: SCANNER.symbols.map((s) => s.name) },
  },
};

describe("flora blueprint in two requests", () => {
  it("asks only closed questions Jev can answer", () => {
    const wave = planStructure(flora, lib, subject);
    const types = Object.values(wave.request.questions).map((q) => q.type);
    expect(types.every((t) => t === "choice" || t === "noul" || t === "score")).toBe(true);
    expect(Object.keys(wave.request.questions).sort()).toEqual([
      "bloom.present",
      "crown.present",
      "crown.use",
      "form.use",
    ]);
  });

  it("assembles a valid blueprint, and equal answers name the same blueprint", () => {
    const run = () => {
      const s = planStructure(flora, lib, subject);
      const structure = readStructure(flora, lib, s, fakeJev(s.request, { "form.use": "branching@1", "crown.use": "leaf-strands@1" }));
      const d = planDetails(flora, lib, structure, subject);
      return assemble(flora, lib, structure, d, fakeJev(d.request, { "form.habit": "weeping" }));
    };
    const a = run();
    expect(validate(a, flora, lib)).toEqual([]);
    expect(a.slots.form?.params.habit).toBe("weeping");
    expect(run().id).toBe(a.id);
  });

  it("rejects a blueprint with a value Jev could not have chosen", () => {
    const s = planStructure(flora, lib, subject);
    const structure = readStructure(flora, lib, s, fakeJev(s.request));
    const d = planDetails(flora, lib, structure, subject);
    const bp = assemble(flora, lib, structure, d, fakeJev(d.request));
    const broken = { ...bp, slots: { ...bp.slots, form: { use: "branching@1" as const, params: { habit: "spiral" } } } };
    expect(validate(broken, flora, lib).length).toBeGreaterThan(0);
  });

  it("shuffles option order per subject, so Jev's first-option lean spreads out", () => {
    const order = (id: string) => Object.keys((planStructure(flora, lib, { ...subject, id }).request.questions["crown.use"] as { criteria: object }).criteria);
    const orders = new Set(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((id) => order(id).join()));
    expect(orders.size).toBeGreaterThan(1);
    expect(order("a.ts")).toEqual(order("a.ts"));
  });
});

describe("representation", () => {
  it("lets Jev choose the kind, or leave the file as ground", async () => {
    const { planRepresentation, GROUND } = await import("@gaia/world");
    const wave = planRepresentation([flora], subject);
    const q = wave.request.questions.represent;
    expect(q?.type).toBe("choice");
    expect(Object.keys((q as { criteria: object }).criteria).sort()).toEqual(["flora", GROUND].sort());
  });
});

describe("slot dependencies", () => {
  it("drops a bloom when Jev chose no crown for it to grow on", () => {
    const s = planStructure(flora, lib, subject);
    const structure = readStructure(flora, lib, s, fakeJev(s.request, { "crown.present": false, "bloom.present": true }));
    expect(structure.crown).toBeUndefined();
    expect(structure.bloom).toBeUndefined();
  });

  it("rejects a stored blueprint with a bloom and no crown", () => {
    const s = planStructure(flora, lib, subject);
    const structure = readStructure(flora, lib, s, fakeJev(s.request));
    const d = planDetails(flora, lib, structure, subject);
    const bp = assemble(flora, lib, structure, d, fakeJev(d.request));
    const { crown: _crown, ...rest } = bp.slots;
    const broken = { ...bp, slots: { ...rest, bloom: { use: "blossoms@1" as const, params: { form: "petals", count: "plenty" } } } };
    expect(validate(broken, flora, lib)).toContain("bloom is on crown, which is absent.");
  });
});
