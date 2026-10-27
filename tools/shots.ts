// `pnpm shots`: every kind of thing the proving ground stands, photographed
// where it stands, so a primitive is judged in the light and land it lives
// in. The proving ground holds every feature a world can show
// (`docs/proving-ground.md`). Each stop of its tour, one stop for each kind of
// building and landmark, and one thing standing as each tree, bush, stone and
// flower build are seen at vitality 1, 0.65 and 0.3 at 15:30, and at 1 at 22:00.
// The first stop is seen again under each sky the sweep holds (`__lab.terrain.sky`),
// whole at 15:30, as `sky-K.jpg`.
// The one-file lab opens in a hidden Electron window (the app's own Chromium,
// drawing on the GPU) from a browser profile of its own, so the far forms bake
// as on a first visit, and the run fails on any WebGL error the page reports.
// Each shot goes to shots/ as a JPEG named for its stop.
// Usage: pnpm shots [--world gaia|showcase|showcase-fixed] [WORD...]  (only the stops whose names hold one of the
// words, such as `pnpm shots watermill` or `pnpm shots sky`; the proving ground's unless --world names another)

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { webglErrors } from "../app/main/webgl-errors.ts";
import { LAB_BUILD, labBundle, labPage } from "./lab-page.ts";

/** The window's size in CSS pixels; it draws at twice that and each shot is scaled back down. */
const WIDTH = 1280;
const HEIGHT = 800;
const QUALITY = 88;
/** Each stop's shots: the hour and the vitality every file and entity in the world is set to. */
const LOOKS = [
  { hour: 15.5, vitality: 1 },
  { hour: 15.5, vitality: 0.65 },
  { hour: 15.5, vitality: 0.3 },
  { hour: 22, vitality: 1 },
];

const repo = resolve(import.meta.dirname, "..");
const out = resolve(repo, "shots");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "gaia-shots-"));
const page = join(scratch, "lab.html");
const result = join(scratch, "result.json");
writeFileSync(page, labPage(labBundle(await build(LAB_BUILD))));

// What the page runs: where each stop is, how to wait for the land and what stands on it, and the world's vitality.
const PAGE = /* js */ `
window.__shots = (() => {
  const T = window.__lab.terrain;
  // A kind's stops at each health, such as "great tree (tired) 2".
  const health = / \\((thriving|well|tired|failing|ruin)\\)( \\d+)?$/;
  const bare = (name) => name.replace(/^an? /i, "").toLowerCase();
  return {
    /**
     * The stops: the tour's, one for each kind its health stops name, then a thing standing as each other form. Each
     * tour stop is found now, while the world shows its own vitality, since the tour finds its ruined things by it.
     */
    stops(words) {
      const stops = [];
      const kinds = new Set();
      for (const s of T.tour()) {
        const kind = s.name.replace(health, "");
        if (kinds.has(kind)) continue;
        if (health.test(s.name)) kinds.add(kind);
        const at = T.tour(s.name);
        stops.push({ name: kind, walk: [at.x, at.z, (at.yaw * 180) / Math.PI, (at.pitch * 180) / Math.PI] });
      }
      const forms = new Set(stops.map((s) => s.name));
      for (const s of T.subjects()) {
        const form = s.built === undefined ? bare(s.standsAs) : s.built.toLowerCase();
        if (forms.has(form)) continue;
        forms.add(form);
        stops.push({ name: form, at: { x: s.x, z: s.z, height: s.height } });
      }
      return words.length === 0 ? stops : stops.filter((s) => words.some((w) => s.name.includes(w.toLowerCase())));
    },
    /** Stands the person at a stop, looking at it; false where nowhere near is fit to stand. */
    go(stop) {
      if (stop.walk !== undefined) {
        T.walk(...stop.walk);
        return true;
      }
      const { x, z, height } = stop.at;
      const back = Math.min(30, Math.max(4, height * 1.8 + 3));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const spot = T.landingNear(x + Math.cos(a) * back, z + Math.sin(a) * back);
        if (spot === null) continue;
        const away = Math.hypot(x - spot.x, z - spot.z);
        if (away < back * 0.6 || away > back * 1.6) continue;
        const yaw = (Math.atan2(-(x - spot.x), -(z - spot.z)) * 180) / Math.PI;
        const pitch = (Math.atan2(height * 0.5 - 1.6, away) * 180) / Math.PI;
        T.walk(spot.x, spot.z, yaw, pitch);
        return true;
      }
      return false;
    },
    /** Waits until the land around the person and everything standing near them is in. */
    async settle() {
      for (let k = 0; k < 120; k++) {
        const asking = Object.entries(T.standingAsking()).some(([what, a]) => what !== "workers" && a.count > 0);
        if (!asking && T.landLead().every((lead) => lead > 0)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await window.__lab.frames(20);
    },
    /** Sets every file's and entity's vitality: trees, ground, understory, buildings, landmarks and trails, settled at once. */
    async vitality(v) {
      T.fileVitality("", v);
      T.landmarkVitality(v);
      T.buildings().forEach((_, i) => T.vitality(i, v));
      T.settleVitality();
      await window.__lab.frames(6);
    },
  };
})();
`;

