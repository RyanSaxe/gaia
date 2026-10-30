// Builds each journal page's `PageWords`: path, name, vitality, a definition's
// signature, then either rows or text. Chapters, entities and files with
// definitions list rows, and definitions and files show their text. The book
// draws whatever words it gets, so a new kind of page needs no change to the
// book.

import { type CodeSymbol, type CodeWorld, type Journal, type JournalEntry, areaVitality, entityOf } from "@gaia/world";
import type { JudgedThing } from "../../world-service/protocol.ts";

/**
 * Maps a page id to the id of its thing in the world. `entity:<path>` maps to the entity's path, `own:<file>` to the
 * file, and any other id to itself.
 */
export const thingIdOf = (of: string): string => (of.startsWith("entity:") ? of.slice("entity:".length) : of.startsWith("own:") ? of.slice("own:".length) : of);

/**
 * The vitality each page shows: a file's, a definition's or an entity's own, and a folder's pooled from every file
 * under it, weighted by patch area, as the map's wash pools them. A definition or an entity shows its own, whatever its
 * form, a plant or stone as much as a building.
 */
export function pageVitality(code: CodeWorld): (of: string) => number {
  const pooled = areaVitality(code.patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
  const entities = [...code.things, ...code.naturalThings.filter((s) => s.of === "entity")];
  const own = new Map([...code.patches.map((p) => [p.path, p.vitality] as const), ...code.symbols.map((d) => [d.id, d.vitality] as const), ...entities.map((e) => [entityOf(e.path), e.vitality] as const)]);
  return (of) => own.get(of) ?? own.get(thingIdOf(of)) ?? pooled.get(of) ?? 1;
}

/**
 * A block Jev picked in a definition's lines: the one key to understanding it,
 * or the one that most needs work. Only the appendix shows marks.
 */
export interface Mark {
  readonly kind: "understand" | "improve";
}

/** One row of a list, indented by its depth under the page's subject. */
export interface Row {
  readonly of: string;
  readonly name: string;
  readonly depth: number;
  readonly vitality: number;
  /** Jev's importance, 0 to 1. Absent until the understanding pass judges it. */
  readonly importance?: number;
  readonly page: number;
}

export interface Rows {
  readonly kind: "rows";
  readonly rows: readonly Row[];
  /** The snippet a file's or folder's first page leads with, from its most important definition. */
  readonly lead?: Snippet;
}

/**
 * A short view of a definition: its signature, then its key block, with the
 * lines between and after folded. A tap on its name turns to the page of the
 * part it belongs to, and a tap on its code turns to the definition in full.
 */
export interface Snippet {
  /** The part it represents, a folder's file or a file's definition, with its name and page. */
  readonly of: string;
  readonly name: string;
  readonly page: number;
  /** The definition whose code it shows. The appendix has it in full. */
  readonly shows: string;
  /** The definition's first line and its line number. */
  readonly signature: { readonly n: number; readonly text: string };
  /** The shown block's lines, starting at line `first`. */
  readonly first: number;
  readonly lines: readonly string[];
  /** How many lines are folded between the signature and the block, and after the block. */
  readonly before: number;
  readonly after: number;
}

/** How many of a block's lines a snippet shows. The rest are folded. */
const SNIPPET_LINES = 3;

/** The line range of a definition that has its own page. It shows as one line that turns to that page. */
export interface Folded {
  readonly from: number;
  readonly to: number;
  readonly of: string;
  readonly page: number;
}

/** Text for a page: numbered code lines, or a document's lines as prose. */
interface Text {
  /** Its lines, numbered from `first`. Empty until the file's text arrives. */
  readonly first: number;
  readonly lines: readonly string[];
  /** The line ranges Jev marked. */
  readonly marks: readonly (Mark & { readonly from: number; readonly to: number })[];
  readonly folded?: readonly Folded[];
  /** Whether it is set as prose: a document's text, with one paragraph per line. */
  readonly prose?: boolean;
  /** Which of a document's lines are fenced code. */
  readonly pre?: readonly boolean[];
  /** How many lines of a file too long to set are left out after these. */
  readonly rest?: number;
}

export interface Code extends Text {
  readonly kind: "code";
  /** The line the page opens on. */
  readonly opensAt: number;
}

/** A definition or a file in full, for the appendix: every line of its text. */
export interface Full extends Text {
  readonly kind: "full";
}

export interface PageWords {
  /** Its folders, outermost first, with the file last for a definition: ["app", "world-service", "open-world.ts"]. */
  readonly path: readonly string[];
  readonly name: string;
  readonly vitality: number;
  /** Jev's importance, 0 to 1. Absent until the understanding pass judges it. */
  readonly importance?: number;
  /** A definition's first line. */
  readonly signature?: string;
  readonly body: Rows | Code | Full;
  /** An entity's trails at the foot of its page: the entities it imports from and those that import from it. */
  readonly trails?: { readonly uses: readonly Row[]; readonly usedBy: readonly Row[] };
}

/** The data words are built from: the journal, the world, vitality by id, and each file's text once it arrives. */
export interface WordsSource {
  readonly journal: Journal;
  readonly world: { readonly name: string; readonly symbols: readonly Pick<CodeSymbol, "id" | "kind" | "line" | "lines">[] };
  /** Vitality by id: a folder's or file's path, a definition's id, or an entity's `entity:<path>`. */
  vitality(of: string): number;
  /** A file's lines, or undefined until they arrive. */
  lines(path: string): readonly string[] | undefined;
  /** What the understanding pass judged about a folder, file or definition, every score from 0 to 1. */
  thing?(of: string): JudgedThing | undefined;
}

/** The part with the highest Jev importance, or undefined before the understanding pass judges any. */
export function mostImportant(src: WordsSource, parts: readonly string[]): string | undefined {
  let top: { readonly of: string; readonly importance: number } | undefined;
  for (const of of parts) {
    const importance = src.thing?.(of)?.importance;
    if (importance != null && (top === undefined || importance > top.importance)) top = { of, importance };
  }
  return top?.of;
}

/** Every definition in a file, including nested ones. */
function definitionsOf(src: WordsSource, file: string): string[] {
  const all: string[] = [];
  const gather = (of: string): void => {
    const d = src.journal.entry(of);
    if (d?.kind === "definition") all.push(of);
    for (const inner of d?.lists ?? []) gather(inner);
  };
  for (const of of src.journal.entry(file)?.lists ?? []) gather(of);
  return all;
}

/** The candidates for a page's lead: a folder's files, or a file's definitions. */
const partsOf = (src: WordsSource, e: JournalEntry): string[] => (e.kind === "file" ? definitionsOf(src, e.of) : e.lists.filter((of) => src.journal.entry(of)?.kind === "file"));

/**
 * A page's lead snippet: a file's most important definition, or for a folder,
 * the most important definition of its most important file. It shows the
 * signature and key block with the rest folded, and no marks, since only the
 * appendix shows Jev's marks.
 */
function leadOf(src: WordsSource, e: JournalEntry): Snippet | undefined {
  if (e.lead === undefined) return undefined;
  const part = mostImportant(src, partsOf(src, e));
  const shown = part === undefined ? undefined : src.journal.entry(part);
  const of = shown?.kind === "file" ? mostImportant(src, definitionsOf(src, shown.of)) : part;
  const symbol = src.world.symbols.find((s) => s.id === of);
  if (part === undefined || shown === undefined || of === undefined || symbol === undefined) return undefined;
  const text = src.lines(symbol.id.slice(0, symbol.id.indexOf("#")));
  if (text === undefined) return undefined;
  const end = symbol.line + symbol.lines - 1;
  const block = src.thing?.(of)?.picks.key ?? { start: symbol.line + 1, end };
  const first = Math.max(symbol.line + 1, block.start);
  const last = Math.min(block.end, first + SNIPPET_LINES - 1, end);
  return {
    of: part,
    name: shown.name,
    page: shown.page,
    shows: of,
    signature: { n: symbol.line, text: text[symbol.line - 1] ?? "" },
    first,
    lines: text.slice(first - 1, last),
    before: first - symbol.line - 1,
    after: Math.max(0, end - last),
  };
}

/** The file a page's lead shows text from: a file's own, or a folder's most important file. */
export function leadFiles(src: WordsSource, e: JournalEntry): string[] {
  if (e.lead === undefined) return [];
  if (e.kind === "file") return [e.of];
  const file = mostImportant(src, partsOf(src, e));
  return file === undefined ? [] : [file];
}

/** A page's importance, when the understanding pass has judged it. */
const importanceOf = (src: WordsSource, of: string): { importance?: number } => {
  const i = src.thing?.(of)?.importance;
  return i == null ? {} : { importance: i };
};

const folders = (path: string): string[] => path.split("/").slice(0, -1);

/** The contents page's words: each top-level entry, with each top chapter's subchapters under it. */
export function contentsWords(src: WordsSource): PageWords {
  const rows: Row[] = [];
  for (const of of src.journal.contents) {
    const e = src.journal.entry(of) as JournalEntry;
    rows.push(rowOf(src, e, 0));
    if (e.kind === "chapter") for (const sub of e.lists) if (src.journal.entry(sub)?.kind === "chapter") rows.push(rowOf(src, src.journal.entry(sub) as JournalEntry, 1));
  }
  return { path: [], name: src.world.name, vitality: src.vitality(""), body: { kind: "rows", rows } };
}

function rowOf(src: WordsSource, e: JournalEntry, depth: number): Row {
  return { of: e.of, name: e.name, depth, vitality: src.vitality(e.of), ...importanceOf(src, e.of), page: e.page };
}

const rowsOf = (src: WordsSource, ofs: readonly string[]): Row[] => ofs.map((of) => rowOf(src, src.journal.entry(of) as JournalEntry, 0));

/**
 * Builds one entry's page words. With `marked`, a definition's code carries
 * Jev's marks, for the appendix. Its journal page shows the code without marks.
 */
export function wordsOf(src: WordsSource, e: JournalEntry, marked = false): PageWords {
  if (e.kind === "entity" && e.text === undefined) {
    // An entity with no README lists its folder's contents, with its trails at the foot.
    const path = e.of.slice("entity:".length);
    return { path: path === "" ? [] : path.split("/"), name: e.name, vitality: src.vitality(e.of), body: { kind: "rows", rows: rowsOf(src, e.lists) }, trails: { uses: rowsOf(src, e.uses ?? []), usedBy: rowsOf(src, e.usedBy ?? []) } };
  }
  if (e.kind === "chapter") {
    const lead = leadOf(src, e);
    return { path: folders(e.of), name: e.name, vitality: src.vitality(e.of), ...importanceOf(src, e.of), body: { kind: "rows", rows: rowsOf(src, e.lists), ...(lead === undefined ? {} : { lead }) } };
  }
  if (e.kind === "file" && e.lists.length > 0) {
    // A file with definitions lists its own page first, then every definition in it, with nested ones indented under
    // their parent.
    const lead = leadOf(src, e);
    const rows: Row[] = [];
    const walk = (of: string, depth: number): void => {
      const d = src.journal.entry(of) as JournalEntry;
      rows.push(rowOf(src, d, depth));
      for (const inner of d.lists) walk(inner, depth + 1);
    };
    for (const of of e.lists) walk(of, 0);
    return { path: folders(e.of), name: e.name, vitality: src.vitality(e.of), ...importanceOf(src, e.of), body: { kind: "rows", rows, ...(lead === undefined ? {} : { lead }) } };
  }
  if (e.kind === "own" || e.kind === "file" || e.kind === "entity") {
    // The page's own text. A file's own page shows the file with each definition folded after its first line, a file
    // without definitions shows its whole text, and an entity shows its README.
    const file = fileOfEntry(e) as string;
    const held = e.kind === "own" ? (src.journal.entry(file)?.lists ?? []) : [];
    const folded = held.flatMap((of): Folded[] => {
      const s = src.world.symbols.find((d) => d.id === of);
      const d = src.journal.entry(of);
      return s === undefined || d === undefined || s.lines < 2 ? [] : [{ from: s.line + 1, to: s.line + s.lines - 1, of, page: d.page }];
    });
    const set = setOf(src.lines(file));
    const prose = PROSE.test(file) ? proseOf(set.lines) : null;
    const text = prose === null ? set : { ...set, lines: prose.lines };
    const thing = e.of.slice("entity:".length);
    return {
      path: e.kind !== "entity" ? folders(file) : thing === "" ? [] : thing.split("/"),
      name: e.name,
      vitality: src.vitality(e.of),
      ...importanceOf(src, e.of),
      body: { kind: "code", first: 1, lines: text.lines, opensAt: 1, marks: [], ...(folded.length > 0 ? { folded } : {}), ...(prose === null ? {} : { prose: true, pre: prose.pre }), ...(text.rest > 0 ? { rest: text.rest } : {}) },
    };
  }
  const symbol = src.world.symbols.find((s) => s.id === e.of);
  const file = e.of.slice(0, e.of.indexOf("#"));
  const text = setOf(src.lines(file)).lines;
  const line = symbol?.line ?? 1;
  const count = symbol?.lines ?? 1;
  const signature = text?.[line - 1]?.trim();
  // The blocks Jev picked: the key block and the weakest block. A definition longer than `FITS` lines opens at its key block.
  const { key, weak } = src.thing?.(e.of)?.picks ?? {};
  // Where the two overlap, the gutter shows the weak mark, which comes first.
  const marks = !marked ? [] : [...(weak === undefined ? [] : [{ kind: "improve" as const, from: weak.start, to: weak.end }]), ...(key === undefined ? [] : [{ kind: "understand" as const, from: key.start, to: key.end }])];
  const opensAt = count - 1 > FITS && key !== undefined ? key.start : line + 1;
  return {
    path: file.split("/"),
    name: e.name,
    vitality: src.vitality(e.of),
    ...importanceOf(src, e.of),
    ...(signature === undefined ? {} : { signature }),
    body: { kind: "code", first: line + 1, lines: text.slice(line, line + count - 1), opensAt, marks },
  };
}

/** The file whose text an entry's page shows: a definition's file, a file's own page, a file without definitions, or an entity's README. */
export function fileOfEntry(e: JournalEntry): string | undefined {
  if (e.kind === "definition") return e.of.slice(0, e.of.indexOf("#"));
  if (e.kind === "own") return e.of.slice("own:".length);
  if (e.kind === "file" && e.lists.length === 0) return e.of;
  if (e.kind === "entity") return e.text;
  return undefined;
}

/** File extensions of documents, whose text is set as prose. */
const PROSE = /\.(md|mdx|markdown|txt|rst)$/i;
/**
 * Converts a document's lines to paragraphs. Hard-wrapped lines join into
 * one. Headings, table rows and markup lines stand alone, list items and
 * quotes start a new paragraph, and list items get a bullet. A fenced block's
 * lines are kept as code without the fences. Links and images keep their
 * text, and bold and inline code marks are dropped.
 */
export function proseOf(lines: readonly string[]): { readonly lines: readonly string[]; readonly pre: readonly boolean[] } {
  const out: string[] = [];
  const pre: boolean[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length === 0) return;
    out.push(paragraph.join(" "));
    pre.push(false);
    paragraph = [];
  };
  const inline = (line: string): string =>
    line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1");
  let fenced = false;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(raw);
      pre.push(true);
      continue;
    }
    const line = inline(raw).trim();
    if (line === "") {
      flush();
      // Keeps one blank line between paragraphs, however many the source has.
      if (out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
        pre.push(false);
      }
    } else if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<)/.test(line)) {
      flush();
      // A list item is set with a bullet.
      paragraph = [line.replace(/^[-*+]\s+/, "• ")];
      // A heading, table row or markup line stands alone. A list item or quote continues over its following lines.
      if (/^(#{1,6}\s|\||<)/.test(line)) flush();
    } else paragraph.push(line);
  }
  flush();
  return { lines: out, pre };
}

