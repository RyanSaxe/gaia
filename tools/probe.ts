// Measures the world as a person sees it, in the app's own Chromium (an
// Electron window drawing on the GPU), through the lab's hooks
// (`window.__lab`), so every session measures its branch the same way. The
// tests:
//
// - drawn: each spot's frame time, and its draw calls and triangles by kind
//   and pass (the sun's shadow, the water's mirror and the view).
// - steps: the walk test. It walks toward the woods with the wind's clock
//   frozen and measures what each step changes in the detail drawn, against
//   the wind's own change over half a second. A step above the wind, and
//   enough to see (`POP_FLOOR`), is a pop, and any pop fails the run.
// - hitch: the app's smoothness probe over a real walk.
// - swap: the swap test. For every preset with a far form (trees, bushes,
//   rocks and drifts of flowers) at vitality 1, 0.5 and 0.15, by day and at
//   22:00, it steps through the change of form: the far form fading in over
//   the full one, drawing whole, the full form dissolving under it, the frame
//   where the full form disappears and the far form is alone, and then, too
//   small to see, the far form dissolving and gone. It compares each step with
//   the wind's half-second change there, and a step above it that shows
//   (`SWAP_FLOOR`) is a pop, which fails the run.
// - stress: the proving ground as it is, then with every tree that represents
//   code placed five times on its own patch.
// - paint: the painter check. Standing still in the showcase with the wind's
//   clock frozen, the person's view must not change at all while the
//   journal's painter paints the farthest things, nor over 30 s while the
//   app's own painter works, as it does whenever the person stops. It also
//   counts the page's late frames while the journal's painter paints.
//
// Every run starts from its own browser profile, so the far forms bake as on
// a first visit, and any WebGL error the page reports fails it
// (`webglErrors`).
//
// The window stays hidden, at exactly the size asked for, except for the
// smoothness walk. A hidden window's frames don't keep the display's pace, so
// the window shows then, without taking focus, and must stay uncovered.
// Timings are only worth comparing from a quiet machine, because other work on
// the GPU or CPU makes them noisy, so the probe prints the load average it ran
// at.
// Usage: pnpm probe [drawn] [steps] [hitch] [stress] [swap] [paint] [--world showcase|proving]
//          [--spot NAME] [--dpr 1|2] [--json FILE]
// A spot is "valley", "turned" or a tour stop (`__lab.terrain.tour()` lists
// them, such as "ruined bridge"). --world and --spot may repeat.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { webglErrors } from "../app/main/webgl-errors.ts";
import { LAB_BUILD, labBundle, labPage } from "./lab-page.ts";

const MEASURES = ["drawn", "steps", "hitch", "stress", "swap", "paint"] as const;
type Measure = (typeof MEASURES)[number];

/** Where each world is measured: by the stream at the valley, turned 120° from it, and the proving ground's woods. */
const SPOTS = {
  showcase: ["valley", "turned"],
  proving: ["valley", "thriving grove", "large area"],
} as const;
/** How far the walk test walks from each spot in meters, its step of half a second at walking pace, and the wind's time, so every run has the same wind. */
const WALK = { meters: 150, step: 0.7, at: 100 };
/**
 * The smallest change, in 8-bit levels, a step's worst block must make to
 * count as a pop. Below it, as in a view of open water and short grass where
 * the wind itself moves almost nothing, a step only shifts the grain of edges.
 */
const POP_FLOOR = 8;
/**
 * A swap step that changes no block by a full level of 255 shows nothing,
 * however still the air around it, as when a far bush swaps where nothing else
 * in its part of the screen moves. Above it, a step must stay under the wind's
 * change.
 */
const SWAP_FLOOR = 1;
/** Seconds of walking per smoothness window. The app's probe reads the last ten seconds. */
const HITCH_WINDOWS = 2;
/** The window's size in CSS pixels. */
const WIDTH = 1280;
const HEIGHT = 800;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { dpr: { type: "string", default: "2" }, json: { type: "string" }, world: { type: "string", multiple: true }, spot: { type: "string", multiple: true } },
});
const asked = positionals.length === 0 ? [...MEASURES] : positionals;
for (const m of asked) if (!(MEASURES as readonly string[]).includes(m)) throw new Error(`No measure named ${m}; choose from ${MEASURES.join(", ")}.`);
const measures = new Set(asked as Measure[]);
for (const w of values.world ?? []) if (!(w in SPOTS)) throw new Error(`No world named ${w}; choose from ${Object.keys(SPOTS).join(", ")}.`);
const dpr = Number(values.dpr);

