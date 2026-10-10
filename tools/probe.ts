// Measures the world as a person sees it, in the app's own Chromium (an
// Electron window drawing on the GPU), through the lab's hooks
// (`window.__lab`), so every session measures its branch the same way:
//
// - drawn: each spot's frame time, and its draw calls and triangles by kind
//   and pass (the sun's shadow, the water's mirror and the view).
// - steps: the walk test. Walking toward the woods with the wind's clock
//   frozen, what each step changes in the detail drawn, against the wind's
//   own change over half a second. A step above the wind is a pop.
// - hitch: the app's smoothness probe over a real walk.
// - swap: the swap test. For every tree and bush preset at vitality 1, 0.5
//   and 0.15, by day and at 22:00, the frame where its full form leaves the
//   band and its far form stands alone, against the wind's half-second change.
// - stress: a world with five times the trees.
//
// The window stays hidden, at exactly the size asked for, except for the walk
// that measures smoothness: a hidden window's frames don't keep the display's
// pace, so it shows then, without taking focus; leave it uncovered. Timings
// are only worth comparing from a quiet machine: other work on the GPU or CPU
// makes them noisy, so the probe prints the load average it ran at.
// Usage: pnpm probe [drawn] [steps] [hitch] [stress] [swap] [--world gaia|proving|sample]
//          [--size METERS] [--spot NAME] [--dpr 1|2] [--json FILE]
// The sample world is measured only when asked for, at --size meters across.
// A spot is "valley", "turned" or a tour stop (`__lab.terrain.tour()` lists
// them, such as "ruined bridge"); --world and --spot may repeat.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { LAB_BUILD, labBundle, labPage } from "./lab-page.ts";

const MEASURES = ["drawn", "steps", "hitch", "stress", "swap"] as const;
type Measure = (typeof MEASURES)[number];

/** Where each world is measured: by the stream at the valley, turned 120° from it, and the proving ground's woods. */
const SPOTS = {
  gaia: ["valley", "turned"],
  proving: ["valley", "thriving grove", "large area"],
  sample: ["valley", "turned"],
} as const;
/** How far the walk test walks from each spot, its step (half a second at walking pace), and the wind's moment, so every run sees the same wind. */
const WALK = { meters: 150, step: 0.7, at: 100 };
/**
 * The least change a step's worst block must make to count as a pop, in
 * 8-bit levels: below it, as in a view of open water and short grass where
 * the wind itself moves almost nothing, a step only shifts the grain of edges.
 */
const POP_FLOOR = 8;
/**
 * A swap step that changes no block by a full level of 255 shows nothing,
 * however still the air around it: a far bush turns far where nothing else
 * in its part of the screen moves. Above it, a step must stay under the wind.
 */
const SWAP_FLOOR = 1;
/** Seconds of walking per smoothness window; the app's probe reads the last ten seconds. */
const HITCH_WINDOWS = 2;
/** The window's size in CSS pixels. */
const WIDTH = 1280;
const HEIGHT = 800;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { dpr: { type: "string", default: "2" }, json: { type: "string" }, world: { type: "string", multiple: true }, spot: { type: "string", multiple: true }, size: { type: "string" } },
});
const asked = positionals.length === 0 ? [...MEASURES] : positionals;
for (const m of asked) if (!(MEASURES as readonly string[]).includes(m)) throw new Error(`No measure named ${m}; choose from ${MEASURES.join(", ")}.`);
const measures = new Set(asked as Measure[]);
const dpr = Number(values.dpr);

