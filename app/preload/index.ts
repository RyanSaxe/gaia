// The preload script: marks the page as running inside the app, and passes
// the world service's MessagePort from main into the page.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gaiaShell", { app: "electron" });

ipcRenderer.on("gaia:world-port", (event) => {
  // Ports cannot cross the context bridge; window.postMessage can carry them.
  window.postMessage("gaia:world-port", "*", event.ports);
});
