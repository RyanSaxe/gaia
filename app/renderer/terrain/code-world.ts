// Opens code worlds from the world service or bundled snapshots. The service
// owns analysis, consent and layout; the offline path requires saved answers.
// Exposes judged code and blueprints to rendering and applies live vitality
// updates while preserving the existing world's layout.

import { type Blueprint, type EntityFacts, type FileFacts, type RouteSpec, type SymbolFact, type ThingFacts, rand, seedOf } from "@gaia/schema";
import { link } from "@gaia/kinds";
import { buildSlots } from "@gaia/realize";
import { type StoodSpot, type WorldSpec, outlinesOf } from "@gaia/terrain";
import { type CodeWorld, type StandsAs, layoutWorld } from "@gaia/world";
import type { ConsentPlan, Heal, JudgedThing, Opening, StartChoice, StartOffer, WorldDocument } from "../../world-service/protocol.ts";
import { type WorldService, worldService } from "../service.ts";
import SHOWCASE_PAINTING from "../start/showcase-painting.webp";
import { CHOSEN_MS } from "../start/start.ts";
import showcaseJudged from "./fixtures/showcase-judged.json";
import showcaseFixedJudged from "./fixtures/showcase-fixed-judged.json";
import showcaseCode from "./fixtures/showcase-code.txt?raw";
import showcaseFixedCode from "./fixtures/showcase-code-v1-fixed.txt?raw";
import { type Snapshot, snapshotFacts } from "./snapshot-facts.ts";
import { showcaseFiles } from "./showcase-code.ts";
import type { LayoutReply, LayoutRequest } from "./layout-worker.ts";
import LayoutWorker from "./layout-worker.ts?worker";
import { facts as provingFacts, judged as provingJudged } from "virtual:proving-ground";
import { COMPOSED_FORMS, COMPOSING, WATERS } from "./looks.ts";
import { type BuildingOf, type Represented, representEntity, representFile } from "./represent.ts";
import { composedName } from "./settlement.ts";
import { AS_THING, type StandCode, type StandLot } from "./stand.ts";

/** The wait a world opens behind: it shows how opening goes, and asks before spending past the limit. */
export interface Veil {
  /** How opening the world is going: the land's outlines and patches, then each file's health and the areas judged so far. */
  opening(o: Opening): void;
  /** Everything is judged and laid out: `health` is every file's vitality, by path, and the world bakes now. */
  baking(health: Readonly<Record<string, number>>): void;
  /** Asks whether to send `plan` to Jev; resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
  /** The world could not be opened: says why, and the wait stays. */
  failed(message: string): void;
  /** Offers the start when no folder is named (app/renderer/start/); resolves with the place chosen. The next `opening` takes it away. */
  choose(offer: StartOffer): Promise<StartChoice>;
}

export interface OpenedWorld {
  readonly world: CodeWorld;
  /** The terrain's regions: one per directory with land of its own. */
  readonly spec: WorldSpec;
  readonly files: ReadonlyMap<string, FileFacts>;
  /** What each building stands for (an entity, a file or a definition), with the building Jev composed, in the order the stand sites them. */
  readonly buildings: readonly BuildingOf[];
  /** What each landmark stands for: the landmark Jev composed for it, its numbers and what its page says, in the order the stand sites them. */
  readonly landmarks: readonly { readonly path: string; readonly blueprint: Blueprint; readonly facts: ThingFacts; readonly vitality: number; readonly represented: Represented }[];
  /**
   * What each of `stand.symbols` stands for, by its index: a definition (as `world.symbols` holds them, in order),
   * then each file and entity standing as flowers, a stone, a bush or a tree (`world.standing`).
   */
  readonly standing: (i: number) => StandingOf | undefined;
  /** The light, sky and wind Jev composed for the world. */
  readonly sky: Blueprint;
  /** The bush Jev composed for each of the wild's grounds past the land (`WILD_GROUNDS`), which stands for no code. */
  readonly wild: readonly Blueprint[];
  /** Every distinct blueprint the world's trees, stones, bushes and flowers take, by the group that draws them: each stands one build, copied. */
  readonly plants: PlantBuilds;
  /** What the bake thread needs to stand this world's things, given the request's trail styles. */
  readonly stand: StandCode;
  /** What the understanding pass judged about a folder, a file or a definition, by its path or path#name. */
  readonly thing: (of: string) => JudgedThing | undefined;
  /** How the judging went, in words. */
  readonly summary: string;
  /** Where the person stood when they last left this world, if they were here before (`returnTo`). */
  readonly stood?: StoodSpot;
}

