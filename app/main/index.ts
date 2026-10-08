// The main process: one window on the lab, the engine binary, and the world
// service. Main relays newline-delimited JSON-RPC between the world service
// and the engine, restarts the engine when it exits, and hands each loaded
// page a MessagePort to the world service, with the folder whose world it
// shows: Gaia's own repository, `GAIA_PROJECT`, or one the person opens with
// File > Open Folder.

import { basename, join, resolve } from "node:path";
import { BrowserWindow, Menu, MessageChannelMain, type MessagePortMain, app, dialog, nativeTheme, utilityProcess } from "electron";
import type { FromMain, ToMain } from "../world-service/protocol.ts";
import { superviseEngine } from "./engine.ts";
import { takeShots } from "./shots.ts";

const here = import.meta.dirname;
const shots = process.argv.includes("--shots");

app.setName("Gaia");
// Shots look the same whatever the system theme is.
if (shots) nativeTheme.themeSource = "light";

void app.whenReady().then(() => {
  const repoRoot = resolve(app.getAppPath(), "..");
  let root = resolve(process.env.GAIA_PROJECT ?? repoRoot);
  // The engine keeps each project's store (Jev's answers, a stand-in choice) and the app's own settings (the spend limit) with the app's own data.
  process.env.GAIA_DATA_DIR ??= app.getPath("userData");
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

  // Every page load gets a fresh port to the world service, and the folder whose world it opens.
  window.webContents.on("did-finish-load", () => {
    const { port1, port2 } = new MessageChannelMain();
    toService({ type: "renderer.port", root }, [port1]);
    window.webContents.postMessage("gaia:world-port", null, [port2]);
    window.setTitle(`Gaia · ${basename(root)}`);
  });
  window.on("page-title-updated", (event) => event.preventDefault());

  // File > Open Folder: the page reloads, and its new port opens the chosen folder's world.
  const openFolder = async (): Promise<void> => {
    const chosen = await dialog.showOpenDialog(window, { title: "Open a codebase", defaultPath: root, properties: ["openDirectory"] });
    const folder = chosen.filePaths[0];
    if (chosen.canceled || folder === undefined) return;
    root = folder;
    window.webContents.reload();
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { label: "File", submenu: [{ label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => void openFolder() }, { type: "separator" }, { role: "close" }] },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

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
