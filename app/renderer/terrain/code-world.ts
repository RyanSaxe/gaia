// Opens code worlds from the world service or bundled snapshots. The service
// owns analysis, consent and layout, and the offline path requires saved answers.
// Exposes judged code and blueprints to rendering and applies live vitality
// updates while preserving the existing world's layout.

import { type Blueprint, type EntityFacts, type FileFacts, type RouteSpec, type SymbolFact, type ThingFacts, rand, seedOf } from "@gaia/schema";
import { link } from "@gaia/kinds";
import { buildSlots } from "@gaia/realize";
import { type StoodSpot, type WorldSpec, outlinesOf } from "@gaia/terrain";
import { type CodeWorld, type FormKind, layoutWorld } from "@gaia/world";
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

/** The wait screen a world opens behind. It shows opening progress and asks before spending past the limit. */
export interface Veil {
  /** Reports opening progress: the land's outlines and patches, then each file's vitality and the areas judged so far. */
  opening(o: Opening): void;
  /** Reports that judging and layout are done and the world now bakes. `health` is every file's vitality by path. */
  baking(health: Readonly<Record<string, number>>): void;
  /** Asks whether to send `plan` to Jev. Resolves true to go ahead. */
  ask(plan: ConsentPlan): Promise<boolean>;
  /** Shows why the world could not open. The wait screen stays. */
  failed(message: string): void;
  /** Offers the start screen when no folder is named (app/renderer/start/) and resolves with the chosen place. The next `opening` call hides it. */
  choose(offer: StartOffer): Promise<StartChoice>;
}

export interface OpenedWorld {
  readonly world: CodeWorld;
  /** The terrain's regions: one per directory with land of its own. */
  readonly spec: WorldSpec;
  readonly files: ReadonlyMap<string, FileFacts>;
  /** The entity, file or definition each building represents, with the building Jev composed, in the order `standWorld` sites them. */
  readonly buildings: readonly BuildingOf[];
  /** What each landmark represents: the landmark Jev composed for it, its facts and its page, in the order `standWorld` sites them. */
  readonly landmarks: readonly { readonly path: string; readonly blueprint: Blueprint; readonly facts: ThingFacts; readonly vitality: number; readonly represented: Represented }[];
  /**
   * What each of `stand.symbols` represents, by index: the definitions in `world.symbols` order, then each file and
   * entity that appears as flowers, a stone, a bush or a tree (`world.standing`).
   */
  readonly standing: (i: number) => StandingOf | undefined;
  /** The light, sky and wind Jev composed for the world. */
  readonly sky: Blueprint;
  /** The bush Jev composed for each wild ground past the land (`WILD_GROUNDS`). The wild represents no code. */
  readonly wild: readonly Blueprint[];
  /** Every distinct blueprint of the world's trees, stones, bushes and flowers, by the group that draws them. Each blueprint has one build, copied for every instance. */
  readonly plants: PlantBuilds;
  /** What the bake thread needs to place this world's things, including the trail styles. */
  readonly stand: StandCode;
  /** What the understanding pass judged about a folder, a file or a definition, by its path or path#name. */
  readonly thing: (of: string) => JudgedThing | undefined;
  /** How the judging went, in words. */
  readonly summary: string;
  /** Where the person stood when they last left this world, if they were here before (`returnTo`). */
  readonly stood?: StoodSpot;
}

/**
 * Returns a region's land with the water Jev chose. A valley's stream and a basin's pond were already set when the land
 * was composed (`WATERS`' `settles`). A land whose landform cannot have its water switches to a valley or basin that
 * can, keeping its own cover. The water option's text gives the reason for the water.
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

/** The page for a definition: its name, its kind, whether it is exported, its language and its own vitality. */
export function representSymbol(s: CodeWorld["symbols"][number], file: FileFacts): Represented {
  return {
    id: s.id,
    name: s.name,
    what: [KIND_NAMES[s.kind], s.exported ? "exported" : "inside its file", LANGUAGE_NAMES[file.language] ?? file.language].join(" · "),
    vitality: s.vitality,
  };
}

/** The groups that draw the small things: trees in the woods, the rest in the understory, with mushrooms separate for their turf. */
export type PlantGroup = "trees" | "rocks" | "shrubs" | "flowers" | "mushrooms";
export const PLANT_GROUPS: readonly PlantGroup[] = ["trees", "rocks", "shrubs", "flowers", "mushrooms"];