/**
 * A region's land with its water as Jev chose it. A valley's stream and a basin's pond are the water itself, filled in
 * when the land was composed (`WATERS`' `settles`); a land whose landform cannot hold its water takes the valley or the
 * basin that can, in its own cover. The water's words say why it is there.
 */
export function withWater(biome: Blueprint, water: string): Blueprint {
  const relief = biome.slots.relief;
  if (relief === undefined) return biome;
  const settled = WATERS[water]?.settles ?? {};
  const stream = settled["relief.stream"];
  const swap = (use: string, params: Record<string, string | boolean>): Blueprint => ({ ...biome, slots: { ...biome.slots, relief: { use: use as typeof relief.use, params } } });
  if (settled["relief.pond"] === true && relief.use !== "basin@1") return swap("basin@1", { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true });
  if (typeof stream === "string" && stream !== "dry bed" && relief.use !== "valley@1") return swap("valley@1", { depth: "shallow", width: "broad", run: relief.use === "basin@1" ? "east-west" : "north-south", fall: "gentle", meander: "winding", stream });
  return biome;
}

const KIND_NAMES: Readonly<Record<SymbolFact["kind"], string>> = { function: "Function", class: "Class", type: "Type", module: "Module" };
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { typescript: "TypeScript", javascript: "JavaScript", rust: "Rust" };

/** What stands for a file's finer entity says about it: its name, its kind and its own vitality. */
export function representSymbol(s: CodeWorld["symbols"][number], file: FileFacts): Represented {
  return {
    id: s.id,
    name: s.name,
    what: [KIND_NAMES[s.kind], s.exported ? "exported" : "inside its file", LANGUAGE_NAMES[file.language] ?? file.language].join(" · "),
    vitality: s.vitality,
  };
}

/** The groups that draw the small things: trees with the woods, the rest in the understory, mushrooms apart for their turf. */
export type PlantGroup = "trees" | "rocks" | "shrubs" | "flowers" | "mushrooms";
export const PLANT_GROUPS: readonly PlantGroup[] = ["trees", "rocks", "shrubs", "flowers", "mushrooms"];

/** Every distinct blueprint of a group, in the order the world first meets each: a copy's variant indexes them. */
export type PlantBuilds = Readonly<Record<PlantGroup, readonly Blueprint[]>>;

/** The group a small thing is drawn with: by what it stands as, and a drift of mushrooms apart from other flowers. */
export function plantGroup(as: Exclude<StandsAs, "building" | "landmark">, blueprint: Blueprint): PlantGroup {
  if (as === "flowers") return blueprint.slots.drift?.use === "mushrooms@1" ? "mushrooms" : "flowers";
  return as === "tree" ? "trees" : as === "bush" ? "shrubs" : "rocks";
}

/** The sizes each kind of standing thing looks right between, by how much it matters: a stone can grow to a landmark, a flower barely grows. */
const STAND_SCALE: Readonly<Record<string, readonly [number, number]>> = { trees: [0.55, 1.35], rocks: [0.4, 2.2], shrubs: [0.5, 1.6], flowers: [0.7, 1.3], mushrooms: [0.7, 1.3] };

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
function serviceWorld(service: WorldService, veil: Veil): Promise<{ readonly document: WorldDocument; readonly stood?: StoodSpot }> {
  return new Promise((resolve, reject) => {
    const off = service.on((m) => {
      if (m.type === "world.progress") veil.opening(m.opening);
      else if (m.type === "world.start") void veil.choose(m.offer).then((place) => service.send({ type: "world.choose", place }));
      else if (m.type === "world.consent") void veil.ask(m.plan).then((approve) => service.send({ type: "world.consent", approve }));
      else if (m.type === "world.document") {
        off();
        resolve(m.stood === undefined ? { document: m.document } : { document: m.document, stood: m.stood });
      } else if (m.type === "world.failed") {
        off();
        reject(new Error(m.message));
      }
    });
    service.send({ type: "world.open" });
  });
}

/** Calls `heal` with each heal the world service sends this page (`world.vitality`); a page with no service hears none. */
export function onHeal(heal: (h: Heal) => void): void {
  worldService()?.on((m) => {
    if (m.type === "world.vitality") heal(m);
  });
}

/** What the understanding pass judged about each snapshot's things, for the journal. */
const SNAPSHOT_JUDGED: Readonly<Record<Snapshot, unknown>> = { showcase: showcaseJudged, "showcase-fixed": showcaseFixedJudged };

