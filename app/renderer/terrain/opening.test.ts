import { describe, expect, it } from "vitest";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { type CodeFacts, type FileFacts, Library, rand, seedOf } from "@gaia/schema";
import { OPENING, type Terrain, amongCode, bakeTerrain, openingSpot, openingView, returnTo, stoodBy, waterDepthAt } from "@gaia/terrain";
import { composeWorld, judgeWorld, layoutWorld, standInJev } from "@gaia/world";
import type { WorldDocument } from "../../world-service/protocol.ts";
import { codeLab, provingWorld } from "./code-world.ts";
import { LOOKS } from "./looks.ts";
import { laySnapshot } from "./snapshot.ts";
import { snapshotFacts } from "./snapshot-facts.ts";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);

/** A world's terrain as the page bakes it, and where it lands the person. */
function landing(document: WorldDocument): { terrain: Terrain; at: ReturnType<typeof openingSpot>; world: WorldDocument["world"] } {
  const terrain = bakeTerrain(codeLab(document).spec, lib);
  return { terrain, at: openingSpot(terrain, document.world), world: document.world };
}

/** A made-up codebase of `seed`: a few packages of folders and files of every size, which imports and depends as it likes. */
function randomFacts(seed: number): CodeFacts {
  const r = rand(seedOf(`opening-${seed}`));
  const packages = 2 + Math.floor(r.next() * 4);
  const files: FileFacts[] = [];
  for (let p = 0; p < packages; p++) {
    const folders = 1 + Math.floor(r.next() * 4);
    for (let f = 0; f < folders; f++) {
      const count = 2 + Math.floor(r.next() * 8);
      for (let k = 0; k < count; k++) {
        const path = `packages/p${p}/src/f${f}/file${k}.ts`;
        const lines = 20 + Math.floor(r.next() ** 2 * 900);
        files.push({ path, language: "typescript", lines, symbols: [{ name: `main${k}`, kind: "function", exported: true, line: 1, lines: Math.max(1, Math.round(lines / 2)) }], imports: [], importedBy: [] });
      }
    }
  }
  files.push({ path: "README.md", language: "markdown", lines: 80, symbols: [], imports: [], importedBy: [] });
  for (const f of files) {
    if (r.next() < 0.5) continue;
    const other = files[Math.floor(r.next() * files.length)] as FileFacts;
    if (other === f) continue;
    (f.imports as string[]).push(other.path);
    (other.importedBy as string[]).push(f.path);
  }
  const entities = Array.from({ length: packages }, (_, p) => ({ path: `packages/p${p}`, name: `@demo/p${p}`, form: "package" as const, manifest: `packages/p${p}/package.json`, files: files.filter((f) => f.path.startsWith(`packages/p${p}/`)).length, lines: 600, exports: 10, dependsOn: p > 0 ? ["packages/p0"] : [], dependents: p === 0 ? Array.from({ length: packages - 1 }, (_, q) => `packages/p${q + 1}`) : [] }));
  return { projectId: `opening-${seed}`, files, entities, repository: { name: `demo-${seed}`, files: files.length, lines: files.reduce((n, f) => n + f.lines, 0) } };
}

async function randomWorld(seed: number): Promise<WorldDocument> {
  const facts = randomFacts(seed);
  const jev = standInJev(LOOKS);
  const world = layoutWorld(facts, await composeWorld(facts, LOOKS, jev, await judgeWorld(facts, LOOKS, jev)));
  return { root: facts.repository.name, facts, world, judges: {}, summary: "a test", judged: {} };
}

/** The person stands among the code, on dry ground, looking along a stream when one runs among the code. */
function expectAmongCode({ terrain, at, world }: ReturnType<typeof landing>, what: string): void {
  expect(amongCode(world, at.x, at.z), `${what} lands among the code`).toBe(true);
  expect(waterDepthAt(terrain, at.x, at.z), `${what} lands on dry ground`).toBeLessThanOrEqual(OPENING.dry);
  expect(Number.isFinite(at.yaw), what).toBe(true);
}

