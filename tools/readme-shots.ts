// Takes the README's screenshots from the lab: the world at eye height, and
// the field map unfolded over it. Each shot names its spot, hour and view, and
// the lab's own hooks (`window.__lab`) put the person there, so the shots can
// be taken again whenever the world changes. The one-file lab opens in a
// hidden Electron window (the app's own Chromium, drawing on the GPU), and each
// shot is written to docs/images/ as a JPEG.
// Usage: pnpm readme-shots

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { LAB_BUILD, labBundle, labPage } from "./lab-page.ts";

interface Shot {
  readonly file: string;
  /** The hour the world shows. */
  readonly hour: number;
  /** Where the person stands and the point they look toward, world meters. */
  readonly at: readonly [number, number];
  readonly toward: readonly [number, number];
  /** Degrees above the horizon. */
  readonly pitch: number;
  /** Unfolds the field map over the world. */
  readonly map?: boolean;
}

/** In Gaia's own world: the storybook houses at the edge of app/renderer, in the late afternoon. */
const SHOTS: readonly Shot[] = [
  { file: "world.jpg", hour: 17.5, at: [95, -400], toward: [135, -470], pitch: 1 },
  { file: "field-map.jpg", hour: 17.5, at: [95, -400], toward: [135, -470], pitch: 1, map: true },
];

/** The window's size in CSS pixels; it draws at twice that and each shot is scaled back down. */
const WIDTH = 1600;
const HEIGHT = 1000;
const QUALITY = 84;

const repo = resolve(import.meta.dirname, "..");
const out = resolve(repo, "docs/images");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "gaia-readme-shots-"));
const page = join(scratch, "lab.html");
writeFileSync(page, labPage(labBundle(await build(LAB_BUILD))));

// Electron runs this as its main process: open the lab, stage each shot, capture it.
const main = join(scratch, "main.mjs");
writeFileSync(
  main,
  `import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
const { page, out, shots, width, height, quality } = JSON.parse(process.env.GAIA_README_SHOTS);
app.commandLine.appendSwitch("force-device-scale-factor", "2");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
const say = (line) => console.log("readme-shots: " + line);
async function take() {
  const win = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  win.webContents.on("console-message", (e) => { if (e.level === "error") say("page: " + e.message); });
  await win.loadFile(page);
  const run = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await run("new Promise((r) => { const t = () => (window.__lab ? r() : setTimeout(t, 50)); t(); })");
  say("opening the world");
  await run('window.__lab.open("immersive")');
  for (const s of shots) {
    // The lab's yaw turns the view from looking along -z: look from 'at' toward 'toward'.
    const yaw = (Math.atan2(s.at[0] - s.toward[0], s.at[1] - s.toward[1]) * 180) / Math.PI;
    await run("window.__lab.hour(" + s.hour + ")");
    await run("window.__lab.terrain.walk(" + [s.at[0], s.at[1], yaw, s.pitch].join(", ") + ")");
    // Long enough for the grass and ground to follow, and for the slip naming the place to come and go.
    await wait(10000);
    if (s.map) {
      await run("window.__lab.immersive.map(true)");
      await wait(5000);
    }
    const image = await win.webContents.capturePage();
    writeFileSync(out + "/" + s.file, image.resize({ width, quality: "best" }).toJPEG(quality));
    say(s.file);
    if (s.map) {
      await run("window.__lab.immersive.map(false)");
      await wait(1500);
    }
  }
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
const env: NodeJS.ProcessEnv = { ...process.env, GAIA_README_SHOTS: JSON.stringify({ page, out, shots: SHOTS, width: WIDTH, height: HEIGHT, quality: QUALITY }) };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(electron, [main], { env, stdio: "inherit" });
rmSync(scratch, { recursive: true, force: true });
if (run.status !== 0) throw new Error(`Electron exited with ${run.status ?? run.signal}`);
for (const s of SHOTS) console.log(`${join(out, s.file)} ${(statSync(join(out, s.file)).size / 1024).toFixed(0)} KiB`);