/** A world from a bundled snapshot (`snapshot.ts`), the showcase's, laid out on a thread of its own while the wait draws. */
function snapshotWorld(why: string, of: Snapshot): Promise<WorldDocument> {
  const facts = snapshotFacts(of);
  const worker = new LayoutWorker();
  const failed = (why: string): Error => new Error(`The showcase could not be laid out: ${why}`);
  return new Promise<WorldDocument>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<LayoutReply>) => {
      const reply = e.data;
      if ("failed" in reply) reject(failed(reply.failed));
      else resolve({ root: facts.repository.name, facts, judged: SNAPSHOT_JUDGED[of] as Record<string, JudgedThing>, ...reply });
    };
    worker.onerror = (e) => reject(failed(e.message));
    worker.postMessage({ why, of } satisfies LayoutRequest);
  }).finally(() => worker.terminate());
}

/**
 * The proving ground (`?world=proving`): a made-up codebase with every
 * feature a world can show, from thriving to ruin, laid out from the choices
 * fixed for it, which the build makes from the plan in `tools/proving.ts`
 * (`virtual:proving-ground`). It is laid out, stood and baked like any codebase's world.
 */
export function provingWorld(): WorldDocument {
  const facts = provingFacts;
  // The proving ground keeps a square, so everything its tests look for stands where they look.
  const world = layoutWorld(facts, provingJudged, undefined, 1);
  return { root: facts.repository.name, facts, world, summary: "The proving ground: every choice fixed so each feature shows", judged: {} };
}

/** Whether the page asks for the proving ground (`?world=proving`), which opens with or without an engine. */
const ASKS_PROVING = typeof location !== "undefined" && new URLSearchParams(location.search).get("world") === "proving";

/**
 * Which showcase the page asks for, if any: the made-up codebase whose
 * world the film is walked through, judged by Jev and carried as a snapshot
 * with its source (`docs/showcase.md`), so it opens the same with or without
 * an engine. `?world=showcase` has its old `v1/` as it is, `?world=showcase-fixed`
 * the same land with `v1/` fixed.
 */
const ASKS_SHOWCASE: Snapshot | null = ((world) => (world === "showcase" || world === "showcase-fixed" ? world : null))(
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get("world"),
);

/** The showcase the page shows, if any: the one it asks for, or the showcase as it is on a page with no engine that asks for no world. */
function shownShowcase(): Snapshot | null {
  return ASKS_SHOWCASE ?? (ASKS_PROVING || worldService() !== null ? null : "showcase");
}

/** The source of a world the page carries with it, by path, for the journal: the showcase's, with its fixed `v1/` laid over it for the fixed one, none otherwise. */
export function carriedSource(): ReadonlyMap<string, string> | null {
  const shown = shownShowcase();
  if (shown === null) return null;
  return new Map([...showcaseFiles(showcaseCode), ...(shown === "showcase-fixed" ? showcaseFiles(showcaseFixedCode) : [])]);
}

/**
 * The start on a page with no engine, to see it (`?start`):
 * the showcase is the one world walked before, with a painting of where
 * it opens, as the app paints where a person stands (`start/showcase-painting.webp`,
 * from `__lab.immersive.look()`), and any choice opens it, except an
 * address, which a page with no engine cannot follow.
 */
async function previewStart(veil: Veil): Promise<void> {
  const facts = snapshotFacts("showcase");
  const recent = [{ root: facts.repository.name, name: facts.repository.name, at: Date.now(), painting: SHOWCASE_PAINTING }];
  let place = await veil.choose({ recent });
  while ("address" in place) place = await veil.choose({ recent, refused: { address: place.address, why: "offline" } });
  veil.opening({ stage: "reading", root: facts.repository.name });
  // The chosen card rises into the wait's sheet before the land it opens on comes in.
  await new Promise((resolve) => setTimeout(resolve, CHOSEN_MS));
}

/** A codebase's world: judged, laid out and ready to bake. */
export async function codeWorld(veil: Veil): Promise<OpenedWorld> {
  const service = worldService();
  let document: WorldDocument;
  // Where the person stood when they last left this world; only the world service keeps it.
  let stood: StoodSpot | undefined;
  let landed = false;
  const watched: Veil = { ...veil, opening: (o) => ((landed ||= o.stage === "land"), veil.opening(o)) };
  // A world that cannot be opened says why on the wait, which stays: nothing else is shown in its place.
  try {
    if (ASKS_PROVING) document = provingWorld();
    else if (ASKS_SHOWCASE !== null) document = await snapshotWorld("the showcase", ASKS_SHOWCASE);
    else if (service === null) {
      if (typeof location !== "undefined" && new URLSearchParams(location.search).has("start")) await previewStart(veil);
      document = await snapshotWorld("no engine on a standalone page", "showcase");
    } else ({ document, stood } = await serviceWorld(service, watched));
  } catch (error) {
    const message = (error as Error).message;
    console.error(`gaia: could not open the world: ${message}`);
    veil.failed(message);
    throw error;
  }
  // Traced once now, while the world loads, so the field map never traces them mid-walk.
  const outlines = outlinesOf(document.world);
  // A world laid out here, with no world service, shows its land only now.
  if (!landed) veil.opening({ stage: "land", name: document.world.name, size: document.world.size, ...(document.world.aspect === undefined ? {} : { aspect: document.world.aspect }), areas: outlines.areas, patches: document.world.patches, lots: document.world.things.map(({ x, z }) => ({ x, z })) });
  veil.baking(Object.fromEntries(document.world.patches.map((p) => [p.path, p.vitality])));
  return stood === undefined ? openedWorld(document) : { ...openedWorld(document), stood };
}

