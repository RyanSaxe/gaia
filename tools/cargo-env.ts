import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** The environment with rustup's cargo ahead of any system toolchain on PATH, on every shell. */
export function cargoEnv(): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const current = process.env[pathKey];
  const bin = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin");
  return { ...process.env, [pathKey]: [bin, current].filter(Boolean).join(delimiter) };
}
