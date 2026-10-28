// Parses the showcase's source, the codebase gaia, from
// `fixtures/showcase-code.txt`, where each file follows its `=== path ===`
// line. `pnpm showcase` writes the files out for the engine to read, and the
// page shows them in the journal.

/** The showcase's files by path, each ending in one newline. */
export function showcaseFiles(bundle: string): Map<string, string> {
  const files = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  const keep = (): void => {
    if (path !== null) files.set(path, `${lines.join("\n").replace(/\n+$/, "")}\n`);
  };
  for (const line of bundle.split(/\r?\n/)) {
    const header = /^=== (.+) ===$/.exec(line);
    if (header === null) {
      lines.push(line);
      continue;
    }
    keep();
    path = header[1] as string;
    lines = [];
  }
  keep();
  return files;
}