/** One page load: the world to open, then each call's JavaScript, run in order with `T` as `__lab.terrain`. */
interface Job {
  readonly world: string;
  readonly calls: readonly Call[];
}
/** `shown` calls run with the window on screen, where frames keep the display's pace. */
interface Call {
  readonly key: string;
  readonly js: string;
  readonly shown?: boolean;
}

const go = (spot: string): string =>
  spot === "valley"
    ? "T.valley()"
    : spot === "turned"
      ? "(T.valley(), T.walk(T.walker().x, T.walker().z, T.walker().yawDeg + 120, -3))"
      : `(T.tour(${JSON.stringify(spot)}) ?? (() => { throw new Error(${JSON.stringify(`No tour stop named ${spot}.`)}); })())`;
/** Opens the world at 15:30, waits for the bushes' far forms, which bake once it is open, and reports its trees. */
const OPEN = `(await __lab.open("immersive"), await T.farReady(), await __lab.hour(15.5), await __lab.frames(30), T.scale())`;
const settle = "await __lab.frames(40)";
const bench = "(T.bench(10), +T.bench(40).toFixed(2))";

const jobs: Job[] = [];
for (const [world, preset] of Object.entries(SPOTS)) {
  if (values.world !== undefined && !values.world.includes(world)) continue;
  const spots = values.spot ?? preset;
  const calls: Call[] = [{ key: "open", js: OPEN }];
  for (const spot of spots) {
    if (measures.has("drawn")) calls.push({ key: `drawn ${spot}`, js: `(${go(spot)}, ${settle}, { ms: ${bench}, drawn: T.drawn(), woods: T.scale(), understory: T.understoryDrawn() })` });
    if (measures.has("steps")) calls.push({ key: `steps ${spot}`, js: `(${go(spot)}, ${settle}, T.steps(${WALK.meters}, ${WALK.step}, ${WALK.at}))` });
  }
  if (measures.has("hitch")) {
    for (let w = 0; w < HITCH_WINDOWS; w++) calls.push({ key: `hitch ${w}`, shown: true, js: `(${w === 0 ? `${go("valley")}, await __lab.frames(60), ` : ""}await T.wander(10), __lab.smoothness())` });
  }
  if (calls.length > 1) jobs.push({ world, calls });
}
if (measures.has("swap")) {
  const calls: Call[] = [{ key: "open", js: OPEN }];
  for (const hour of [15.5, 22]) {
    // Each preset's far form is brought into a slot for its test, so each test waits for it.
    calls.push({ key: `swap ${hour}`, js: `(await __lab.hour(${hour}), ${go("valley")}, ${settle}, await (async () => { const rows = []; for (const name of T.swap()) for (const vitality of [1, 0.5, 0.15]) rows.push({ name, vitality, ...(await T.swap(name, vitality)) }); return rows; })())` });
  }
  // The showcase unless worlds are named.
  for (const world of values.world ?? ["showcase"]) jobs.push({ world, calls });
}
if (measures.has("paint")) {
  // Looking at the view draws frames of its own, so the check counts the page's frames again over paintings made
  // without looking.
  jobs.push({ world: "showcase", calls: [{ key: "open", js: OPEN }, { key: "paint", js: `(${go("valley")}, ${settle}, { painter: await T.paintCheck(6), idle: await T.standCheck(30) })` }, { key: "paint unwatched", js: `(${go("turned")}, ${settle}, await T.paintCheck(6, false))` }, { key: "paint unwatched near", js: `(${go("turned")}, ${settle}, await T.paintCheck(6, false, true))` }] });
}
if (measures.has("stress") && (values.world === undefined || values.world.includes("proving"))) {
  // The proving ground as it is, then with every tree that represents code placed five times.
  const measure = `${go("valley")}, ${settle}, { trees: T.scale().trees, ms: ${bench}, drawn: T.drawn() }`;
  jobs.push({
    world: "proving",
    calls: [
      { key: "open", js: OPEN },
      { key: "stress 1x", js: `(${measure})` },
      { key: "stress 5x", js: `(await T.forest(5), ${measure})` },
    ],
  });
}

const repo = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "gaia-probe-"));
const page = join(scratch, "lab.html");
const out = join(scratch, "out.json");
// The run's own browser profile, so the far forms bake as on a first visit.
const profile = join(scratch, "profile");
writeFileSync(page, labPage(labBundle(await build(LAB_BUILD))));

