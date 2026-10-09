// "This codebase": a codebase's world. Inside the app it comes from the world
// service, which opens the folder main names (Gaia's own repository unless
// the person opens another), has Jev or the stand-in judge it, and lays it
// out; while that happens the wait paints the land as it is judged
// (app/renderer/wait/), and asks the person only before spending past their
// limit. A standalone page (the
// offline HTML, `pnpm lab:serve`) has no engine: it lays out the engine's
// snapshot of this repository (`fixtures/gaia.json`, written by `pnpm
// snapshot`), judged by Jev's answers kept for it (`fixtures/gaia-jev.json`,
// written by `pnpm jev-world`), or by the stand-in with `?judge=stand-in` and
// wherever no kept answer fits. Everything else follows from the code:
// each directory's area and land, each file's patch and what grows on it,
// each entity's building or landmark on its lot, and the trails between them.

import { type Blueprint, type CodeModel, type EntityFacts, type FileFacts, type JevResponse, type SymbolFact, rand, seedOf } from "@gaia/schema";
import { FLORA_PRESETS, LANDMARK_PRESETS, TRAIL_PRESETS, WORLD_PRESETS } from "@gaia/realize";
import { type WorldSpec, outlinesOf } from "@gaia/terrain";
import { type CodeWorld, type Judge, type Judgments, judgeWorld, judgedThing, keptJev, layoutWorld, planWorldRequests, requestKey, standInJev, thingsOf } from "@gaia/world";
import type { ConsentPlan, Opening, StartChoice, StartOffer, WorldDocument } from "../../world-service/protocol.ts";
import { postcardOf } from "../../world-service/postcard.ts";
import { type WorldService, worldService } from "../service.ts";
import snapshot from "./fixtures/gaia.json";
import kept from "./fixtures/gaia-jev.json";
import proving from "./fixtures/proving.json";
import provingJudged from "./fixtures/proving-judged.json";
import { CHARACTERS, type Character, FORMS, LANDS, LOOKS } from "./looks.ts";
import type { Represented, SampleEntity } from "./samples.ts";
import { type CodePatch, type FileJudged, vitalityOf } from "@gaia/world";
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
  /** The entities buildings stand for, each with the building Jev chose, in the order the stand sites them. */
  readonly buildings: readonly SampleEntity[];
  /** The entities landmarks stand for: which landmark preset and its facts. */
  readonly landmarks: readonly { readonly preset: number; readonly facts: EntityFacts }[];
  /** The world preset whose light, sky and air the world takes. */
  readonly sky: (typeof WORLD_PRESETS)[number] | undefined;
  /** What the bake thread needs to stand this world's things, given the request's trail styles. */
  readonly stand: StandCode;
  /** Who judged a thing, by `judgedThing` ("file:src/main.ts", "entity:packages/world"). */
  readonly judgeOf: (thing: string) => Judge;
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

/** What Jev judged about a patch's file that its vitality reads. */
export const judgedOf = (patch: CodePatch | undefined): FileJudged => (patch?.needsTests === undefined ? {} : { needsTests: patch.needsTests });

const KIND_NAMES: Readonly<Record<SymbolFact["kind"], string>> = { function: "Function", class: "Class", type: "Type", constant: "Constant", module: "Module" };
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { typescript: "TypeScript", javascript: "JavaScript", rust: "Rust" };

/** What a card says about a file's finer entity: its name, kind, doc comment, where it is declared and its file's health. */
export function representSymbol(s: CodeWorld["symbols"][number], file: FileFacts, judged: FileJudged = {}): Represented {
  return {
    id: s.id,
    name: s.name,
    what: [KIND_NAMES[s.kind], s.exported ? "exported" : "inside its file", LANGUAGE_NAMES[file.language] ?? file.language].join(" · "),
    doc: s.doc ?? "",
    where: `${s.file}:${s.line}`,
    size: `${s.lines.toLocaleString()} ${s.lines === 1 ? "line" : "lines"} of ${file.lines.toLocaleString()} in its file`,
    dependsOn: [],
    dependents: [],
    report: vitalityOf(file, [], judged),
  };
}

/** A symbol's size where it stands: larger for a longer one, within what its blueprint looks right at. */
export const symbolScale = (lines: SymbolFact["lines"], rule: string): number => {
  const t = Math.min(1, Math.log2(1 + (lines ?? 1)) / 8);
  return rule === "rocks" ? 0.45 + 0.75 * t : rule === "shrubs" ? 0.6 + 0.6 * t : 0.8 + 0.4 * t;
};

