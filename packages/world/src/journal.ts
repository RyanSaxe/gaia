// The traveller's journal: a book with a page for every place and thing in
// the world, in the order a file explorer lists the code. Each directory is a
// chapter, its subdirectories chapters inside it, then its files; each file's
// definitions follow it in the order they are written, and the definitions
// inside one follow it. Every entry is one spread: the right-hand page names
// it and lists what it holds, and the left-hand page pictures it. The book
// says only what each page is about, what it lists and its number; the
// journal draws the rest from the world.

import type { CodeArea, CodePatch, CodeSymbol } from "./code-world.ts";

export interface JournalEntry {
  /** A chapter is a directory, a file is a file, and a definition is one of its definitions. */
  readonly kind: "chapter" | "file" | "definition";
  /** What it is about: a directory's or a file's path, or a definition's id (`<file>#<name>`). */
  readonly of: string;
  readonly name: string;
  /** The entry it sits under; a top-level chapter and a file at the root sit under none. */
  readonly under?: string;
  /** What its page lists, each an entry of its own, in the book's order. */
  readonly lists: readonly string[];
  /** The number of the right-hand page, which names it; the left-hand page, one before, pictures it. */
  readonly page: number;
}

export interface Journal {
  /** The repository's name, on the cover. */
  readonly name: string;
  /** What the contents lists: the top-level chapters, then the files at the root. */
  readonly contents: readonly string[];
  /** Every entry, in reading order. */
  readonly entries: readonly JournalEntry[];
  /** The entry about a directory, a file or a definition, by its path or id. */
  entry(of: string): JournalEntry | undefined;
}

interface Item {
  readonly kind: JournalEntry["kind"];
  readonly of: string;
  readonly name: string;
}

/** As a file explorer sorts names: by letter, ignoring case, with numbers in numeric order. */
const byName = (a: Item, b: Item): number => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }) || (a.of < b.of ? -1 : a.of > b.of ? 1 : 0);

const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const list = m.get(k);
  if (list === undefined) m.set(k, [v]);
  else list.push(v);
};

/** The parts of a world the journal reads: its places and things, and what holds each. */
export interface JournalSource {
  readonly name: string;
  readonly areas: readonly Pick<CodeArea, "path" | "name" | "parent">[];
  readonly patches: readonly Pick<CodePatch, "path" | "name" | "area">[];
  readonly symbols: readonly Pick<CodeSymbol, "id" | "file" | "parent" | "name" | "line">[];
}

export function journalOf(world: JournalSource): Journal {
  // What each page lists, by what it is about: "" is the root, whose list is the contents.
  const chapters = new Map<string, Item[]>();
  const files = new Map<string, Item[]>();
  const definitions = new Map<string, { item: Item; line: number }[]>();
  for (const a of world.areas) if (a.parent !== null) push(chapters, a.parent, { kind: "chapter", of: a.path, name: a.name });
  for (const p of world.patches) push(files, p.area, { kind: "file", of: p.path, name: p.name });
  for (const s of world.symbols) push(definitions, s.parent ?? s.file, { item: { kind: "definition", of: s.id, name: s.name }, line: s.line });
  const listOf = (kind: JournalEntry["kind"] | "root", of: string): Item[] =>
    kind === "chapter" || kind === "root"
      ? [...(chapters.get(of) ?? []).sort(byName), ...(files.get(of) ?? []).sort(byName)]
      : (definitions.get(of) ?? []).sort((a, b) => a.line - b.line || byName(a.item, b.item)).map((d) => d.item);

  const entries: JournalEntry[] = [];
  const index = new Map<string, JournalEntry>();
  const visit = (item: Item, under: string | undefined): void => {
    const lists = listOf(item.kind, item.of);
    const entry: JournalEntry = { ...item, ...(under === undefined ? {} : { under }), lists: lists.map((l) => l.of), page: 2 * entries.length + 1 };
    entries.push(entry);
    index.set(entry.of, entry);
    for (const l of lists) visit(l, item.of);
  };
  const contents = listOf("root", "");
  for (const item of contents) visit(item, undefined);
  return { name: world.name, contents: contents.map((c) => c.of), entries, entry: (of) => index.get(of) };
}
