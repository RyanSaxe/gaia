// "This codebase": a codebase's world. Inside the app it comes from the world
// service, which opens the folder main names (Gaia's own repository unless
// the person opens another), has Jev or the stand-in judge it, and lays it
// out; while that happens the wait paints the land as it is judged
// (app/renderer/wait/), and asks the person only before spending past their
// limit. A standalone page (the
// offline HTML, `pnpm lab:serve`) has no engine: it lays out the engine's
// graph of this repository (`fixtures/gaia-graph.json`, written by `pnpm
// graph-snapshot`), judged by Jev's answers kept for it (`fixtures/gaia-jev.json`,
// written by `pnpm jev-world`), or by the stand-in with `?judge=stand-in` and
// wherever no kept answer fits. Everything else follows from the code:
// each directory's area and land, each file's patch and what grows on it,
// each entity's building or landmark on its lot, and the trails between them.

import { type Blueprint, type CodeFacts, type EntityFacts, type FileFacts, type RouteSpec, type SymbolFact, rand, seedOf } from "@gaia/schema";
import { link } from "@gaia/kinds";
import { TRAIL_PRESETS, WORLD_PRESETS, buildSlots } from "@gaia/realize";
import { type WorldSpec, outlinesOf } from "@gaia/terrain";
import { type CodeWorld, type Judge, type Judgments, layoutWorld } from "@gaia/world";
import type { ConsentPlan, JudgedThing, Opening, StartChoice, StartOffer, WorldDocument } from "../../world-service/protocol.ts";
import { type WorldService, worldService } from "../service.ts";
import GAIA_PICTURE from "../start/gaia-picture.webp";
import { CHOSEN_MS } from "../start/start.ts";
import snapshotJudged from "./fixtures/gaia-judged.json";
import { snapshotFacts } from "./snapshot-facts.ts";
import type { LayoutReply, LayoutRequest } from "./layout-worker.ts";
import LayoutWorker from "./layout-worker.ts?worker";
import proving from "./fixtures/proving.json";
import provingJudged from "./fixtures/proving-judged.json";
import { CHARACTERS, COMPOSING, FORMS, LANDS } from "./looks.ts";
import type { Represented, SampleEntity } from "./samples.ts";
import { composedName } from "./settlement.ts";
import type { StandCode, StandLot } from "./stand.ts";

/** The wait a world opens behind: it shows how opening goes, and asks before spending past the limit. */
export interface Veil {
  /** How opening the world is going: the land's outlines and patches, then each file's health and the areas judged so far. */
  opening(o: Opening): void;
  /** Everything is judged and laid out: `health` is every file's vitality, by path, and the world bakes now. */
  baking(health: Readonly<Record<string, number>>): void;
  /** Asks whether to send `plan` to Jev; resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
  /** Offers the start when no folder is named (app/renderer/start/); resolves with the place chosen. The next `opening` takes it away. */
  choose(offer: StartOffer): Promise<StartChoice>;
}

export interface CodeLab {
  readonly world: CodeWorld;
  /** The terrain's regions: one per directory with land of its own. */
  readonly spec: WorldSpec;
  readonly files: ReadonlyMap<string, FileFacts>;
  /** The entities buildings stand for, each with the building Jev composed, in the order the stand sites them. */
  readonly buildings: readonly SampleEntity[];
  /** The entities landmarks stand for: the landmark Jev composed for each and its facts, in the order the stand sites them. */
  readonly landmarks: readonly { readonly path: string; readonly blueprint: Blueprint; readonly facts: EntityFacts; readonly vitality: number }[];
  /** The light, sky, season and wind the world takes: what Jev composed, by name for the lab's reports. */
  readonly sky: { readonly name: string; readonly world: Blueprint } | undefined;
  /** What the bake thread needs to stand this world's things, given the request's trail styles. */
  readonly stand: StandCode;
  /** Who judged a thing, by `judgedThing` ("file:src/main.ts", "entity:packages/world"). */
  readonly judgeOf: (thing: string) => Judge;
  /** What the understanding pass judged about a folder, a file or a definition, by its path or path#name. */
  readonly thing: (of: string) => JudgedThing | undefined;
  /** How the judging went, in words. */
  readonly summary: string;
}

