// The world service: a utility process between the renderer and the engine.
// For now it pings the engine whenever one starts and tells the renderer
// whether the engine is connected.

import type { MessagePortMain } from "electron";
import { createEngineClient } from "./engine-client.ts";
import type { EngineStatus, FromMain, ToMain, ToRenderer } from "./protocol.ts";

const parent = process.parentPort;
const toMain = (message: ToMain): void => parent.postMessage(message);

const engine = createEngineClient((line) => toMain({ type: "engine.send", line }));
let status: EngineStatus = { state: "starting" };
let renderer: MessagePortMain | null = null;

function report(next: EngineStatus): void {
  status = next;
  renderer?.postMessage({ type: "engine.status", status } satisfies ToRenderer);
}

async function connect(): Promise<void> {
  try {
    const { version } = await engine.call("engine.ping", {});
    report({ state: "connected", version });
  } catch (error) {
    // The engine went down mid-ping; its restart pings again.
    console.error(`gaia: engine.ping failed: ${(error as Error).message}`);
  }
}

parent.on("message", (event) => {
  const message = event.data as FromMain;
  switch (message.type) {
    case "engine.up":
      void connect();
      break;
    case "engine.down":
      engine.disconnect(`The engine ${message.reason}.`);
      report({ state: "restarting" });
      break;
    case "engine.line":
      engine.receive(message.line);
      break;
    case "renderer.port":
      renderer?.close();
      renderer = event.ports[0] ?? null;
      renderer?.start();
      report(status);
      break;
  }
});