// Electron runs this as its main process: open the proving ground, then stand at each stop and capture each look.
const main = join(scratch, "main.mjs");
writeFileSync(
  main,
  `import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
const { page, out, result, profile, world, words, looks, width, height, quality, script } = JSON.parse(process.env.GAIA_SHOTS);
app.setPath("userData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "2");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
const say = (line) => console.log("shots: " + line);
async function take() {
  const win = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  // The world makes sound; a scripted window plays none of it aloud.
  win.webContents.setAudioMuted(true);
  // The page's warnings and errors over the whole run, among them any WebGL error.
  const messages = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") say("page: " + e.message);
    if (e.level === "warning" || e.level === "error") messages.push(e.message);
  });
  // Gaia's own world is the page's own: it opens with no query.
  await win.loadFile(page, world === "gaia" ? {} : { query: { world } });
  const run = (js) => win.webContents.executeJavaScript(js);
  await run("new Promise((r) => { const t = () => (window.__lab ? r() : setTimeout(t, 50)); t(); })");
  say("opening " + world);
  await run('window.__lab.open("immersive").then(() => window.__lab.terrain.farReady())');
  await run(script + "; true");
  const stops = await run("window.__shots.stops(" + JSON.stringify(words) + ")");
  const saved = [];
  for (const stop of stops) {
    const slug = stop.name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!(await run("window.__shots.go(" + JSON.stringify(stop) + ")"))) {
      say("nowhere to stand to see " + stop.name);
      continue;
    }
    await run("window.__shots.settle()");
    for (const look of looks) {
      await run("window.__lab.hour(" + look.hour + ")");
      await run("window.__shots.vitality(" + look.vitality + ")");
      const file = slug + (look.hour >= 20 ? "-night" : "") + "-vitality-" + look.vitality.toFixed(2) + ".jpg";
      const image = await win.webContents.capturePage();
      writeFileSync(out + "/" + file, image.resize({ width, quality: "best" }).toJPEG(quality));
      saved.push(file);
    }
    say(stop.name);
  }
  // The first stop under each of the sweep's skies, looking up a little so the sky shows; then the proving ground's own.
  const first = (await run("window.__shots.stops([])"))[0];
  const skies = await run("window.__lab.terrain.sky(0)");
  for (let k = 0; first !== undefined && k < skies; k++) {
    const name = "sky " + k;
    if (words.length > 0 && !words.some((w) => name.includes(w.toLowerCase()))) continue;
    await run("window.__lab.terrain.sky(" + k + ")");
    const up = first.walk === undefined ? first : { ...first, walk: [first.walk[0], first.walk[1], first.walk[2], Math.max(first.walk[3], 6)] };
    if (!(await run("window.__shots.go(" + JSON.stringify(up) + ")"))) continue;
    await run("window.__shots.settle()");
    await run("window.__lab.hour(15.5)");
    await run("window.__shots.vitality(1)");
    const file = "sky-" + k + ".jpg";
    const image = await win.webContents.capturePage();
    writeFileSync(out + "/" + file, image.resize({ width, quality: "best" }).toJPEG(quality));
    saved.push(file);
    say(name);
  }
  await run("window.__lab.terrain.sky(0)");
  writeFileSync(result, JSON.stringify({ saved, messages }));
}
app.whenReady().then(take).then(
  () => app.quit(),
  (error) => {
    say(String(error));
    app.exit(1);
  },
);
`,
);

const electron = createRequire(resolve(repo, "app/package.json"))("electron") as string;
const argv = process.argv.slice(2);
const at = argv.indexOf("--world");
const world = at < 0 ? "proving" : (argv[at + 1] ?? "proving");
const words = at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
const settings = { page, out, result, profile: join(scratch, "profile"), world, words, looks: LOOKS, width: WIDTH, height: HEIGHT, quality: QUALITY, script: PAGE };
const env: NodeJS.ProcessEnv = { ...process.env, GAIA_SHOTS: JSON.stringify(settings) };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(electron, [main], { env, stdio: ["ignore", "inherit", "inherit"] });
const shot = run.status === 0 ? (JSON.parse(readFileSync(result, "utf8")) as { saved: string[]; messages: string[] }) : null;
rmSync(scratch, { recursive: true, force: true });
if (shot === null) throw new Error(`Electron exited with ${run.status ?? run.signal}`);
console.log(`Saved ${shot.saved.length} shots in ${out}`);
const errors = webglErrors();
for (const message of shot.messages) errors.note(message);
console.log(errors.summary());
if (errors.count() > 0) process.exitCode = 1;
