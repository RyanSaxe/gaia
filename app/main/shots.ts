// `pnpm shots`: drives the lab in a hidden window and saves one PNG per shot.
// The renderer names the shots and stages each one; main only captures.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

export async function takeShots(window: BrowserWindow, dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const run = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script) as Promise<T>;
  const names = await run<string[]>("window.__lab.shots()");
  const saved: string[] = [];
  for (const name of names) {
    await run(`window.__lab.stage(${JSON.stringify(name)})`);
    const image = await window.webContents.capturePage();
    const file = join(dir, `${name}.png`);
    await writeFile(file, image.toPNG());
    saved.push(file);
    console.log(file);
  }
  return saved;
}
