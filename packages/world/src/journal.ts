// The traveller's journal: a book with a page for every place and thing in
// the world, in the order a file explorer lists the code. Each directory is a
// chapter, its subdirectories chapters inside it, then its files; each file's
// definitions follow it in the order they are written, and the definitions
// inside one follow it. A container (a directory, or a file with definitions)
// opens on its map facing what it holds, and the first thing it holds is
// itself as a thing: a directory standing as a building or a landmark has
// that entity's spread first, and a file has its own, its painting facing its
// own code. A leaf (a definition, or a file with nothing standing in it) is
// its picture facing its content. A folder's thing faces the folder's
// README, or with none the things its trails join it to. The repository's own
// entity comes first of all. Every entry opens on a spread: the left-hand page pictures it, and the
// right-hand page names it and lists or shows what it holds, a long list
// running on over the pages after. The book says only what each page is
// about, what it lists and its pages; the journal draws the rest.

import type { CodeArea, CodePatch, CodeStanding, CodeSymbol, CodeThing, CodeTrail } from "./code-world.ts";

export interface JournalEntry {
  /**
   * A chapter is a directory, an entity is the thing a directory stands as, a
   * file is a file, its own is a file with definitions as a thing of its own
   * (its own code), and a definition one of its definitions.
   */
  readonly kind: "chapter" | "entity" | "file" | "own" | "definition";
  /** What it is about: a directory's or a file's path, a definition's id (`<file>#<name>`), `entity:<path>` or `own:<path>`. */
  readonly of: string;
  readonly name: string;
  /** The entry it sits under; a top-level chapter, a file at the root and the repository's entity sit under none. */
  readonly under?: string;
  /** What its page lists, each an entry of its own: what it holds, or for an entity the entities its trails join it to. */
  readonly lists: readonly string[];
  /** The file whose text a thing's page shows instead of a list: a folder's README. */
  readonly text?: string;
  /** Its first right-hand page, which names it; the left-hand page before it pictures it. */
  readonly page: number;
  /** How many pages its words take from `page` on: a list too long for one runs on overleaf. */
  readonly pages: number;
  /** Rows its first page gives to snippets of its best and worst parts (a file's definitions, a folder's files), before its list; absent when none. */
  readonly lead?: number;
}

export interface Journal {
  /** The repository's name, on the cover. */
  readonly name: string;
  /** What the contents lists: the top-level chapters, then the files at the root. */
  readonly contents: readonly string[];
  /** Every entry, in reading order. */
  readonly entries: readonly JournalEntry[];
  /** The entry about a directory, an entity, a file or a definition, by its `of`. */
  entry(of: string): JournalEntry | undefined;
}

/** How many of a list's rows a page holds: the first page, under its heading, and each page the list runs on to. */
export interface PageRoom {
  readonly first: number;
  readonly next: number;
  /** Rows a first page gives to snippets of its best and worst parts: a file's definitions or a folder's files, when it holds two or more. */
  readonly lead?: number;
}

/** The parts of a world the journal reads: its places and things, what holds each, and the trails between things. */
export interface JournalSource {
  readonly name: string;
  readonly areas: readonly Pick<CodeArea, "path" | "name" | "parent">[];
  readonly patches: readonly Pick<CodePatch, "path" | "name" | "area">[];
  readonly symbols: readonly Pick<CodeSymbol, "id" | "file" | "parent" | "name" | "line">[];
  /** The buildings and landmarks; only an entity's has a spread of its own here, since a file's or a definition's is its own page. */
  readonly things?: readonly Pick<CodeThing, "path" | "name" | "of">[];
  /** The files and entities standing as flowers, a stone, a bush or a tree. */
  readonly standing?: readonly Pick<CodeStanding, "path" | "name" | "of">[];
  readonly trails?: readonly Pick<CodeTrail, "from" | "to">[];
}

/** The entry about the entity a directory stands as. */
export const entityOf = (path: string): string => `entity:${path}`;
/** The entry about a file with definitions as a thing of its own: its own code. */
export const ownOf = (path: string): string => `own:${path}`;

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