// Electron runs this as its main process: each job opens the lab on its world and runs its calls.
const main = join(scratch, "main.mjs");
writeFileSync(
  main,
  `import { app, BrowserWindow, powerSaveBlocker } from "electron";
import { writeFileSync } from "node:fs";
const { page, out, profile, jobs, width, height, dpr } = JSON.parse(process.env.GAIA_PROBE);
app.setPath("userData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", String(dpr));
app.commandLine.appendSwitch("ignore-gpu-blocklist");
// A window without focus belongs to a background app, which macOS would slow (App Nap).
app.commandLine.appendSwitch("disable-renderer-backgrounding");
// A covered window keeps drawing, so a probe never waits on frames that don't come.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
const say = (line) => console.error("probe: " + line);
async function probe() {
  powerSaveBlocker.start("prevent-app-suspension");
  const results = {};
  // The page's warnings and errors over the whole run, among them any WebGL error.
  const messages = [];
  // One window for every job: a second window's page fails to load once the first is closed.
  // A tiling window manager leaves a window of fixed size floating at the size asked for.
  const fixed = { resizable: false, fullscreenable: false, minimizable: false, maximizable: false };
  const win = new BrowserWindow({ ...fixed, show: false, width, height, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  // The world makes sound; a scripted window plays none of it aloud.
  win.webContents.setAudioMuted(true);
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") say("page: " + e.message);
    if (e.level === "warning" || e.level === "error") messages.push(e.message);
  });
  for (const job of jobs) {
    await win.loadFile(page, { query: { world: job.world } });
    const run = (js) => win.webContents.executeJavaScript("(async () => { const T = window.__lab.terrain; return " + js + "; })()");
    await win.webContents.executeJavaScript("new Promise((r) => { const t = () => (window.__lab ? r() : setTimeout(t, 50)); t(); })");
    const view = await win.webContents.executeJavaScript("[innerWidth, innerHeight]");
    if (view[0] !== width || view[1] !== height) throw new Error("The window is " + view.join("x") + ", not " + width + "x" + height + ": something resized it.");
    // The screen's own ratio wins over the one asked for, so the report says which the world drew at.
    // A world measured by several jobs, as the showcase is by the walks and the swap test, keeps every job's results.
    results[job.world] = { ...(results[job.world] ?? {}), ratio: await win.webContents.executeJavaScript("devicePixelRatio") };
    for (const call of job.calls) {
      say(job.world + ": " + call.key);
      // Shown without taking focus, while the smoothness walk runs.
      if (call.shown && !win.isVisible()) win.showInactive();
      if (!call.shown && win.isVisible()) win.hide();
      results[job.world][call.key] = await run(call.js);
    }
  }
  // What drew the world, since a machine without a GPU draws WebGL in software, many times slower.
  const gpu = await win.webContents.executeJavaScript('(() => { const gl = document.createElement("canvas").getContext("webgl2"); const info = gl?.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "an unknown renderer"; })()');
  writeFileSync(out, JSON.stringify({ results, messages, gpu }));
}
app.whenReady().then(probe).then(
  () => app.quit(),
  (error) => {
    say(String(error));
    app.exit(1);
  },
);
`,
);

const load = loadavg()[0] ?? 0;
const electron = createRequire(resolve(repo, "app/package.json"))("electron") as string;
const env: NodeJS.ProcessEnv = { ...process.env, GAIA_PROBE: JSON.stringify({ page, out, profile, jobs, width: WIDTH, height: HEIGHT, dpr }) };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(electron, [main], { env, stdio: ["ignore", "inherit", "inherit"] });
const probed = run.status === 0 ? (JSON.parse(readFileSync(out, "utf8")) as { results: Record<string, Record<string, unknown>>; messages: string[]; gpu: string }) : null;
rmSync(scratch, { recursive: true, force: true });
if (probed === null) throw new Error(`Electron exited with ${run.status ?? run.signal}`);
const { results } = probed;
if (values.json !== undefined) writeFileSync(values.json, JSON.stringify({ dpr, load: [load, loadavg()[0]], results }, null, 1));

// ---------- the report ----------

type Tally = Record<"shadow" | "mirror" | "view", Record<string, { calls: number; triangles: number }>>;
/** A set of far forms as `__lab.terrain.scale()` reports it. */
type FarCardsReport = { slots: number; forms: number; held: number; mb: number; farCopies: number; carded: number; read: number; baked: number };
const m = (n: number): string => (n / 1e6).toFixed(2);
const f = (n: number, d = 1): string => n.toFixed(d);
const line = (s: string): void => void process.stdout.write(`${s}\n`);

