// The main process: one window on the lab, the engine binary, and the world
// service. Main relays newline-delimited JSON-RPC between the world service
// and the engine, restarts the engine when it exits, and hands each loaded
// page a MessagePort to the world service.

import { join, resolve } from "node:path";
import { BrowserWindow, MessageChannelMain, type MessagePortMain, app, nativeTheme, utilityProcess } from "electron";
import type { FromMain, ToMain } from "../world-service/protocol.ts";
import { superviseEngine } from "./engine.ts";
import { takeShots } from "./shots.ts";

const here = import.meta.dirname;
const shots = process.argv.includes("--shots");

app.setName("Gaia");

void app.whenReady().then(() => {
  const repoRoot = resolve(app.getAppPath(), "..");
  const service = utilityProcess.fork(join(here, "world-service.js"), [], { serviceName: "Gaia world service", stdio: "inherit" });
  const toService = (message: FromMain, ports?: MessagePortMain[]): void => service.postMessage(message, ports);

  const engine = superviseEngine(process.env.GAIA_ENGINE ?? join(repoRoot, "target", "debug", "gaia-engine"), ["rpc"], {
    up: () => toService({ type: "engine.up" }),
    down: (reason) => toService({ type: "engine.down", reason }),
    line: (line) => toService({ type: "engine.line", line }),
  });
  service.on("message", (message: ToMain) => {
    if (message.type === "engine.send" && !engine.send(message.line)) {
      console.error("gaia: no engine is running to take the request");
    }
  });
  app.on("before-quit", () => {
    engine.stop();
    service.kill();
  });

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    minWidth: 860,
    minHeight: 560,
    show: !shots,
    title: "Gaia",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171815" : "#f3f0e8",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      // Shots render in a hidden window, which Chromium would otherwise throttle.
      backgroundThrottling: !shots,
    },
  });

  // Every page load gets a fresh port to the world service.
  window.webContents.on("did-finish-load", () => {
    const { port1, port2 } = new MessageChannelMain();
    toService({ type: "renderer.port" }, [port1]);
    window.webContents.postMessage("gaia:world-port", null, [port2]);
  });

  const url = process.env.ELECTRON_RENDERER_URL;
  const loaded = url === undefined ? window.loadFile(join(here, "../renderer/index.html")) : window.loadURL(url);

  if (shots) {
    loaded
      .then(() => takeShots(window, join(repoRoot, "shots")))
      .then((saved) => {
        console.log(`Saved ${saved.length} shots in ${join(repoRoot, "shots")}`);
        app.quit();
      })
      .catch((error: unknown) => {
        console.error(error);
        app.exit(1);
      });
  }
});

app.on("window-all-closed", () => app.quit());
