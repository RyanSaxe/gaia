// folio's source: the showcase's codebase, every file under its `=== path ===`
// line in `fixtures/showcase-code.txt`. `pnpm showcase` writes it out for the
// engine to read, and the page shows it in the journal.

/** folio's files by path, each ending in one newline. */
export function folioFiles(bundle: string): Map<string, string> {
  const files = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  const keep = (): void => {
    if (path !== null) files.set(path, `${lines.join("\n").replace(/\n+$/, "")}\n`);
  };
  for (const line of bundle.split("\n")) {
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