/** Trees on a file's patch, as its area's character grows them: more for a longer file, at least the one that names it. */
export const treesFor = (lines: number, character: Character): number => Math.min(48, Math.max(1, Math.round(lines * character.perLine)));

/** The most trees a world grows: where its areas would grow more, every grove gives up the same share. */
const TREE_BUDGET = 470;

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
 * Gaia's own world from the bundled snapshot: the world of a page with no
 * engine. Jev's answers kept for the snapshot judge it, as the app's store
 * would; the stand-in judges whatever they do not answer, such as a request
 * whose questions or options changed since Jev was asked.
 */
async function snapshotWorld(why: string): Promise<WorldDocument> {
  const model = snapshot as unknown as CodeModel;
  const stored = new Map(SNAPSHOT_JUDGE === "jev" ? Object.entries((kept as { answers: Record<string, JevResponse> }).answers) : []);
  const byKey = new Map<string, Judge>();
  const jev = keptJev(null, standInJev(LOOKS), { stored, keep: () => undefined, settled: (key, judge) => byKey.set(key, judge) });
  const world = layoutWorld(model, await judgeWorld(model, LOOKS, jev));
  const judges = Object.fromEntries(planWorldRequests(model, LOOKS).flatMap((p) => thingsOf(p).map((t) => [judgedThing(t), byKey.get(requestKey(p.request)) ?? "stand-in"] as const)));
  const byJev = Object.values(judges).filter((j) => j === "jev").length;
  const summary = byJev === 0 ? `Every thing judged by the stand-in (${why})` : `${byJev} of ${Object.keys(judges).length} things judged by Jev, from answers kept for this snapshot (${why})`;
  return { root: model.repository.name, model, world, judges, summary };
}

/**
 * The proving ground (`?world=proving`): a made-up codebase with every
 * feature a world can show, from thriving to ruin, laid out from the choices
 * fixed for it (`fixtures/proving.json` and `proving-judged.json`, written by
 * `pnpm proving`). It is laid out, stood and baked like any codebase's world.
 */
export function provingWorld(): WorldDocument {
  const model = proving as unknown as CodeModel;
  const world = layoutWorld(model, provingJudged as unknown as Judgments);
  return { root: model.repository.name, model, world, judges: {}, summary: "The proving ground: every choice fixed so each feature shows" };
}

/** Whether the page asks for the proving ground (`?world=proving`), which opens with or without an engine. */
const ASKS_PROVING = typeof location !== "undefined" && new URLSearchParams(location.search).get("world") === "proving";

/**
 * The start on a page with no engine, to see it (`?start=table|signpost`):
 * Gaia's own world is the one world walked before, and any choice opens it,
 * except an address, which a page with no engine cannot follow.
 */
async function previewStart(veil: Veil): Promise<void> {
  const model = snapshot as unknown as CodeModel;
  const world = layoutWorld(model, await judgeWorld(model, LOOKS, standInJev(LOOKS)));
  const recent = [{ root: model.repository.name, name: model.repository.name, at: Date.now(), postcard: postcardOf(world) }];
  let place = await veil.choose({ recent });
  while ("address" in place) place = await veil.choose({ recent, refused: { address: place.address, why: "offline" } });
  veil.opening({ stage: "reading", root: model.repository.name });
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
  if (!landed) veil.opening({ stage: "land", name: document.world.name, size: document.world.size, areas: outlines.areas, patches: document.world.patches });
  veil.baking(Object.fromEntries(document.world.patches.map((p) => [p.path, p.vitality])));
  return codeLab(document);
}

/**
 * Each file's patch as one grove, as its area's character grows it: in a
 * deep wood or a wet hollow every file's grove gathers on the side of its
 * patch nearest its area's heart, so an area's groves knit into one wood with
 * open ground at its rim; elsewhere each grove keeps to its patch's middle,
 * with clearings between. A longer file grows more trees, set a little
 * closer; a file that describes or configures grows none.
 */
