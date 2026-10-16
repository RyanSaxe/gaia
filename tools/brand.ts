// Paints Gaia's mark (app/renderer/brand/paint.ts) into the pictures the app shows, at the sizes it shows them on a
// 2x screen: the name the start's sheet and the slip print into their paper, the page's icon, and the macOS app icon
// at every size its icon set holds, the 32 pixels and under with a lighter shade at the G's edge. The painting runs in
// a hidden Electron window (the app's own Chromium), from the mark's own view and faces, so painting again changes
// nothing you can see.
// Usage: pnpm brand [--readme out.png]   (--readme also paints the icon and the name on their own torn sheet, 1600 wide)

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { LAB_BUILD } from "./lab-page.ts";

const repo = resolve(import.meta.dirname, "..");
const brand = resolve(repo, "app/renderer/brand");
const buildDir = resolve(repo, "app/build");
const readmeAt = process.argv.indexOf("--readme");
const readme = readmeAt === -1 ? null : resolve(process.argv[readmeAt + 1] ?? "readme-header.png");

/** The macOS icon set: each file and the pixels a side it holds. */
const ICONSET = [16, 32, 64, 128, 256, 512, 1024].flatMap((px) => [
  ...(px <= 512 ? [{ file: `icon_${px}x${px}.png`, px }] : []),
  ...(px >= 32 ? [{ file: `icon_${px / 2}x${px / 2}@2x.png`, px }] : []),
]);

// The page: paints each picture and hands it back as a data URL.
const page = `
import { DECKLE_MASK } from "../immersive/map-styles.ts";
import { brandReady, paintIcon, paintLockup, paintName } from "./paint.ts";
const url = (c, type = "image/png", quality) => c.toDataURL(type, quality);
const image = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
/** The art in the rounded square every macOS icon has, 824 of 1024 with the shade it casts. */
function framed(px) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  const k = px / 1024;
  const [x, w, r] = [100 * k, 824 * k, 185 * k];
  g.save();
  g.shadowColor = "rgba(0,0,0,0.3)";
  g.shadowBlur = 24 * k;
  g.shadowOffsetY = 10 * k;
  g.beginPath();
  g.roundRect(x, x, w, w, r);
  g.fillStyle = "#e9dcbd";
  g.fill();
  g.restore();
  g.save();
  g.beginPath();
  g.roundRect(x, x, w, w, r);
  g.clip();
  g.drawImage(paintIcon(Math.round(w), px <= 32), x, x, w, w);
  g.restore();
  return c;
}
window.brand = {
  ready: brandReady(),
  sheet: () => url(paintName(520), "image/webp", 0.92),
  slip: () => url(paintName(208), "image/webp", 0.92),
  favicon: () => url(paintIcon(32, true), "image/webp", 1),
  icon: (px) => url(framed(px)),
  readme: async () => url(paintLockup(1600, await image(DECKLE_MASK.slice(5, -2)))),
};
`;
const { entryPoints: _, ...options } = LAB_BUILD;
const bundled = await build({ ...options, loader: { ...options.loader, ".woff2": "dataurl" }, stdin: { contents: page, resolveDir: brand, loader: "ts", sourcefile: "brand-page.ts" }, outdir: "brand" });
const js = bundled.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
const scratch = mkdtempSync(join(tmpdir(), "gaia-brand-"));
writeFileSync(join(scratch, "brand.html"), `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`);

const iconset = join(scratch, "icon.iconset");
mkdirSync(iconset);
mkdirSync(buildDir, { recursive: true });
const jobs = [
  { name: "sheet", out: join(brand, "logo-sheet.webp") },
  { name: "slip", out: join(brand, "logo-slip.webp") },
  { name: "favicon", out: join(brand, "favicon.webp") },
  { name: "icon", arg: 512, out: join(buildDir, "icon.png") },
  ...ICONSET.map((i) => ({ name: "icon", arg: i.px, out: join(iconset, i.file) })),
  ...(readme === null ? [] : [{ name: "readme", out: readme }]),
];

// Electron runs this as its main process: open the page hidden, paint each picture, write it.
const main = join(scratch, "main.mjs");
writeFileSync(
  main,
  `import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
const { page, jobs } = JSON.parse(process.env.GAIA_BRAND);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(page);
  const run = (js) => win.webContents.executeJavaScript(js);
  await run("window.brand.ready.then(() => 0)");
  for (const j of jobs) {
    const data = await run("window.brand." + j.name + "(" + (j.arg ?? "") + ")");
    writeFileSync(j.out, Buffer.from(data.split(",")[1], "base64"));
  }
  win.destroy();
}).then(() => app.quit(), (error) => { console.log("brand: " + String(error)); app.exit(1); });
`,
);
const electron = createRequire(resolve(repo, "app/package.json"))("electron") as string;
const env: NodeJS.ProcessEnv = { ...process.env, GAIA_BRAND: JSON.stringify({ page: join(scratch, "brand.html"), jobs }) };
delete env.ELECTRON_RUN_AS_NODE;
const painted = spawnSync(electron, [main], { env, stdio: "inherit" });
if (painted.status !== 0) throw new Error(`Electron exited with ${painted.status ?? painted.signal}`);
const icns = spawnSync("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")], { stdio: "inherit" });
if (icns.status !== 0) throw new Error("iconutil could not make the icon set.");
rmSync(scratch, { recursive: true, force: true });

const sizeOf = (file: string): string => {
  const head = readFileSync(file);
  // A PNG's width and height follow its IHDR tag; a lossy WebP's follow its VP8 frame's start code.
  if (file.endsWith(".png")) return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`;
  const at = head.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
  return at < 0 ? "" : `${head.readUInt16LE(at + 3) & 0x3fff}x${head.readUInt16LE(at + 5) & 0x3fff}`;
};
for (const j of jobs.filter((j) => !j.out.startsWith(iconset))) console.log(`${j.out} ${sizeOf(j.out)} ${(statSync(j.out).size / 1024).toFixed(0)} KiB`);
console.log(`${join(buildDir, "icon.icns")} ${(statSync(join(buildDir, "icon.icns")).size / 1024).toFixed(0)} KiB`);