/** One page load: the world to open, then each call's JavaScript, run in order with `T` as `__lab.terrain`. */
interface Job {
  readonly world: string;
  /** The sample world's size in meters, when asked. */
  readonly size?: string;
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
/** Twenty-one seconds of frames first: as long as the frame budget takes to rise from the far forms' size to its most (woods.ts, `BUDGET`). */
const budgetSettles = "T.bench(1260)";

const jobs: Job[] = [];
for (const [world, preset] of Object.entries(SPOTS)) {
  if (values.world === undefined ? world === "sample" : !values.world.includes(world)) continue;
  const spots = values.spot ?? preset;
  const calls: Call[] = [{ key: "open", js: OPEN }];
  for (const spot of spots) {
    if (measures.has("drawn")) calls.push({ key: `drawn ${spot}`, js: `(${go(spot)}, ${settle}, ${budgetSettles}, { ms: ${bench}, drawn: T.drawn(), woods: T.scale(), understory: T.understoryDrawn() })` });
    if (measures.has("steps")) calls.push({ key: `steps ${spot}`, js: `(${go(spot)}, ${settle}, T.steps(${WALK.meters}, ${WALK.step}, ${WALK.at}))` });
  }
  if (measures.has("hitch")) {
    for (let w = 0; w < HITCH_WINDOWS; w++) calls.push({ key: `hitch ${w}`, shown: true, js: `(${w === 0 ? `${go("valley")}, await __lab.frames(60), ` : ""}await T.wander(10), __lab.smoothness())` });
  }
  if (calls.length > 1) jobs.push({ world, calls, ...(world === "sample" && values.size !== undefined ? { size: values.size } : {}) });
}
if (measures.has("swap")) {
  const calls: Call[] = [{ key: "open", js: OPEN }];
  for (const hour of [15.5, 22]) {
    calls.push({ key: `swap ${hour}`, js: `(await __lab.hour(${hour}), ${go("valley")}, ${settle}, T.swap().flatMap((name) => [1, 0.5, 0.15].map((vitality) => ({ name, vitality, ...T.swap(name, vitality) }))))` });
  }
  jobs.push({ world: "gaia", calls });
}
if (measures.has("stress") && (values.world === undefined || values.world.includes("sample"))) {
  // The sample world, replanted with its usual trees and then five times as many.
  const measure = `${go("valley")}, ${settle}, { trees: T.scale().trees, ms: ${bench}, drawn: T.drawn() }`;
  jobs.push({
    world: "sample",
    calls: [
      { key: "open", js: OPEN },
      { key: "stress 1x", js: `(${measure})` },
      { key: "stress 5x", js: `(await T.forest(5 * T.scale().trees), ${measure})` },
    ],
  });
}

const repo = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "gaia-probe-"));
const page = join(scratch, "lab.html");
const out = join(scratch, "out.json");
writeFileSync(page, labPage(labBundle(await build(LAB_BUILD))));