/**
 * A region's land with its water as Jev chose it: a brook or a trickle runs
 * along a valley's floor, a pond fills a basin, and an area with water whose
 * landform holds none takes the valley or the basin that can, in its own
 * cover. The water's words say why it is there.
 */
export function withWater(biome: Blueprint, water: string): Blueprint {
  const relief = biome.slots.relief;
  const cover = biome.slots.cover;
  if (relief === undefined) return biome;
  const stream = water === "A brook" ? "brook" : water === "A trickle" ? "trickle" : "dry bed";
  const pond = water === "A still pond";
  const swap = (use: string, params: Record<string, string | boolean>): Blueprint => ({ ...biome, slots: { ...biome.slots, relief: { use: use as typeof relief.use, params } } });
  if (relief.use === "valley@1") return pond ? swap("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true }) : swap("valley@1", { ...relief.params, stream } as Record<string, string>);
  if (relief.use === "basin@1") return stream !== "dry bed" ? swap("valley@1", { depth: "shallow", width: "broad", run: "east-west", fall: "gentle", meander: "winding", stream }) : swap("basin@1", { ...relief.params, pond } as Record<string, string | boolean>);
  if (stream !== "dry bed") return swap("valley@1", { depth: "shallow", width: "broad", run: "north-south", fall: "gentle", meander: "winding", stream });
  if (pond) return swap("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true });
  void cover;
  return biome;
}

const KIND_NAMES: Readonly<Record<SymbolFact["kind"], string>> = { function: "Function", class: "Class", type: "Type", module: "Module" };
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { typescript: "TypeScript", javascript: "JavaScript", rust: "Rust" };

/** What a card says about a file's finer entity: its name, kind, doc comment, where it is declared and its own vitality. */
export function representSymbol(s: CodeWorld["symbols"][number], file: FileFacts): Represented {
  return {
    id: s.id,
    name: s.name,
    what: [KIND_NAMES[s.kind], s.exported ? "exported" : "inside its file", LANGUAGE_NAMES[file.language] ?? file.language].join(" · "),
    doc: s.doc ?? "",
    where: `${s.file}:${s.line}`,
    size: `${s.lines.toLocaleString()} ${s.lines === 1 ? "line" : "lines"} of ${file.lines.toLocaleString()} in its file`,
    dependsOn: [],
    dependents: [],
    vitality: s.vitality,
  };
}

/** The sizes each kind of standing thing looks right between, by how much it matters: a stone can grow to a landmark, a flower barely grows. */
const STAND_SCALE: Readonly<Record<string, readonly [number, number]>> = { trees: [0.55, 1.35], rocks: [0.4, 2.2], shrubs: [0.5, 1.6], flowers: [0.7, 1.3] };

/**
 * How large a definition stands, within what its blueprint looks right at:
 * by how much it matters (Jev's importance, 0 to 1) when Jev has judged it, so
 * a file's heart stands as its landmark and a helper as a pebble; by its
 * length until then, as before.
 */
export const symbolScale = (lines: SymbolFact["lines"], rule: string, importance?: number): number => {
  if (importance === undefined) {
    const t = Math.min(1, Math.log2(1 + (lines ?? 1)) / 8);
    return rule === "trees" ? 0.7 + 0.5 * t : rule === "rocks" ? 0.45 + 0.75 * t : rule === "shrubs" ? 0.6 + 0.6 * t : 0.8 + 0.4 * t;
  }
  const [small, large] = STAND_SCALE[rule] ?? [0.7, 1.3];
  return small + (large - small) * Math.min(1, Math.max(0, importance)) ** 1.3;
};

/** The world from the world service: opened, judged and laid out there, with the wait kept up to date. */
function serviceWorld(service: WorldService, veil: Veil): Promise<WorldDocument> {
  return new Promise((resolve, reject) => {
    const off = service.on((m) => {
      if (m.type === "world.progress") veil.opening(m.opening);
      else if (m.type === "world.start") void veil.choose(m.offer).then((place) => service.send({ type: "world.choose", place }));
      else if (m.type === "world.consent") void veil.ask(m.plan).then((approve) => service.send({ type: "world.consent", approve }));
      else if (m.type === "world.document") {
        off();
        resolve(m.document);
      } else if (m.type === "world.failed") {
        off();
        reject(new Error(m.message));
      }
    });
    service.send({ type: "world.open" });
  });
}

/** Who judges a page with no engine: Jev's kept answers, unless the page asks for the stand-in (`?judge=stand-in`). */
const SNAPSHOT_JUDGE = typeof location === "undefined" || new URLSearchParams(location.search).get("judge") !== "stand-in" ? "jev" : "stand-in";

/**
 * Gaia's own world from the bundled snapshot (`snapshot.ts`), the world of a
 * page with no engine, laid out on a thread of its own while the wait draws.
 */
function snapshotWorld(why: string): Promise<WorldDocument> {
  const facts = snapshotFacts();
  const worker = new LayoutWorker();
  return new Promise<WorldDocument>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<LayoutReply>) => {
      const reply = e.data;
      if ("failed" in reply) reject(new Error(`Gaia's snapshot could not be laid out: ${reply.failed}`));
      else resolve({ root: facts.repository.name, facts, judged: snapshotJudged as unknown as Record<string, JudgedThing>, ...reply });
    };
    worker.onerror = (e) => reject(new Error(`Gaia's snapshot could not be laid out: ${e.message}`));
    worker.postMessage({ judge: SNAPSHOT_JUDGE, why } satisfies LayoutRequest);
  }).finally(() => worker.terminate());
}