/** Every distinct blueprint of each group, in first-seen order. A copy's variant indexes them. */
export type PlantBuilds = Readonly<Record<PlantGroup, readonly Blueprint[]>>;

/** The group that draws a small thing, by the form it appears as. A drift of mushrooms is separate from other flowers. */
export function plantGroup(as: Exclude<FormKind, "building" | "landmark">, blueprint: Blueprint): PlantGroup {
  if (as === "flowers") return blueprint.slots.drift?.use === "mushrooms@1" ? "mushrooms" : "flowers";
  return as === "tree" ? "trees" : as === "bush" ? "shrubs" : "rocks";
}

/** The scale range each plant group looks right in, chosen by importance. A stone can grow to landmark size, and a flower barely grows. */
const STAND_SCALE: Readonly<Record<string, readonly [number, number]>> = { trees: [0.55, 1.35], rocks: [0.4, 2.2], shrubs: [0.5, 1.6], flowers: [0.7, 1.3], mushrooms: [0.7, 1.3] };

/**
 * A definition's scale within its group's range (`STAND_SCALE`). Once Jev has
 * judged it, Jev's importance from 0 to 1 sets the scale, so a file's central
 * definition is large and a helper is a pebble. Before that, its line count
 * sets it.
 */
export const symbolScale = (lines: SymbolFact["lines"], rule: string, importance?: number): number => {
  if (importance === undefined) {
    const t = Math.min(1, Math.log2(1 + (lines ?? 1)) / 8);
    return rule === "trees" ? 0.7 + 0.5 * t : rule === "rocks" ? 0.45 + 0.75 * t : rule === "shrubs" ? 0.6 + 0.6 * t : 0.8 + 0.4 * t;
  }
  const [small, large] = STAND_SCALE[rule] ?? [0.7, 1.3];
  return small + (large - small) * Math.min(1, Math.max(0, importance)) ** 1.3;
};

/** Opens the world through the world service, which judges and lays it out, and keeps the wait screen updated. */
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

/** Calls `heal` with each heal the world service sends this page (`world.vitality`). A page with no service gets none. */
export function onHeal(heal: (h: Heal) => void): void {
  worldService()?.on((m) => {
    if (m.type === "world.vitality") heal(m);
  });
}

/** What the understanding pass judged about each snapshot's things, for the journal. */
const SNAPSHOT_JUDGED: Readonly<Record<Snapshot, unknown>> = { showcase: showcaseJudged, "showcase-fixed": showcaseFixedJudged };

/** Lays out a world from a bundled showcase snapshot (`snapshot.ts`) on a worker while the wait screen draws. */
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
 * feature a world can show, across the whole range of vitality, laid out from
 * fixed choices that the build makes from the plan in `tools/proving.ts`
 * (`virtual:proving-ground`). It is laid out, placed and baked like any
 * codebase's world.
 */
export function provingWorld(): WorldDocument {
  const facts = provingFacts;
  // The proving ground keeps a square aspect, so everything its tests look for is where they look.
  const world = layoutWorld(facts, provingJudged, undefined, 1);
  return { root: facts.repository.name, facts, world, summary: "The proving ground: every choice fixed so each feature shows", judged: {} };
}

/** Whether the page asks for the proving ground (`?world=proving`), which opens with or without an engine. */
const ASKS_PROVING = typeof location !== "undefined" && new URLSearchParams(location.search).get("world") === "proving";

/**
 * The showcase the page requests, if any. The showcase is the made-up
 * codebase the film walks through, judged by Jev and bundled as a snapshot
 * with its source (`docs/showcase.md`), so it opens the same with or without
 * an engine. `?world=showcase` has its old `v1/` as it is, and
 * `?world=showcase-fixed` is the same land with `v1/` fixed.
 */
const ASKS_SHOWCASE: Snapshot | null = ((world) => (world === "showcase" || world === "showcase-fixed" ? world : null))(
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get("world"),
);

/** The showcase the page shows, if any: the one it requests, or the plain showcase on a page with no engine that requests no world. */
function shownShowcase(): Snapshot | null {
  return ASKS_SHOWCASE ?? (ASKS_PROVING || worldService() !== null ? null : "showcase");
}

/** The source files of a bundled world by path, for the journal: the showcase's, with the fixed `v1/` laid over it for the fixed showcase, or null otherwise. */
export function carriedSource(): ReadonlyMap<string, string> | null {
  const shown = shownShowcase();
  if (shown === null) return null;
  return new Map([...showcaseFiles(showcaseCode), ...(shown === "showcase-fixed" ? showcaseFiles(showcaseFixedCode) : [])]);
}