export function journalOf(world: JournalSource, room: PageRoom = { first: Infinity, next: Infinity }): Journal {
  // What each page lists, by what it is about: "" is the root, whose list is the contents.
  const chapters = new Map<string, Item[]>();
  const files = new Map<string, Item[]>();
  const definitions = new Map<string, { item: Item; line: number }[]>();
  for (const a of world.areas) if (a.parent !== null) push(chapters, a.parent, { kind: "chapter", of: a.path, name: a.name });
  for (const p of world.patches) push(files, p.area, { kind: "file", of: p.path, name: p.name });
  for (const s of world.symbols) push(definitions, s.parent ?? s.file, { item: { kind: "definition", of: s.id, name: s.name }, line: s.line });
  // Every entity has its thing's spread, whatever it stands as.
  const things = new Map([...(world.things ?? []).filter((t) => (t.of ?? "entity") === "entity"), ...(world.standing ?? []).filter((t) => t.of === "entity")].map((t) => [t.path, t]));
  const joined = new Map<string, Set<string>>();
  for (const t of world.trails ?? []) {
    if (!things.has(t.from) || !things.has(t.to) || t.from === t.to) continue;
    if (!joined.has(t.from)) joined.set(t.from, new Set());
    if (!joined.has(t.to)) joined.set(t.to, new Set());
    joined.get(t.from)?.add(t.to);
    joined.get(t.to)?.add(t.from);
  }
  const entityItem = (path: string): Item => ({ kind: "entity", of: entityOf(path), name: things.get(path)?.name ?? path });
  /** Each folder's README, which its thing's page shows. */
  const readmes = new Map<string, string>();
  for (const p of world.patches) if (/^readme(\.(md|markdown|txt|rst))?$/i.test(p.name) && !readmes.has(p.area)) readmes.set(p.area, p.path);
  const listOf = (item: Item | { kind: "root"; of: string }): Item[] => {
    // A container's first row is itself as a thing.
    if (item.kind === "chapter" || item.kind === "root") return [...(things.has(item.of) ? [entityItem(item.of)] : []), ...(chapters.get(item.of) ?? []).sort(byName), ...(files.get(item.of) ?? []).sort(byName)];
    if (item.kind === "entity") {
      const folder = item.of.slice("entity:".length);
      return readmes.has(folder) ? [] : [...(joined.get(folder) ?? [])].map(entityItem).sort(byName);
    }
    if (item.kind === "own") return [];
    const held = (definitions.get(item.of) ?? []).sort((a, b) => a.line - b.line || byName(a.item, b.item)).map((d) => d.item);
    return item.kind === "file" && held.length > 0 ? [{ kind: "own", of: ownOf(item.of), name: item.name }, ...held] : held;
  };
  /** How many rows a page about `item` lists: a file lists every definition in it, nested ones included. */
  const rowsOf = (item: Item, lists: readonly Item[]): number => {
    if (item.kind === "definition" || item.kind === "own") return 0;
    if (item.kind !== "file") return lists.length;
    // A file lists itself, when it holds definitions, then every definition in it.
    let n = lists.length > 0 ? 1 : 0;
    const walk = (of: string): void => {
      for (const d of definitions.get(of) ?? []) {
        n++;
        walk(d.item.of);
      }
    };
    walk(item.of);
    return n;
  };
  const pagesFor = (rows: number): number => (rows <= room.first ? 1 : 1 + Math.ceil((rows - room.first) / room.next));

  const entries: JournalEntry[] = [];
  const index = new Map<string, JournalEntry>();
  /** The next left-hand page, where an entry's picture goes. */
  let picture = 0;
  const add = (item: Item, under: string | undefined, lists: readonly Item[]): void => {
    const rows = rowsOf(item, lists);
    // A file with two definitions or more, or a folder with two files or more, leads with snippets of its best and worst,
    // which take rows of its first page.
    const parts = item.kind === "file" ? rows - 1 : item.kind === "chapter" ? (files.get(item.of)?.length ?? 0) : 0;
    const lead = parts >= 2 ? (room.lead ?? 0) : 0;
    const pages = pagesFor(rows + lead);
    const text = item.kind === "entity" ? readmes.get(item.of.slice("entity:".length)) : undefined;
    const entry: JournalEntry = { ...item, ...(under === undefined ? {} : { under }), lists: lists.map((l) => l.of), ...(text === undefined ? {} : { text }), page: picture + 1, pages, ...(lead > 0 ? { lead } : {}) };
    entries.push(entry);
    index.set(entry.of, entry);
    // The next picture is a left-hand page: an entry whose words end on a right-hand page leaves the page after it blank.
    picture += pages % 2 === 1 ? pages + 1 : pages + 2;
  };
  const visit = (item: Item, under: string | undefined): void => {
    const lists = listOf(item);
    add(item, under, lists);
    // An entity lists the things it is joined to, which have chapters of their own; its own lists nothing.
    if (item.kind !== "entity" && item.kind !== "own") for (const l of lists) visit(l, item.of);
  };
  const contents = listOf({ kind: "root", of: "" });
  for (const item of contents) visit(item, undefined);
  return { name: world.name, contents: contents.map((c) => c.of), entries, entry: (of) => index.get(of) };
}
