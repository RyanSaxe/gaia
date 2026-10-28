// Builds the traveller's journal, a book with a page for every place and thing
// in the world, in the order a file explorer lists the code. A directory's
// chapter holds its subdirectories' chapters, then its files. A file's
// definitions follow it in source order, each followed by the ones nested in it.
//
// Every entry opens on a spread. The left-hand page pictures it, and the
// right-hand page names it and lists or shows what it holds, continuing onto
// later pages when the list is long. A container lists its own thing first:
// a directory's entity, or a file's own code. The repository's entity comes
// first of all. This module records only each entry's subject, list and pages,
// and the journal UI draws the rest.

import type { CodeArea, CodePatch, CodePlant, CodeSymbol, CodeThing, CodeTrail } from "./code-world.ts";

export interface JournalEntry {
  /**
   * "chapter" is a directory and "entity" is the thing a directory appears as.
   * "own" is the own code of a file with definitions, as a thing of its own.
   */
  readonly kind: "chapter" | "entity" | "file" | "own" | "definition";
  /** Its subject: a directory or file path, a definition id `<file>#<name>`, `entity:<path>` or `own:<path>`. */
  readonly of: string;
  readonly name: string;
  /** The `of` of its parent entry. Top-level chapters, root files and the repository's entity have none. */
  readonly under?: string;
  /** The `of` of each entry its page lists. An entity without a README lists what its folder holds. */
  readonly lists: readonly string[];
  /** The file whose text the page shows instead of a list. For an entity, it is the folder's README. */
  readonly text?: string;
  /** Its first right-hand page, which names it. The left-hand page before it holds its picture. */
  readonly page: number;
  /** Pages its text takes from `page` on. A list too long for one page continues on the next. */
  readonly pages: number;
  /** Rows on its first page, before the list, for a snippet of its most important definition or file. */
  readonly lead?: number;
  /** An entity's trails by direction. `uses` are the entities it imports from, and `usedBy` those that import from it. */
  readonly uses?: readonly string[];
  readonly usedBy?: readonly string[];
}

export interface Journal {
  /** The repository's name, on the cover. */
  readonly name: string;
  /** The contents page: the repository's entity, the top-level chapters, then the root files. */
  readonly contents: readonly string[];
  /** Every entry, in reading order. */
  readonly entries: readonly JournalEntry[];
  /** Looks up an entry by its `of`. */
  entry(of: string): JournalEntry | undefined;
}

/** List rows per page: `first` on the first page under its heading, and `next` on each continuation page. */
export interface PageRoom {
  readonly first: number;
  readonly next: number;
  /** Rows a first page gives to a snippet of its most important definition or file, when it holds two or more. */
  readonly lead?: number;
}

/** The world fields `journalOf` reads. */
export interface JournalSource {
  readonly name: string;
  readonly areas: readonly Pick<CodeArea, "path" | "name" | "parent">[];
  readonly patches: readonly Pick<CodePatch, "path" | "name" | "area">[];
  readonly symbols: readonly Pick<CodeSymbol, "id" | "file" | "parent" | "name" | "line">[];
  /** Buildings and landmarks. Only an entity's gets its own spread, since a file's or definition's is shown on that file's or definition's page. */
  readonly things?: readonly Pick<CodeThing, "path" | "name" | "of">[];
  /** Files and entities that appear as flowers, a stone, a bush or a tree. */
  readonly plants?: readonly Pick<CodePlant, "path" | "name" | "of">[];
  readonly trails?: readonly Pick<CodeTrail, "from" | "to">[];
}

/** The `of` of the entry about the thing a directory appears as. */
export const entityOf = (path: string): string => `entity:${path}`;
/** The `of` of the entry about a file's own code, for a file with definitions. */
export const ownOf = (path: string): string => `own:${path}`;

interface Item {
  readonly kind: JournalEntry["kind"];
  readonly of: string;
  readonly name: string;
}

/** Sorts names like a file explorer: by letter, ignoring case, with numbers in numeric order. */
const byName = (a: Item, b: Item): number => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }) || (a.of < b.of ? -1 : a.of > b.of ? 1 : 0);

const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const list = m.get(k);
  if (list === undefined) m.set(k, [v]);
  else list.push(v);
};