/**
 * Previews the start screen on a page with no engine (`?start`). The
 * showcase appears as the one recent world, with a painting of where it
 * opens, made the way the app paints the person's view
 * (`start/showcase-painting.webp`, from `__lab.immersive.look()`). Any choice
 * opens it, except an address, which a page with no engine cannot follow.
 */
async function previewStart(veil: Veil): Promise<void> {
  const facts = snapshotFacts("showcase");
  const recent = [{ root: facts.repository.name, name: facts.repository.name, at: Date.now(), painting: SHOWCASE_PAINTING }];
  let place = await veil.choose({ recent });
  while ("address" in place) place = await veil.choose({ recent, refused: { address: place.address, why: "offline" } });
  veil.opening({ stage: "reading", root: facts.repository.name });
  // The chosen card rises into the wait screen's sheet before the land arrives.
  await new Promise((resolve) => setTimeout(resolve, CHOSEN_MS));
}

/** Opens a codebase's world, judged, laid out and ready to bake. */
export async function codeWorld(veil: Veil): Promise<OpenedWorld> {
  const service = worldService();
  let document: WorldDocument;
  // Where the person stood when they last left this world. Only the world service keeps it.
  let stood: StoodSpot | undefined;
  let landed = false;
  const watched: Veil = { ...veil, opening: (o) => ((landed ||= o.stage === "land"), veil.opening(o)) };
  // If the world cannot open, the wait screen shows why and stays. Nothing else replaces it.
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
  // Trace the outlines once now, while the world loads, so the field map never traces them mid-walk.
  const outlines = outlinesOf(document.world);
  // A world laid out here, with no world service, shows its land only now.
  if (!landed) veil.opening({ stage: "land", name: document.world.name, size: document.world.size, ...(document.world.aspect === undefined ? {} : { aspect: document.world.aspect }), areas: outlines.areas, patches: document.world.patches, lots: document.world.things.map(({ x, z }) => ({ x, z })) });
  veil.baking(Object.fromEntries(document.world.patches.map((p) => [p.path, p.vitality])));
  return stood === undefined ? openedWorld(document) : { ...openedWorld(document), stood };
}

/** A trail's route spec, built from its link blueprint. A trail without a composed route is an error, never a default. */
function routeOf(trail: { readonly from: string; readonly to: string; readonly route?: Blueprint }): RouteSpec {
  if (trail.route === undefined) throw new Error(`The trail from ${trail.from || "the root"} to ${trail.to || "the root"} has no route: Jev composes every trail's.`);
  return buildSlots(trail.route, link, COMPOSING.lib, { seed: 1, facts: {} }).get("route")?.output as RouteSpec;
}

/** What one of the stand's symbols represents: its page, its file, which an entity lacks, and its form. */
export interface StandingOf {
  readonly represented: Represented;
  readonly file?: string;
  readonly form: string;
}

/** The page of a file or entity that appears as a plant, stone or flowers of its own. */
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

/** The facts a building or landmark is built from, and its page, for whatever it represents. */
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
  // A world without a composed sky or land is an error, never a default.
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
  // What each of the stand's symbols represents: every definition, then each file and entity that appears as a plant, stone or flowers.
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
  // Every distinct blueprint of each group, in the order the stand's symbols first use it. Two things with the same blueprint share one entry.
  const plants: Record<PlantGroup, Blueprint[]> = { trees: [], rocks: [], shrubs: [], flowers: [], mushrooms: [] };
  const variantOf = (group: PlantGroup, blueprint: Blueprint): number => {
    const builds = plants[group];
    const k = builds.findIndex((b) => b.id === blueprint.id);
    return k >= 0 ? k : builds.push(blueprint) - 1;
  };
  const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
  type Small = { readonly x: number; readonly z: number; readonly form: string; readonly as?: FormKind; readonly blueprint?: Blueprint; readonly lines: number; readonly importance?: number; readonly vitality: number; readonly file?: string };
  const symbol = (s: Small, who: string): StandCode["symbols"][number] => {
    // A definition that appears as a building or landmark is one of the world's things and is placed with them.
    if (COMPOSED_FORMS[s.form] !== undefined) return { x: s.x, z: s.z, rule: AS_THING, variant: 0, radius: 0, scale: 0, vitality: s.vitality };
    // Every thing uses the blueprint Jev composed for it. One without a blueprint is an error, never a default form.
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
      // An entity that appears as a plant, stone or flowers. Its trails end at its lot's center.
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
