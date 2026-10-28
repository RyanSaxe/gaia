// Where `pnpm graph-snapshot` writes a project's judged graph and `pnpm
// jev-world` keeps the world's answers judged from it, by default: outside the
// repository, which keeps only the showcase's answers.

import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".cache", "gaia-snapshot");

export const SNAPSHOT = { graph: join(DIR, "graph.json"), answers: join(DIR, "jev.json") } as const;