/**
 * The proving ground (`?world=proving`): a made-up codebase with every
 * feature a world can show, from thriving to ruin, laid out from the choices
 * fixed for it (`fixtures/proving.json` and `proving-judged.json`, written by
 * `pnpm proving`). It is laid out, stood and baked like any codebase's world.
 */
export function provingWorld(): WorldDocument {
  const facts = proving as unknown as CodeFacts;
  // The proving ground keeps a square, so everything its tests look for stands where they look.
  const world = layoutWorld(facts, provingJudged as unknown as Judgments, undefined, 1);
  return { root: facts.repository.name, facts, world, judges: {}, summary: "The proving ground: every choice fixed so each feature shows", judged: {} };
}

/** Whether the page asks for the proving ground (`?world=proving`), which opens with or without an engine. */
const ASKS_PROVING = typeof location !== "undefined" && new URLSearchParams(location.search).get("world") === "proving";

/**
 * The start on a page with no engine, to see it (`?start=table|signpost`):
 * Gaia's own world is the one world walked before, with a picture of its map
 * the app painted (`start/gaia-picture.webp`), and any choice opens it,
 * except an address, which a page with no engine cannot follow.
 */
async function previewStart(veil: Veil): Promise<void> {
  const facts = snapshotFacts();
  const recent = [{ root: facts.repository.name, name: facts.repository.name, at: Date.now(), picture: GAIA_PICTURE }];
  let place = await veil.choose({ recent });
  while ("address" in place) place = await veil.choose({ recent, refused: { address: place.address, why: "offline" } });
  veil.opening({ stage: "reading", root: facts.repository.name });
  // The chosen map rises into the wait's sheet before the land it opens on comes in.
  await new Promise((resolve) => setTimeout(resolve, CHOSEN_MS));
}

/** A codebase's world: judged, laid out and ready to bake. */
export async function codeWorld(veil: Veil): Promise<CodeLab> {
  const service = worldService();
  let document: WorldDocument;
  let landed = false;
  const watched: Veil = { ...veil, opening: (o) => ((landed ||= o.stage === "land"), veil.opening(o)) };
  if (ASKS_PROVING) document = provingWorld();
  else if (service === null) {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("start")) await previewStart(veil);
    document = await snapshotWorld("no engine on a standalone page");
  } else {
    try {
      document = await serviceWorld(service, watched);
    } catch (error) {
      console.error(`gaia: showing Gaia's snapshot instead: ${(error as Error).message}`);
      document = await snapshotWorld(`the world service could not open it: ${(error as Error).message}`);
      landed = false;
    }
  }
  // Traced once now, while the world loads, so the field map never traces them mid-walk.
  const outlines = outlinesOf(document.world);
  // A world laid out here, with no world service, shows its land only now.
  if (!landed) veil.opening({ stage: "land", name: document.world.name, size: document.world.size, ...(document.world.aspect === undefined ? {} : { aspect: document.world.aspect }), areas: outlines.areas, patches: document.world.patches, lots: document.world.things.map(({ x, z }) => ({ x, z })) });
  veil.baking(Object.fromEntries(document.world.patches.map((p) => [p.path, p.vitality])));
  return codeLab(document);
}

