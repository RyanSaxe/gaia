import { join } from "node:path";

/** Cargo's default output path for Gaia's engine on this platform. */
export function engineBinary(repo: string, profile: "debug" | "release"): string {
  const name = process.platform === "win32" ? "gaia-engine.exe" : "gaia-engine";
  return join(repo, "target", profile, name);
}
