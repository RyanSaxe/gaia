// The main process: one window on the lab, the engine binary, and the world
// service. Main relays newline-delimited JSON-RPC between the world service
// and the engine, restarts the engine when it exits, and hands each loaded
// page a MessagePort to the world service, with the folder whose world it
// shows: `GAIA_PROJECT`, one the person opens with File > Open Folder, or none,
// and then the page offers the start, where a person picks a world they
// opened before, a folder, or an address on GitHub. `GAIA_PROJECT=proving`
// opens the proving ground instead, which needs no folder (`?world=proving`).

import { basename, join, resolve } from "node:path";
import { BrowserWindow, Menu, MessageChannelMain, type MessagePortMain, app, dialog, ipcMain, nativeTheme, utilityProcess } from "electron";
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
  // With no project named the page offers the start; shots always show Gaia's own world.
  const named = process.env.GAIA_PROJECT ?? (shots ? repoRoot : undefined);
  // The proving ground is laid out on the page from its own fixture, so no folder is opened for it.
  let proving = named === "proving";
  let root: string | null = named === undefined || proving ? null : resolve(named);
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
    if (message.type === "engine.send") {
      if (!engine.send(message.line)) console.error("gaia: no engine is running to take the request");
    } else if (message.type === "world.opened") {
      // A world chosen on the start page: the window takes its name, and a reload reopens it.
      root = message.root;
      window.setTitle(`Gaia · ${message.name}`);
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
    const onProving = new URL(window.webContents.getURL()).searchParams.get("world") === "proving";
    window.setTitle(onProving ? "Gaia · proving ground" : root === null ? "Gaia" : `Gaia · ${basename(root)}`);
  });
  window.on("page-title-updated", (event) => event.preventDefault());

  const chooseFolder = async (): Promise<string | null> => {
    const chosen = await dialog.showOpenDialog(window, { title: "Open a codebase", ...(root === null ? {} : { defaultPath: root }), properties: ["openDirectory"] });
    return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
  };
  // The start page's "a folder on this computer": the page sends the folder to the world service itself.
  ipcMain.handle("gaia:choose-folder", () => chooseFolder());
  // File > Open Folder: the page reloads, and its new port opens the chosen folder's world.
  const openFolder = async (): Promise<void> => {
    const folder = await chooseFolder();
    if (folder === null) return;
    root = folder;
    void load();
  };
  // File > Choose a World: back to the start page.
  const offerStart = (): void => {
    root = null;
    void load();
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { label: "File", submenu: [{ label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => void openFolder() }, { label: "Choose a World…", accelerator: "CmdOrCtrl+Shift+O", click: offerStart }, { type: "separator" }, { role: "close" }] },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  const url = process.env.ELECTRON_RENDERER_URL;
  /** Loads the page: on the proving ground the first time if `GAIA_PROJECT` named it, and on the folder `root` names from then on. */
  function load(): Promise<void> {
    const world = proving ? "proving" : undefined;
    proving = false;
    if (url === undefined) return window.loadFile(join(here, "../renderer/index.html"), world === undefined ? {} : { query: { world } });
    return window.loadURL(world === undefined ? url : `${url}?world=${world}`);
  }
  const loaded = load();

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