/** The most of a file the journal sets: `lines` lines, each cut at `chars` characters, since a one-line data file can be half a megabyte. */
const SET = { lines: 2000, chars: 1500 } as const;
/**
 * A file's text as the journal sets it, and how many lines are left out. It
 * returns no lines for a binary file, such as an image, or before the text
 * arrives.
 */
function setOf(lines: readonly string[] | undefined): { readonly lines: readonly string[]; readonly rest: number } {
  if (lines === undefined || lines.slice(0, 50).some((l) => l.includes("\u0000") || l.includes("\uFFFD"))) return { lines: [], rest: 0 };
  return { lines: lines.slice(0, SET.lines).map((l) => (l.length > SET.chars ? `${l.slice(0, SET.chars)} …` : l)), rest: Math.max(0, lines.length - SET.lines) };
}

/** About how many lines after its signature a definition's page holds. */
const FITS = 24;

/**
 * A definition's or file's words for the appendix: its name, then its full
 * text with Jev's marks, which only the appendix shows. Jev's other judgments
 * appear on its page and caption.
 */
export function appendixWords(src: WordsSource, e: JournalEntry): PageWords {
  const page = wordsOf(src, e, true);
  if (page.body.kind !== "code") return page;
  const { opensAt: _, kind: __, ...text } = page.body;
  return { ...page, body: { ...text, kind: "full" } };
}
