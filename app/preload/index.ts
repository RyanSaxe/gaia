// Marks the page as running inside the app, passes the world service's
// MessagePort from main to the page, and lets the start page ask main for a
// folder.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gaiaShell", {
  app: "electron",
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("gaia:choose-folder") as Promise<string | null>,
});

ipcRenderer.on("gaia:world-port", (event) => {
  // The context bridge cannot pass ports, so the script forwards them with `window.postMessage`.
  window.postMessage("gaia:world-port", "*", event.ports);
});