/** The person looks downstream along the stream beside them: its water runs on ahead, within 45 degrees of their view. */
function expectLooksDownstream({ terrain, at }: ReturnType<typeof landing>, what: string): void {
  const beside = terrain.streams
    .flatMap((s) => s.stations.map((p, k) => ({ stations: s.stations, k, d: Math.hypot(p.x - at.x, p.z - at.z) })))
    .reduce((a, b) => (b.d < a.d ? b : a));
  const here = beside.stations[beside.k] as (typeof beside.stations)[number];
  const there = beside.stations.slice(beside.k).find((p) => Math.hypot(p.x - here.x, p.z - here.z) >= OPENING.ahead);
  expect(there, `${what}: water runs on downstream of where the person stands`).toBeDefined();
  if (there === undefined) return;
  const run = Math.hypot(there.x - here.x, there.z - here.z);
  // A walk's yaw 0 looks along -z.
  const along = (-Math.sin(at.yaw) * (there.x - here.x) - Math.cos(at.yaw) * (there.z - here.z)) / run;
  expect(along, `${what}: the person looks downstream`).toBeGreaterThan(Math.SQRT1_2);
}

/** The view is open, the ground ahead never rising to fill it, and something that stands for code is in it. */
function expectGoodView({ terrain, at, world }: ReturnType<typeof landing>, what: string): void {
  const view = openingView(terrain, world, at.x, at.z, at.yaw);
  expect(view.rise, `${what}: the ground ahead stays below the eye`).toBeLessThanOrEqual(OPENING.rise);
  expect(view.seen, `${what}: something that stands for code is in view`).toBeGreaterThan(0);
}

describe("where a person first stands in a world from code", () => {
  // Gaia's world bakes whole here, as the page bakes it: about 15 seconds alone, longer while other work shares the machine.
  it("is among Gaia's own code, on dry ground beside a stream, looking downstream over open ground at code", { timeout: 180_000 }, async () => {
    const { world, judges, summary } = await laySnapshot("jev", "a test");
    const laid = landing({ root: world.name, facts: snapshotFacts(), world, judges, summary, judged: {} });
    expectAmongCode(laid, "Gaia's world");
    // Its stretch nearest the repository's heart is the end of a stream that dries away: the first rule stood the
    // person there, facing past the water onto a slope of grass that rose 6.4 degrees above the eye.
    expectLooksDownstream(laid, "Gaia's world");
    expectGoodView(laid, "Gaia's world");
  });

  it("is among the proving ground's code, on dry ground, looking downstream over open ground at code", { timeout: 120_000 }, () => {
    const laid = landing(provingWorld());
    expectAmongCode(laid, "the proving ground");
    expectLooksDownstream(laid, "the proving ground");
    expectGoodView(laid, "the proving ground");
  });

  // Each made-up world is judged by the stand-in and baked whole: five to eight seconds each. In these three, a
  // quarter of the way down the first stream lay in the wild, past the code's land.
  it("is among the code in made-up codebases of every shape, wherever their rivers run", { timeout: 300_000 }, async () => {
    for (const seed of [2, 4, 5]) expectAmongCode(landing(await randomWorld(seed)), `made-up world ${seed}`);
  });
});

describe("where a person comes back to in a world they were in before", () => {
  const { world } = provingWorld();
  // Beside the first building, 6 m east and 2 m north of it, facing west.
  const house = world.things[0] as (typeof world.things)[number];
  const stood = stoodBy(world, house.x + 6, house.z - 2, Math.PI / 2);
  /** The world after an edit: `edit` changes its things, and so its layout. */
  const edited = (edit: (things: (typeof world.things)[number][]) => (typeof world.things)[number][]): typeof world => ({ ...world, things: edit([...world.things]) });

  it("keeps the nearest thing that stands for code by its path, with where it stood", () => {
    expect(stood.by).toEqual({ path: house.path, x: house.x, z: house.z });
  });

  it("is the opening view on a first visit", () => {
    expect(returnTo(world, undefined)).toBeNull();
  });

  it("is exactly where they stood while the code is laid out as it was", () => {
    expect(returnTo(structuredClone(world), stood)).toEqual({ x: house.x + 6, z: house.z - 2, yaw: Math.PI / 2, exact: true });
  });

  it("is beside the thing they stood by, where it stands now, once an edit has moved it", () => {
    const moved = edited((things) => things.map((t) => (t.path === house.path ? { ...t, x: t.x + 40, z: t.z - 25 } : t)));
    expect(returnTo(moved, stood)).toEqual({ x: house.x + 46, z: house.z - 27, yaw: Math.PI / 2, exact: false });
  });

  it("is the opening view once the thing they stood by is gone", () => {
    expect(returnTo(edited((things) => things.filter((t) => t.path !== house.path)), stood)).toBeNull();
  });
});