/** A trail's route as the terrain walks it: what its link blueprint builds, or the first hand-filled trail's for one not composed. */
function routeOf(route: Blueprint | undefined): RouteSpec {
  const blueprint = route ?? (TRAIL_PRESETS[0] as (typeof TRAIL_PRESETS)[number]).blueprint;
  return buildSlots(blueprint, link, COMPOSING.lib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec;
}

/** Everything the terrain lab needs to bake and furnish a world document. */
export function codeLab({ facts, world, judges, summary, judged }: WorldDocument): CodeLab {
  const fallback = Object.values(LANDS)[0]?.biome;
  if (fallback === undefined) throw new Error("No lands to choose from.");
  const spec: WorldSpec = {
    size: world.size,
    regions: world.regions.map((r) => ({
      id: r.area === "" ? world.name : r.area,
      x: r.x,
      z: r.z,
      base: rand(seedOf(`base:${r.area}`)).range(-2, 2),
      reach: r.reach,
      sites: r.sites,
      biome: withWater(r.biome ?? fallback, r.water),
    })),
  };
  const entities = new Map(facts.entities.map((e) => [e.path, e]));
  const lot = (t: CodeWorld["things"][number]): StandLot => ({ id: t.path, x: t.x, z: t.z, radius: t.lot * 0.6 });
  const houses = world.things.filter((t) => t.as === "building");
  const rises = world.things.filter((t) => t.as === "landmark");
  return {
    world,
    spec,
    thing: (of) => judged[of],
    files: new Map(facts.files.map((f) => [f.path, f])),
    buildings: houses.map((t) => ({ facts: entities.get(t.path) as EntityFacts, blueprint: t.blueprint, kindName: composedName(t.blueprint), vitality: t.vitality })),
    landmarks: rises.map((t) => ({ path: t.path, blueprint: t.blueprint, facts: entities.get(t.path) as EntityFacts, vitality: t.vitality })),
    sky: world.sky === undefined ? WORLD_PRESETS[0] : { name: "composed", world: world.sky },
    stand: {
      lots: houses.map(lot),
      landmarks: rises.map((t, i) => ({ landmark: i, lot: lot(t) })),
      patches: world.patches.map((p) => ({ x: p.x, z: p.z, radius: p.radius })),
      regions: world.regions.map((r) => {
        const c = CHARACTERS[r.character];
        return { understory: c?.understory ?? {}, ...(c?.open === undefined ? {} : { open: c.open }) };
      }),
      cells: (() => {
        const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
        const areaOf = new Map(world.areas.map((a, i) => [a.path, i]));
        return world.cells.map((c) => ({ x: c.x, z: c.z, patch: c.file === null || c.file === undefined ? -1 : (patchOf.get(c.file) ?? -1), area: areaOf.get(c.area) ?? 0 }));
      })(),
      symbols: (() => {
        const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
        const areas = new Map(world.areas.map((a) => [a.path, a]));
        // A tree grows as large as its area's ground lets trees grow: taller in a deep wood, smaller on a heath.
        const statureOf = (file: string): number => {
          const area = areas.get(world.patches[patchOf.get(file) ?? -1]?.area ?? "");
          return CHARACTERS[world.regions[area?.region ?? 0]?.character ?? ""]?.stature ?? 1;
        };
        return world.symbols.map((s) => {
          // A definition Jev chose nothing for stands as a plain stone, never as a tree that would stand for a judgment.
          const form = FORMS[s.form] ?? (FORMS["Standing stone"] as (typeof FORMS)[string]);
          const patch = patchOf.get(s.file);
          const scale = symbolScale(s.lines, form.rule, s.importance) * (form.rule === "trees" ? statureOf(s.file) : 1);
          return { x: s.x, z: s.z, rule: form.rule, variant: form.preset, radius: form.rule === "flowers" ? 0.8 : 1, scale, vitality: s.vitality, ...(patch === undefined ? {} : { patch }) };
        });
      })(),
      // Trails joining parts of the code no other trail joins route first, then the most wanted.
      // Each trail keeps the width, wear, edging, winding and crossing Jev composed for it.
      trails: world.trails.map((t) => ({ from: t.from, to: t.to, want: (t.spans === true ? 1 : 0) + t.want, style: routeOf(t.route) })),
    },
    judgeOf: (thing) => judges[thing] ?? "stand-in",
    summary,
  };
}