const ratios = [...new Set(Object.values(results).map((calls) => (calls as { ratio?: number }).ratio).filter((r): r is number => r !== undefined))];
const drewAt = ratios.length === 0 ? `${dpr}` : ratios.join(" and ");
line(`Probe at ${WIDTH}x${HEIGHT} CSS pixels, device pixel ratio ${drewAt}${ratios.some((r) => r !== dpr) ? ` (asked for ${dpr}; Electron draws at the screen's own ratio, so compare runs only on the same screen)` : ""}; drawn by ${probed.gpu}; load average ${f(load)} before, ${f(loadavg()[0] ?? 0)} after.`);
for (const [world, calls] of Object.entries(results)) {
  line(`\n${world}`);
  for (const [key, value] of Object.entries(calls)) {
    if (key.startsWith("drawn ") || key.startsWith("stress ")) {
      const { ms, drawn, trees, woods, understory } = value as { ms: number; drawn: Tally; trees?: number; woods?: { treesDrawn: number; treesInBand: number; treesFar: number; swapPx: number; treeCards?: FarCardsReport; bushCards?: FarCardsReport }; understory?: Record<string, { copies: number; triangles: number }> };
      const kinds = [...new Set(Object.values(drawn).flatMap((p) => Object.keys(p)))].sort((a, b) => (drawn.view[b]?.triangles ?? 0) - (drawn.view[a]?.triangles ?? 0));
      const sum = (pass: keyof Tally, k: "calls" | "triangles"): number => Object.values(drawn[pass]).reduce((n, d) => n + d[k], 0);
      line(`  ${key}${trees === undefined ? "" : ` (${trees} trees)`}: ${f(ms, 2)} ms a frame; triangles (millions) and draw calls, view / mirror / shadow:`);
      line(`    all          ${m(sum("view", "triangles"))} / ${m(sum("mirror", "triangles"))} / ${m(sum("shadow", "triangles"))}   calls ${sum("view", "calls")} / ${sum("mirror", "calls")} / ${sum("shadow", "calls")}`);
      for (const k of kinds) {
        const at = (pass: keyof Tally) => drawn[pass][k] ?? { calls: 0, triangles: 0 };
        line(`    ${k.padEnd(12)} ${m(at("view").triangles)} / ${m(at("mirror").triangles)} / ${m(at("shadow").triangles)}   calls ${at("view").calls} / ${at("mirror").calls} / ${at("shadow").calls}`);
      }
      if (woods !== undefined) line(`    trees in view: ${woods.treesDrawn - woods.treesInBand} full, ${woods.treesInBand} in the band, ${woods.treesFar} far; turning far at ${woods.swapPx} px`);
      for (const [set, c] of [["trees", woods?.treeCards], ["understory", woods?.bushCards]] as const) {
        if (c !== undefined) line(`    far ${set}: ${c.held} of ${c.forms} forms in ${c.slots} slots (${c.mb} MB); ${c.carded} of ${c.farCopies} far copies as cards; ${c.read} read, ${c.baked} baked`);
      }
      if (understory !== undefined) {
        const kinds = Object.entries(understory).sort(([, a], [, b]) => b.triangles - a.triangles);
        line(`    understory in view, by kind: ${kinds.map(([k, d]) => `${k} ${m(d.triangles)}M (${d.copies})`).join(", ")}`);
      }
    } else if (key.startsWith("steps ")) {
      // Each step: [meters walked, mean change, worst block's change]. A step above the walk's typical wind, and visible, is a pop.
      const { steps, wind } = value as { steps: [number, number, number][]; wind: number[] };
      const typical = [...wind].sort((a, b) => a - b)[Math.floor(wind.length / 2)] ?? 0;
      const bar = Math.max(typical, POP_FLOOR);
      const worst = steps.reduce((a, b) => (b[2] > a[2] ? b : a));
      const pops = steps.filter((s) => s[2] > bar);
      // A walk where neither the steps nor the wind changed a pixel never drew its frames, as on an overloaded machine, so it proves nothing.
      if (typical === 0 && worst[2] === 0) {
        line(`  ${key}: no frame changed, not even with the wind, so the walk measured nothing; run it again`);
        process.exitCode = 1;
        continue;
      }
      line(`  ${key}: ${steps.length} steps; worst block ${f(worst[2])} at ${f(worst[0], 0)} m; the wind's ${f(typical)} (its median along the walk); ${pops.length} pops${pops.length > 0 ? ` (at ${pops.map((s) => f(s[0], 0)).join(", ")} m)` : ""}`);
      if (pops.length > 0) process.exitCode = 1;
    } else if (key === "paint unwatched" || key === "paint unwatched near") {
      const { painted, intervals } = value as { painted: string[]; intervals: number[] };
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const late = intervals.filter((t) => t > median * 1.5 + 4);
      line(`  ${key}: ${painted.length} ${key.endsWith("near") ? "near" : "far"} paintings; frames ${intervals.length}, median ${f(median)} ms, ${late.length} late (${late.map((t) => f(t, 0)).join(", ")} ms)`);
    } else if (key === "paint") {
      // Any change at all to the person's view while either painter paints fails, because nothing there moved.
      const { painter, idle } = value as { painter: { painted: string[]; worst: number; checks: number; intervals: number[] }; idle: { worst: number; looks: [number, number, string][] } };
      const worst = Math.max(painter.worst, idle.worst);
      const sorted = [...painter.intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const late = painter.intervals.filter((t) => t > median * 1.5 + 4);
      line(`  paint: ${painter.painted.length} far paintings with ${painter.checks} looks at the person's view, then ${idle.looks.length} looks over 30 s still with the app's painter at work; worst block changed ${f(worst, 2)} levels${worst >= SWAP_FLOOR ? " (it must not change)" : ""}`);
      line(`    frames while painting: ${painter.intervals.length}, median ${f(median)} ms, ${late.length} late (worst ${f(Math.max(0, ...painter.intervals))} ms)`);
      if (worst >= SWAP_FLOOR) process.exitCode = 1;
    } else if (key.startsWith("swap ")) {
      // A step passes when it changes the plant's part of the screen no more than the wind does there in half a second, or too little to show.
      type Step = { change: { mean: number; worst: number }; wind: { mean: number; worst: number }; distance: number };
      const STEPS = ["middle", "whole", "leaving", "end", "dissolving", "gone"] as const;
      const rows = value as ({ name: string; vitality: number } & Record<(typeof STEPS)[number], Step>)[];
      const over = (s: Step): boolean => s.change.worst > SWAP_FLOOR && (s.change.worst > s.wind.worst || s.change.mean > s.wind.mean);
      const failing = (r: (typeof rows)[number]): boolean => STEPS.some((k) => over(r[k]));
      const failed = rows.filter(failing);
      // A test where the wind moved no plant at any step never saw one, so it proves nothing.
      if (!rows.some((r) => STEPS.some((k) => r[k].wind.worst > 0))) {
        line(`  ${key}: the wind moved no plant at any step, so the test saw none and proves nothing`);
        process.exitCode = 1;
        continue;
      }
      line(`  ${key}: ${rows.length - failed.length} of ${rows.length} presets and healths under the wind or a level (mean / worst block over the plant, the step against the wind)`);
      if (failed.length > 0) process.exitCode = 1;
      const say = (s: Step): string => `${f(s.change.mean, 2)} / ${f(s.change.worst)} against ${f(s.wind.mean, 2)} / ${f(s.wind.worst)}`;
      for (const r of rows) {
        line(`    ${failing(r) ? "over " : "     "} ${r.name.padEnd(16)} ${f(r.vitality, 2)}  middle of the band ${say(r.middle)} at ${f(r.middle.distance, 0)} m; whole ${say(r.whole)}`);
        line(`                            dissolving ${say(r.leaving)}; the full form leaving ${say(r.end)} at ${f(r.end.distance, 0)} m`);
        line(`                            too small: dissolving ${say(r.dissolving)}; gone ${say(r.gone)} at ${f(r.gone.distance, 0)} m`);
      }
    } else if (key.startsWith("hitch ")) {
      const s = value as { medianMs: number; p99Ms: number; maxMs: number; stutters: number };
      line(`  ${key}: median ${f(s.medianMs, 2)} ms, p99 ${f(s.p99Ms, 1)}, max ${f(s.maxMs, 1)}, ${s.stutters} stutters`);
    }
  }
}

const errors = webglErrors();
for (const message of probed.messages) errors.note(message);
line(`\n${errors.summary()}`);
if (errors.count() > 0) process.exitCode = 1;