function patchesOf(world: CodeWorld): StandCode["patches"] {
  const fallback = CHARACTERS["Groves and clearings"] as Character;
  const areas = new Map(world.areas.map((a) => [a.path, a]));
  const cellsOf = new Map<string, { x: number; z: number }[]>();
  for (const c of world.cells) if (c.file !== null && c.file !== undefined) cellsOf.set(c.file, [...(cellsOf.get(c.file) ?? []), c]);
  const planned = world.patches.map((p) => {
    const area = areas.get(p.area);
    const character = CHARACTERS[world.regions[area?.region ?? 0]?.character ?? ""] ?? fallback;
    const preset = FLORA_PRESETS.findIndex((f) => f.name === p.vibe);
    // The patch's cell nearest its area's heart, where a wood gathers.
    const toward = area === undefined ? p : (cellsOf.get(p.path) ?? [p]).reduce((b, c) => (Math.hypot(c.x - area.x, c.z - area.z) < Math.hypot(b.x - area.x, b.z - area.z) ? c : b), p as { x: number; z: number });
    const heart = character.knit ? { x: toward.x, z: toward.z } : { x: p.x, z: p.z };
    const big = Math.min(1, Math.max(0, Math.log2(p.lines / 50) / 5));
    return {
      x: p.x,
      z: p.z,
      radius: p.radius,
      preset,
      trees: preset < 0 ? 0 : treesFor(p.lines, character),
      heart,
      closeness: character.closeness * (1.1 - 0.25 * big),
      reach: p.radius * (character.knit ? 1.7 : 0.75),
      stature: character.stature,
      seed: seedOf(`grove:${p.path}`),
    };
  });
  const wanted = planned.reduce((n, p) => n + p.trees, 0);
  const share = Math.min(1, TREE_BUDGET / Math.max(1, wanted));
  return planned.map((p) => (p.trees === 0 ? p : { ...p, trees: Math.max(1, Math.round(p.trees * share)) }));
}

/** Everything the terrain lab needs to bake and furnish a world document. */
export function codeLab({ model, world, judges, summary }: WorldDocument): CodeLab {
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
      biome: withWater(LANDS[r.land]?.biome ?? fallback, r.water),
    })),
  };
  const entities = new Map(model.entities.map((e) => [e.path, e]));
  const lot = (t: CodeWorld["things"][number]): StandLot => ({ id: t.path, x: t.x, z: t.z, radius: t.lot * 0.6 });
  const houses = world.things.filter((t) => t.as === "building");
  const rises = world.things.filter((t) => t.as === "landmark");
  const landmarkIndex = (name: string): number => Math.max(0, LANDMARK_PRESETS.findIndex((p) => p.name === name));
  return {
    world,
    spec,
    files: new Map(model.files.map((f) => [f.path, f])),
    buildings: houses.map((t) => ({ facts: entities.get(t.path) as EntityFacts, building: t.look })),
    landmarks: rises.map((t) => ({ preset: landmarkIndex(t.look), facts: entities.get(t.path) as EntityFacts })),
    sky: WORLD_PRESETS.find((p) => p.name === world.world) ?? WORLD_PRESETS[0],
    stand: {
      lots: houses.map(lot),
      landmarks: rises.map((t) => ({ landmark: landmarkIndex(t.look), lot: lot(t) })),
      patches: patchesOf(world),
      regions: world.regions.map((r) => {
        const c = CHARACTERS[r.character];
        return { understory: c?.understory ?? {}, ...(c?.open === undefined ? {} : { open: c.open }) };
      }),
      cells: (() => {
        const patchOf = new Map(world.patches.map((p, i) => [p.path, i]));
        const areaOf = new Map(world.areas.map((a, i) => [a.path, i]));
        return world.cells.map((c) => ({ x: c.x, z: c.z, patch: c.file === null || c.file === undefined ? -1 : (patchOf.get(c.file) ?? -1), area: areaOf.get(c.area) ?? 0 }));
      })(),
      symbols: world.symbols.map((s) => {
        const form = FORMS[s.form] ?? (Object.values(FORMS)[0] as (typeof FORMS)[string]);
        const variant = form.preset;
        return { x: s.x, z: s.z, rule: form.rule, variant, radius: form.rule === "flowers" ? 0.8 : 1, scale: symbolScale(s.lines, form.rule), vitality: s.vitality };
      }),
      // Trails joining parts of the code no other trail joins route first, then the most wanted.
      trails: world.trails.map((t) => ({ from: t.from, to: t.to, want: (t.spans === true ? 1 : 0) + t.want, style: Math.max(0, TRAIL_PRESETS.findIndex((p) => p.name === t.look)) })),
    },
    judgeOf: (thing) => judges[thing] ?? "stand-in",
    summary,
  };
}