export function journalOf(world: JournalSource, room: PageRoom = { first: Infinity, next: Infinity }): Journal {
  // Child items by parent path. "" is the root, whose list is the contents.
  const chapters = new Map<string, Item[]>();
  const files = new Map<string, Item[]>();
  const definitions = new Map<string, { item: Item; line: number }[]>();
  for (const a of world.areas) if (a.parent !== null) push(chapters, a.parent, { kind: "chapter", of: a.path, name: a.name });
  for (const p of world.patches) push(files, p.area, { kind: "file", of: p.path, name: p.name });
  for (const s of world.symbols) push(definitions, s.parent ?? s.file, { item: { kind: "definition", of: s.id, name: s.name }, line: s.line });
  // Every entity gets a spread for its thing, whatever form it has.
  const things = new Map([...(world.things ?? []).filter((t) => (t.of ?? "entity") === "entity"), ...(world.plants ?? []).filter((t) => t.of === "entity")].map((t) => [t.path, t]));
  // A trail runs from the importing entity to the entity it imports from.
  const usesOf = new Map<string, Set<string>>();
  const usedByOf = new Map<string, Set<string>>();
  for (const t of world.trails ?? []) {
    if (!things.has(t.from) || !things.has(t.to) || t.from === t.to) continue;
    if (!usesOf.has(t.from)) usesOf.set(t.from, new Set());
    if (!usedByOf.has(t.to)) usedByOf.set(t.to, new Set());
    usesOf.get(t.from)?.add(t.to);
    usedByOf.get(t.to)?.add(t.from);
  }
  const entityItem = (path: string): Item => ({ kind: "entity", of: entityOf(path), name: things.get(path)?.name ?? path });
  /** Each folder's README, which its entity's page shows. */
  const readmes = new Map<string, string>();
  for (const p of world.patches) if (/^readme(\.(md|markdown|txt|rst))?$/i.test(p.name) && !readmes.has(p.area)) readmes.set(p.area, p.path);
  const listOf = (item: Item | { kind: "root"; of: string }): Item[] => {
    // A container lists its own thing first.
    if (item.kind === "chapter" || item.kind === "root") return [...(things.has(item.of) ? [entityItem(item.of)] : []), ...(chapters.get(item.of) ?? []).sort(byName), ...(files.get(item.of) ?? []).sort(byName)];
    if (item.kind === "entity") {
      // An entity's page shows its folder's README. Without one, it lists the folder's contents so the reader can go deeper.
      const folder = item.of.slice("entity:".length);
      return readmes.has(folder) ? [] : [...(chapters.get(folder) ?? []).sort(byName), ...(files.get(folder) ?? []).sort(byName)];
    }
    if (item.kind === "own") return [];
    const held = (definitions.get(item.of) ?? []).sort((a, b) => a.line - b.line || byName(a.item, b.item)).map((d) => d.item);
    return item.kind === "file" && held.length > 0 ? [{ kind: "own", of: ownOf(item.of), name: item.name }, ...held] : held;
  };
  /** Rows on the page about `item`. A file counts every definition in it, nested ones included. */
  const rowsOf = (item: Item, lists: readonly Item[]): number => {
    if (item.kind === "definition" || item.kind === "own") return 0;
    if (item.kind !== "file") return lists.length;
    // A file with definitions has a row for its own code, then one per definition.
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
    // A file with two or more definitions, or a folder with two or more files, opens with a snippet of its most
    // important one. The snippet takes rows of its first page.
    const parts = item.kind === "file" ? rows - 1 : item.kind === "chapter" ? (files.get(item.of)?.length ?? 0) : 0;
    const lead = parts >= 2 ? (room.lead ?? 0) : 0;
    const pages = pagesFor(rows + lead);
    const text = item.kind === "entity" ? readmes.get(item.of.slice("entity:".length)) : undefined;
    const folder = item.kind === "entity" ? item.of.slice("entity:".length) : null;
    const way = (m: ReadonlyMap<string, ReadonlySet<string>>): string[] => [...(m.get(folder as string) ?? [])].map(entityItem).sort(byName).map((i) => i.of);
    const trails = folder === null ? {} : { uses: way(usesOf), usedBy: way(usedByOf) };
    const entry: JournalEntry = { ...item, ...(under === undefined ? {} : { under }), lists: lists.map((l) => l.of), ...(text === undefined ? {} : { text }), page: picture + 1, pages, ...(lead > 0 ? { lead } : {}), ...trails };
    entries.push(entry);
    index.set(entry.of, entry);
    // The next picture needs a left-hand page. Text that ends on a left-hand page leaves the right-hand page after it blank.
    picture += pages % 2 === 1 ? pages + 1 : pages + 2;
  };
  const visit = (item: Item, under: string | undefined): void => {
    const lists = listOf(item);
    add(item, under, lists);
    // Don't recurse into an entity's list, since those entries follow in the folder's own chapter. An own entry lists nothing.
    if (item.kind !== "entity" && item.kind !== "own") for (const l of lists) visit(l, item.of);
  };
  const contents = listOf({ kind: "root", of: "" });
  for (const item of contents) visit(item, undefined);
  return { name: world.name, contents: contents.map((c) => c.of), entries, entry: (of) => index.get(of) };
}
