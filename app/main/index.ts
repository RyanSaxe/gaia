// Runs the engine under `superviseEngine`, forks the world service, relays
// newline-delimited JSON-RPC between them, and opens one window. Each page load
// gets a new MessagePort to the world service and the folder to open, which
// comes from `GAIA_PROJECT` or File > Open Folder. With no folder, the page
// shows the start page.

import { basename, join, resolve } from "node:path";
import { BrowserWindow, Menu, MessageChannelMain, type MessagePortMain, app, dialog, ipcMain, nativeTheme, utilityProcess } from "electron";
import type { FromMain, ToMain } from "../world-service/protocol.ts";
import { superviseEngine } from "./engine.ts";

const here = import.meta.dirname;

app.setName("Gaia");

void app.whenReady().then(() => {
  // Sets the Dock icon when Gaia runs from source. A packaged app uses build/icon.icns.
  app.dock?.setIcon(join(app.getAppPath(), "build/icon.png"));
  const repoRoot = resolve(app.getAppPath(), "..");
  // Without `GAIA_PROJECT`, the page shows the start page.
  const named = process.env.GAIA_PROJECT;
  // `proving`, `showcase` and `showcase-fixed` name fixture worlds that the page lays out itself through `?world=`, so main
  // opens no folder for them.
  let carried = named === "proving" || named === "showcase" || named === "showcase-fixed" ? named : null;
  let root: string | null = named === undefined || carried !== null ? null : resolve(named);
  // The engine stores each project's Jev answers and the app settings, such as the spend limit, in Electron's userData
  // directory.
  process.env.GAIA_DATA_DIR ??= app.getPath("userData");
  const service = utilityProcess.fork(join(here, "world-service.js"), [], { serviceName: "Gaia world service", stdio: "inherit" });
  const toService = (message: FromMain, ports?: MessagePortMain[]): void => service.postMessage(message, ports);

  const engineName = process.platform === "win32" ? "gaia-engine.exe" : "gaia-engine";
  const engine = superviseEngine(process.env.GAIA_ENGINE ?? join(repoRoot, "target", "debug", engineName), ["rpc"], {
    up: () => toService({ type: "engine.up" }),
    down: (reason) => toService({ type: "engine.down", reason }),
    line: (line) => toService({ type: "engine.line", line }),
  });
  service.on("message", (message: ToMain) => {
    if (message.type === "engine.send") {
      if (!engine.send(message.line)) console.error("gaia: no engine is running to take the request");
    } else if (message.type === "world.opened") {
      // The start page opened a world. The window title shows its name, and `root` keeps it so a reload reopens it.
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
    title: "Gaia",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171815" : "#f3f0e8",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
    },
  });

  // Each page load gets a new port to the world service and the folder in `root` to open.
  window.webContents.on("did-finish-load", () => {
    const { port1, port2 } = new MessageChannelMain();
    toService({ type: "renderer.port", root }, [port1]);
    window.webContents.postMessage("gaia:world-port", null, [port2]);
    const world = new URL(window.webContents.getURL()).searchParams.get("world");
    window.setTitle(world === "proving" ? "Gaia · proving ground" : world === "showcase" || world === "showcase-fixed" ? "Gaia · showcase" : root === null ? "Gaia" : `Gaia · ${basename(root)}`);
  });
  window.on("page-title-updated", (event) => event.preventDefault());

  const chooseFolder = async (): Promise<string | null> => {
    const chosen = await dialog.showOpenDialog(window, { title: "Open a codebase", ...(root === null ? {} : { defaultPath: root }), properties: ["openDirectory"] });
    return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
  };
  // The start page asks for a folder here, then sends it to the world service itself.
  ipcMain.handle("gaia:choose-folder", () => chooseFolder());
  // File > Open Folder reloads the page, and the new page's port opens the chosen folder.
  const openFolder = async (): Promise<void> => {
    const folder = await chooseFolder();
    if (folder === null) return;
    root = folder;
    void load();
  };
  // File > Choose a World reloads the page with no folder, which shows the start page.
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
  /** Loads the page. The first load opens the fixture world that `GAIA_PROJECT` named, if any. Later loads open `root`. */
  function load(): Promise<void> {
    const world = carried ?? undefined;
    carried = null;
    if (url === undefined) return window.loadFile(join(here, "../renderer/index.html"), world === undefined ? {} : { query: { world } });
    return window.loadURL(world === undefined ? url : `${url}?world=${world}`);
  }
  void load();
});

app.on("window-all-closed", () => app.quit());
