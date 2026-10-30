// Opens a world in the real app, as a person starts it: Electron's main
// process (`app/main`), the world service it forks and the engine binary it
// supervises, with the renderer built by `pnpm --filter @gaia/app build`. It
// opens the showcase from its kept answers with Jev off, and fails unless the
// world opens, the engine connects through the world service, and nothing
// reports an error: no error on the page's console, no WebGL error, no error
// from main, the world service or the engine, and no process that dies.
//
// A small main of its own (`opens.mjs`) runs before the app's: it gives the run
// its own profile and store, keeps the window hidden and muted, and reads the
// page through the lab's hooks (`window.__lab`).
// Usage: pnpm app-opens

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webglErrors } from "../app/main/webgl-errors.ts";
import { cargoEnv } from "./cargo-env.ts";

/** How long the world may take to open. CI's macOS runners draw on a paravirtual GPU, where the first open takes minutes. */
const OPEN_MS = 900_000;

const repo = resolve(import.meta.dirname, "..");
const appDir = resolve(repo, "app");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
execFileSync(pnpm, ["--filter", "@gaia/app", "build"], { cwd: repo, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
execFileSync("cargo", ["build", "-p", "gaia-engine", "--quiet"], { cwd: repo, env: cargoEnv(), stdio: "inherit" });

const scratch = mkdtempSync(join(tmpdir(), "gaia-opens-"));
const out = join(scratch, "out.json");
const opens = join(scratch, "opens.mjs");
writeFileSync(
  opens,
  `import { app } from "electron";
import { writeFileSync } from "node:fs";
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const { appDir, appMain, out, profile, openMs } = JSON.parse(process.env.GAIA_OPENS);
const problems = [];
const messages = [];
let result = null;
const done = (opened) => {
  if (result !== null) return;
  result = { opened, problems, messages };
  writeFileSync(out, JSON.stringify(result));
  app.exit(0);
};
process.on("uncaughtException", (error) => (problems.push("main threw: " + (error?.stack ?? error)), done(null)));
process.on("unhandledRejection", (error) => (problems.push("main rejected: " + (error?.stack ?? error)), done(null)));
// The app reads its own files and the repository from its path, as when it runs from source.
app.setAppPath(appDir);
app.setPath("userData", profile);
// A hidden window keeps drawing, so the world opens as it does on screen.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.on("child-process-gone", (_, d) => problems.push("the " + (d.name ?? d.type) + " process went: " + d.reason));
app.on("browser-window-created", (_, win) => {
  win.hide();
  win.webContents.setAudioMuted(true);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on("console-message", (e) => {
    if (e.level === "warning" || e.level === "error") messages.push(e.message);
    if (e.level === "error") problems.push("the page: " + e.message);
  });
  win.webContents.on("render-process-gone", (_, d) => problems.push("the page's process went: " + d.reason));
  win.webContents.once("did-finish-load", async () => {
    const run = (js) => win.webContents.executeJavaScript(js);
    let waiting = "for the page";
    const late = setTimeout(() => (problems.push("still waiting " + waiting + " after " + openMs / 1000 + " s"), done(null)), openMs);
    try {
      await run("new Promise((r) => { const t = () => (window.__lab ? r() : setTimeout(t, 50)); t(); })");
      waiting = "for the world to open";
      await run("window.__lab.open()");
      // The engine answers the world service's ping once it is up.
      waiting = "for the engine to connect";
      const status = await run("new Promise((r) => { const t = () => (/connected/.test(window.__lab.status()) ? r(window.__lab.status()) : setTimeout(t, 100)); t(); })");
      waiting = "for frames";
      await run("window.__lab.frames(30)");
      clearTimeout(late);
      done({ status, title: win.getTitle() });
    } catch (error) {
      clearTimeout(late);
      problems.push("the page: " + (error?.message ?? error));
      done(null);
    }
  });
});
await import(appMain);
`,
);

const electron = createRequire(resolve(appDir, "package.json"))("electron") as string;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GAIA_OPENS: JSON.stringify({ appDir, appMain: pathToFileURL(join(appDir, "out/main/index.js")).href, out, profile: join(scratch, "profile"), openMs: OPEN_MS }),
  GAIA_PROJECT: "showcase",
  GAIA_DATA_DIR: join(scratch, "data"),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
// Jev is off unless asked for, so the showcase opens from its kept answers alone.
delete env.GAIA_JEV;
const run = spawnSync(electron, [opens], { env, encoding: "utf8", timeout: OPEN_MS + 60_000 });
const said = `${run.stdout ?? ""}${run.stderr ?? ""}`;
const result = run.status === 0 ? (JSON.parse(readFileSync(out, "utf8")) as { opened: { status: string; title: string } | null; problems: string[]; messages: string[] }) : null;
rmSync(scratch, { recursive: true, force: true });

const problems = [...(result?.problems ?? [`Electron exited with ${run.status ?? run.signal}`])];
// Main, the world service and the engine report their errors on Electron's output, each line beginning "gaia:" or
// "gaia-engine:".
for (const l of said.split("\n")) if (/^gaia(-engine)?:/.test(l.trim())) problems.push(`output: ${l.trim()}`);
const errors = webglErrors();
for (const message of result?.messages ?? []) errors.note(message);
if (errors.count() > 0) problems.push(errors.summary());

if (result?.opened != null) console.log(`app-opens: the showcase opened in the app; ${result.opened.status}; the window reads "${result.opened.title}".`);
for (const p of problems) console.log(`app-opens: ${p}`);
if (result?.opened == null || problems.length > 0) {
  if (said.trim() !== "") console.log(`app-opens: Electron printed:\n${said.trim()}`);
  process.exitCode = 1;
}