// Electron runs this as its main process: each job opens the lab on its world and runs its calls.
const main = join(scratch, "main.mjs");
writeFileSync(
  main,
  `import { app, BrowserWindow, powerSaveBlocker } from "electron";
import { writeFileSync } from "node:fs";
const { page, out, jobs, width, height, dpr } = JSON.parse(process.env.GAIA_PROBE);
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
  // One window for every job: a second window's page fails to load once the first is closed.
  // A tiling window manager leaves a window of fixed size floating at the size asked for.
  const fixed = { resizable: false, fullscreenable: false, minimizable: false, maximizable: false };
  const win = new BrowserWindow({ ...fixed, show: false, width, height, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  win.webContents.on("console-message", (e) => { if (e.level === "error") say("page: " + e.message); });
  for (const job of jobs) {
    await win.loadFile(page, { query: { world: job.world, ...(job.size === undefined ? {} : { size: job.size }) } });
    const run = (js) => win.webContents.executeJavaScript("(async () => { const T = window.__lab.terrain; return " + js + "; })()");
    await win.webContents.executeJavaScript("new Promise((r) => { const t = () => (window.__lab ? r() : setTimeout(t, 50)); t(); })");
    const view = await win.webContents.executeJavaScript("[innerWidth, innerHeight]");
    if (view[0] !== width || view[1] !== height) throw new Error("The window is " + view.join("x") + ", not " + width + "x" + height + ": something resized it.");
    results[job.world] = {};
    for (const call of job.calls) {
      say(job.world + ": " + call.key);
      // Shown without taking focus, while the smoothness walk runs.
      if (call.shown && !win.isVisible()) win.showInactive();
      if (!call.shown && win.isVisible()) win.hide();
      results[job.world][call.key] = await run(call.js);
    }
  }
  writeFileSync(out, JSON.stringify(results));
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
const env: NodeJS.ProcessEnv = { ...process.env, GAIA_PROBE: JSON.stringify({ page, out, jobs, width: WIDTH, height: HEIGHT, dpr }) };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(electron, [main], { env, stdio: ["ignore", "inherit", "inherit"] });
if (run.status !== 0) throw new Error(`Electron exited with ${run.status ?? run.signal}`);
const results = JSON.parse(readFileSync(out, "utf8")) as Record<string, Record<string, unknown>>;
rmSync(scratch, { recursive: true, force: true });
if (values.json !== undefined) writeFileSync(values.json, JSON.stringify({ dpr, load: [load, loadavg()[0]], results }, null, 1));

// ---------- the report ----------

type Tally = Record<"shadow" | "mirror" | "view", Record<string, { calls: number; triangles: number }>>;
const m = (n: number): string => (n / 1e6).toFixed(2);
const f = (n: number, d = 1): string => n.toFixed(d);
const line = (s: string): void => void process.stdout.write(`${s}\n`);

line(`Probe at ${WIDTH}x${HEIGHT} CSS pixels, device pixel ratio ${dpr}; load average ${f(load)} before, ${f(loadavg()[0] ?? 0)} after.`);
for (const [world, calls] of Object.entries(results)) {
  line(`\n${world}`);
  for (const [key, value] of Object.entries(calls)) {
    if (key.startsWith("drawn ") || key.startsWith("stress ")) {
      const { ms, drawn, trees, woods, understory } = value as { ms: number; drawn: Tally; trees?: number; woods?: { treesDrawn: number; treesInBand: number; treesFar: number; swapPx: number }; understory?: Record<string, { copies: number; triangles: number }> };
      const kinds = [...new Set(Object.values(drawn).flatMap((p) => Object.keys(p)))].sort((a, b) => (drawn.view[b]?.triangles ?? 0) - (drawn.view[a]?.triangles ?? 0));
      const sum = (pass: keyof Tally, k: "calls" | "triangles"): number => Object.values(drawn[pass]).reduce((n, d) => n + d[k], 0);
      line(`  ${key}${trees === undefined ? "" : ` (${trees} trees)`}: ${f(ms, 2)} ms a frame; triangles (millions) and draw calls, view / mirror / shadow:`);
      line(`    all          ${m(sum("view", "triangles"))} / ${m(sum("mirror", "triangles"))} / ${m(sum("shadow", "triangles"))}   calls ${sum("view", "calls")} / ${sum("mirror", "calls")} / ${sum("shadow", "calls")}`);
      for (const k of kinds) {
        const at = (pass: keyof Tally) => drawn[pass][k] ?? { calls: 0, triangles: 0 };
        line(`    ${k.padEnd(12)} ${m(at("view").triangles)} / ${m(at("mirror").triangles)} / ${m(at("shadow").triangles)}   calls ${at("view").calls} / ${at("mirror").calls} / ${at("shadow").calls}`);
      }
      if (woods !== undefined) line(`    trees in view: ${woods.treesDrawn - woods.treesInBand} full, ${woods.treesInBand} in the band, ${woods.treesFar} far; turning far at ${woods.swapPx} px`);
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
      line(`  ${key}: ${steps.length} steps; worst block ${f(worst[2])} at ${f(worst[0], 0)} m; the wind's ${f(typical)} (its median along the walk); ${pops.length} pops${pops.length > 0 ? ` (at ${pops.map((s) => f(s[0], 0)).join(", ")} m)` : ""}`);
    } else if (key.startsWith("swap ")) {
      // A step passes when it changes the plant's part of the screen no more than the wind does there in half a second, or too little to show.
      type Step = { change: { mean: number; worst: number }; wind: { mean: number; worst: number }; distance: number };
      const rows = value as { name: string; vitality: number; end: Step; middle: Step }[];
      const over = (s: Step): boolean => s.change.worst > SWAP_FLOOR && (s.change.worst > s.wind.worst || s.change.mean > s.wind.mean);
      const failed = rows.filter((r) => over(r.end) || over(r.middle));
      line(`  ${key}: ${rows.length - failed.length} of ${rows.length} presets and healths under the wind or a level (mean / worst block over the plant, the step against the wind)`);
      const say = (s: Step): string => `${f(s.change.mean, 2)} / ${f(s.change.worst)} against ${f(s.wind.mean, 2)} / ${f(s.wind.worst)}`;
      for (const r of rows) line(`    ${over(r.end) || over(r.middle) ? "over " : "     "} ${r.name.padEnd(16)} ${f(r.vitality, 2)}  middle of the band ${say(r.middle)} at ${f(r.middle.distance, 0)} m; its end ${say(r.end)}`);
    } else if (key.startsWith("hitch ")) {
      const s = value as { medianMs: number; p99Ms: number; maxMs: number; stutters: number };
      line(`  ${key}: median ${f(s.medianMs, 2)} ms, p99 ${f(s.p99Ms, 1)}, max ${f(s.maxMs, 1)}, ${s.stutters} stutters`);
    }
  }
}