/** A trail's route as the terrain walks it: what its link blueprint builds. A trail Jev composed no route for is a fault, never a default. */
function routeOf(trail: { readonly from: string; readonly to: string; readonly route?: Blueprint }): RouteSpec {
  if (trail.route === undefined) throw new Error(`The trail from ${trail.from || "the root"} to ${trail.to || "the root"} has no route: Jev composes every trail's.`);
  return buildSlots(trail.route, link, COMPOSING.lib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec;
}

/** What one of the stand's symbols stands for: its page, its file (none for an entity's) and its form. */
export interface StandingOf {
  readonly represented: Represented;
  readonly file?: string;
  readonly form: string;
}

/** A file's page, when the file stands as a thing of its own. */
const representStanding = (s: CodeWorld["standing"][number], files: ReadonlyMap<string, FileFacts>, entities: ReadonlyMap<string, EntityFacts>): Represented => {
  if (s.of === "file") {
    const f = files.get(s.path);
    if (f === undefined) throw new Error(`${s.path} stands in the world but is not among its files.`);
    return representFile(f, s.vitality);
  }
  const e = entities.get(s.path);
  if (e === undefined) throw new Error(`${s.path || "The repository's root"} stands as an entity but is not one.`);
  return representEntity(e, s.vitality);
};

/** The numbers a building or a landmark is built from, and its page, for whatever it stands for. */
function thingOf(t: CodeWorld["things"][number], world: CodeWorld, files: ReadonlyMap<string, FileFacts>, entities: ReadonlyMap<string, EntityFacts>): { facts: ThingFacts; represented: Represented } {
  const of = t.of ?? "entity";
  if (of === "entity") {
    const e = entities.get(t.path);
    if (e === undefined) throw new Error(`${t.path || "The repository's root"} stands as an entity but is not one.`);
    return { facts: e, represented: representEntity(e, t.vitality) };
  }
  const file = files.get(t.file ?? "");
  if (file === undefined) throw new Error(`${t.path} stands on ${t.file ?? "no file"}, which is not among the world's files.`);
  const facts: ThingFacts = t.facts ?? { path: t.path, name: t.name, lines: file.lines, exports: 0, dependents: [] };
  if (of === "file") return { facts, represented: representFile(file, t.vitality) };
  const sym = world.symbols.find((s) => s.id === t.path);
  if (sym === undefined) throw new Error(`${t.path} stands as a definition but is not one.`);
  return { facts, represented: representSymbol(sym, file) };
}

/** Everything the world needs to bake and furnish a world document. */
export function openedWorld({ facts, world, summary, judged }: WorldDocument): OpenedWorld {
  // A world Jev composed no sky or land for is a fault, never a default.
  const sky = world.sky;
  if (sky === undefined) throw new Error(`${world.name} has no sky: Jev composes every world's light, sky and wind.`);
  const wild = world.wild;
  if (wild === undefined) throw new Error(`${world.name} has no wild bushes: Jev composes the bush of each of the wild's grounds.`);
  const landOf = (r: CodeWorld["regions"][number]): Blueprint => {
    if (r.biome === undefined) throw new Error(`${r.area || "The repository's root"} has no land: Jev composes every area's.`);
    return r.biome;
  };
  const spec: WorldSpec = {
    size: world.size,
    // The terrain is baked to the land's own rectangle, the one its areas are laid out on.
    ...(world.aspect === undefined ? {} : { aspect: world.aspect }),
    regions: world.regions.map((r) => ({
      id: r.area === "" ? world.name : r.area,
      x: r.x,
      z: r.z,
      base: rand(seedOf(`base:${r.area}`)).range(-2, 2),
      reach: r.reach,
      sites: r.sites,
      biome: withWater(landOf(r), r.water),
    })),
  };
  const entities = new Map(facts.entities.map((e) => [e.path, e]));
  const files = new Map(facts.files.map((f) => [f.path, f]));
  const lot = (t: CodeWorld["things"][number]): StandLot => ({ id: t.path, x: t.x, z: t.z, radius: t.lot * 0.6 });
  const houses = world.things.filter((t) => t.as === "building");
  const rises = world.things.filter((t) => t.as === "landmark");
  // What each of the stand's symbols stands for: every definition, then each file and entity standing as a plant, a stone or flowers.
  const symbolOf = (i: number): StandingOf | undefined => {
    const sym = world.symbols[i];
    if (sym !== undefined) {
      const file = files.get(sym.file);
      return file === undefined ? undefined : { represented: representSymbol(sym, file), file: sym.file, form: sym.form };
    }
    const own = world.standing[i - world.symbols.length];
    if (own === undefined) return undefined;
    return { represented: representStanding(own, files, entities), ...(own.file === undefined ? {} : { file: own.file }), form: own.form };
  };
  // Every distinct blueprint of each group, in the order the stand's symbols first meet it; two things answered alike share one.
  const plants: Record<PlantGroup, Blueprint[]> = { trees: [], rocks: [], shrubs: [], flowers: [], mushrooms: [] };
  const variantOf = (group: PlantGroup, blueprint: Blueprint): number => {
    const builds = plants[group];
    const k = builds.findIndex((b) => b.id === blueprint.id);
    return k >= 0 ? k : builds.push(blueprint) - 1;
  };
  const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
  type Small = { readonly x: number; readonly z: number; readonly form: string; readonly as?: StandsAs; readonly blueprint?: Blueprint; readonly lines: number; readonly importance?: number; readonly vitality: number; readonly file?: string };
  const symbol = (s: Small, who: string): StandCode["symbols"][number] => {
    // A definition standing as a building or a landmark is one of the world's things, stood with them.
    if (COMPOSED_FORMS[s.form] !== undefined) return { x: s.x, z: s.z, rule: AS_THING, variant: 0, radius: 0, scale: 0, vitality: s.vitality };
    // Every thing stands as the blueprint Jev composed for it; one with none is a fault, never a default form.
    if (s.as === undefined || s.blueprint === undefined || s.as === "building" || s.as === "landmark") throw new Error(`${who} stands as "${s.form}" with no blueprint of a tree, a bush, a stone or flowers.`);
    const group = plantGroup(s.as, s.blueprint);
    const patch = s.file === undefined ? undefined : patchOf.get(s.file);
    return { x: s.x, z: s.z, rule: group, variant: variantOf(group, s.blueprint), radius: group === "flowers" || group === "mushrooms" ? 0.8 : 1, scale: symbolScale(s.lines, group, s.importance), vitality: s.vitality, ...(patch === undefined ? {} : { patch }) };
  };
  const symbols = [...world.symbols.map((s) => symbol(s, s.id)), ...world.standing.map((s) => symbol(s, s.path || "The repository's root"))];
  return {
    world,
    spec,
    plants,
    thing: (of) => judged[of],
    files,
    buildings: houses.map((t) => ({ ...thingOf(t, world, files, entities), blueprint: t.blueprint, kindName: composedName(t.blueprint), vitality: t.vitality })),
    landmarks: rises.map((t) => ({ path: t.path, blueprint: t.blueprint, vitality: t.vitality, ...thingOf(t, world, files, entities) })),
    standing: symbolOf,
    sky,
    wild,
    stand: {
      lots: houses.map(lot),
      landmarks: rises.map((t, i) => ({ landmark: i, lot: lot(t) })),
      // An entity standing as a plant, a stone or flowers: its trails end at its lot's middle.
      places: world.standing.flatMap((s) => (s.of === "entity" ? [{ id: s.path, x: s.x, z: s.z, radius: 2 }] : [])),
      patches: world.patches.map((p) => ({ x: p.x, z: p.z, radius: p.radius })),
      cells: (() => {
        const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
        const areaOf = new Map(world.areas.map((a, i) => [a.path, i]));
        return world.cells.map((c) => ({ x: c.x, z: c.z, patch: c.file === null || c.file === undefined ? -1 : (patchOf.get(c.file) ?? -1), area: areaOf.get(c.area) ?? 0 }));
      })(),
      symbols,
      // Trails joining parts of the code no other trail joins route first, then the most wanted.
      // Each trail keeps the width, wear, edging, winding and crossing Jev composed for it.
      trails: world.trails.map((t) => ({ from: t.from, to: t.to, want: (t.spans === true ? 1 : 0) + t.want, style: routeOf(t) })),
    },
    summary,
  };
}
