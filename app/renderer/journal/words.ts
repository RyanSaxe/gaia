// What a page of the journal says. Every page says the same few things in
// the same shape: where it lives, its name, its vitality, a definition's
// signature as the code writes it, then either a list or text. The contents,
// a chapter, an entity and a file with definitions list rows (each one's
// name, vitality and page); a definition is its code, a file with
// definitions as a thing of its own is its own code with each definition
// folded to a line that turns to its page, and a file with none is its whole
// text, a document's set as prose. The book draws whatever words it is
// handed, so a new kind of page needs nothing new in the book.

import type { CodeSymbol, Journal, JournalEntry } from "@gaia/world";
import type { JudgedThing } from "../../world-service/protocol.ts";

/**
 * What Jev points out in a definition's lines, which only the appendix marks:
 * the block key to understanding it, and the block that most needs work.
 */
export interface Mark {
  readonly kind: "understand" | "improve";
}

/** One line of a list, indented by how deep it sits under the page's own subject. */
export interface Row {
  readonly of: string;
  readonly name: string;
  readonly depth: number;
  readonly vitality: number;
  /** How much it matters, 0 to 1, Jev's importance; absent before the understanding pass has judged it. */
  readonly importance?: number;
  readonly page: number;
}

export interface Rows {
  readonly kind: "rows";
  readonly rows: readonly Row[];
  /** What a file's or folder's first page leads with: a snippet of the definition that matters most. */
  readonly lead?: Snippet;
}

/**
 * A definition at a glance: its first line, then its key block, with the
 * lines between and after folded away, as the definition's own page opens on
 * it. A tap on its name turns to the part of the page it stands for; a tap on
 * its code, to the definition in full.
 */
export interface Snippet {
  /** The part of the page it stands for, a file of a folder or a definition of a file, its name and page. */
  readonly of: string;
  readonly name: string;
  readonly page: number;
  /** The definition whose code it shows, which the appendix holds in full. */
  readonly shows: string;
  /** Its first line, as the code writes it, and that line's number. */
  readonly signature: { readonly n: number; readonly text: string };
  /** The block shown, from the number of its first line. */
  readonly first: number;
  readonly lines: readonly string[];
  /** How many lines are folded away between its first line and the block, and after the lines shown. */
  readonly before: number;
  readonly after: number;
}

/** How many of a block's lines a snippet shows: the rest fold away. */
const SNIPPET_LINES = 3;

/** A run of a file's lines that is a definition with a page of its own, shown as one line that turns to it. */
export interface Folded {
  readonly from: number;
  readonly to: number;
  readonly of: string;
  readonly page: number;
}

/** How text is set: lines numbered by hand down a gutter, and a document's lines as prose. */
interface Text {
  /** Its lines, numbered from `first`; empty until its file's text arrives. */
  readonly first: number;
  readonly lines: readonly string[];
  /** The lines Jev points out, by line number. */
  readonly marks: readonly (Mark & { readonly from: number; readonly to: number })[];
  readonly folded?: readonly Folded[];
  /** Set as prose, not code: a document's text, its lines its paragraphs. */
  readonly prose?: boolean;
  /** Which of a document's lines are set as code: a fenced block's. */
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
  /** The folders it lives in, outermost first, its file last for a definition: ["app", "world-service", "open-world.ts"]. */
  readonly path: readonly string[];
  readonly name: string;
  readonly vitality: number;
  /** How much it matters, 0 to 1, Jev's importance; absent before the understanding pass has judged it. */
  readonly importance?: number;
  /** A definition's first line, as the code writes it. */
  readonly signature?: string;
  readonly body: Rows | Code | Full;
  /** An entity's trails, at its page's foot, by their way: the entities it imports from, and those that import from it. */
  readonly trails?: { readonly uses: readonly Row[]; readonly usedBy: readonly Row[] };
}

/** What the words are read from: the world, each place's and file's vitality, and a file's text once it has arrived. */
export interface WordsSource {
  readonly journal: Journal;
  readonly world: { readonly name: string; readonly symbols: readonly Pick<CodeSymbol, "id" | "kind" | "line" | "lines">[] };
  /** Each item's own vitality: a folder's, a file's by its path, a definition's by its id, or an entity's by `entity:<path>`. */
  vitality(of: string): number;
  /** A file's lines, or undefined until they arrive. */
  lines(path: string): readonly string[] | undefined;
  /** What the understanding pass judged about a folder, file or definition, every score from 0 to 1. */
  thing?(of: string): JudgedThing | undefined;
}

/** The one of `parts` that matters most, by Jev's importance; none before the understanding pass has judged any. */
export function mostImportant(src: WordsSource, parts: readonly string[]): string | undefined {
  let top: { readonly of: string; readonly importance: number } | undefined;
  for (const of of parts) {
    const importance = src.thing?.(of)?.importance;
    if (importance != null && (top === undefined || importance > top.importance)) top = { of, importance };
  }
  return top?.of;
}

/** Every definition in a file, the ones inside another included. */
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

/** A folder's files, or a file's definitions: what a page's lead is chosen from. */
const partsOf = (src: WordsSource, e: JournalEntry): string[] => (e.kind === "file" ? definitionsOf(src, e.of) : e.lists.filter((of) => src.journal.entry(of)?.kind === "file"));

/**
 * A page's lead: a snippet of its part that matters most, a file's most
 * important definition, or a folder's most important file shown by that
 * file's most important definition. It shows the definition's first line and
 * its key block, the rest folded, with nothing marked: Jev's marks are the
 * appendix's alone.
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

/** The words of the contents: the top chapters with the chapters inside them, then the files at the root. */
export function contentsWords(src: WordsSource): PageWords {
  const rows: Row[] = [];
  for (const of of src.journal.contents) {
    const e = src.journal.entry(of) as JournalEntry;
    rows.push(rowOf(src, e, 0));
    if (e.kind === "chapter") for (const sub of e.lists) if (src.journal.entry(sub)?.kind === "chapter") rows.push(rowOf(src, src.journal.entry(sub) as JournalEntry, 1));
  }
  return { path: [], name: src.world.name, vitality: src.vitality(""), body: { kind: "rows", rows } };
}

/** An entry as a row of a list. */
function rowOf(src: WordsSource, e: JournalEntry, depth: number): Row {
  return { of: e.of, name: e.name, depth, vitality: src.vitality(e.of), ...importanceOf(src, e.of), page: e.page };
}

/** The rows of entries listed by their `of`. */
const rowsOf = (src: WordsSource, ofs: readonly string[]): Row[] => ofs.map((of) => rowOf(src, src.journal.entry(of) as JournalEntry, 0));

/**
 * The words of one entry's page. `marked` gives a definition's code Jev's
 * marks, as only the appendix shows them; its page shows the code plain.
 */
export function wordsOf(src: WordsSource, e: JournalEntry, marked = false): PageWords {
  if (e.kind === "entity" && e.text === undefined) {
    // An entity with no README lists what its folder holds, and at its foot its trails by their way.
    const path = e.of.slice("entity:".length);
    return { path: path === "" ? [] : path.split("/"), name: e.name, vitality: src.vitality(e.of), body: { kind: "rows", rows: rowsOf(src, e.lists) }, trails: { uses: rowsOf(src, e.uses ?? []), usedBy: rowsOf(src, e.usedBy ?? []) } };
  }
  if (e.kind === "chapter") {
    const lead = leadOf(src, e);
    return { path: folders(e.of), name: e.name, vitality: src.vitality(e.of), ...importanceOf(src, e.of), body: { kind: "rows", rows: rowsOf(src, e.lists), ...(lead === undefined ? {} : { lead }) } };
  }
  if (e.kind === "file" && e.lists.length > 0) {
    // A file with definitions lists itself first, as a thing of its own, then every definition in it, the ones inside
    // another under it.
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
    // Its own text: a file with definitions its lines outside them, each definition folded to the line it begins on;
    // a folder's thing, its README.
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
  // The blocks Jev picked: the key one and the one most in need. A definition too long for its page opens on its key block.
  const { key, weak } = src.thing?.(e.of)?.picks ?? {};
  // Marked, where the two overlap, the gutter shows the one most in need, which comes first.
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

/** The file whose text an entry's page shows: a definition's, a file with definitions as a thing of its own, a file with none, or a folder's README. */
export function fileOfEntry(e: JournalEntry): string | undefined {
  if (e.kind === "definition") return e.of.slice(0, e.of.indexOf("#"));
  if (e.kind === "own") return e.of.slice("own:".length);
  if (e.kind === "file" && e.lists.length === 0) return e.of;
  if (e.kind === "entity") return e.text;
  return undefined;
}

/** A document, whose text is set as prose. */
const PROSE = /\.(md|mdx|markdown|txt|rst)$/i;
/**
 * A document's text as its paragraphs: lines a writer wrapped by hand joined
 * into one, a heading, a list item, a quote, a table row and a blank line
 * each its own, a list item with a bullet, a fenced block's lines kept as
 * they are, set as code, without its fences. Links and images say their
 * words, and emphasis and code marks are dropped.
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
      // One blank line between paragraphs, however many the writer left.
      if (out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
        pre.push(false);
      }
    } else if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<)/.test(line)) {
      flush();
      // A list item is set with a bullet.
      paragraph = [line.replace(/^[-*+]\s+/, "• ")];
      // A heading, a table row or a line of markup stands alone; a list item or a quote runs on over its lines.
      if (/^(#{1,6}\s|\||<)/.test(line)) flush();
    } else paragraph.push(line);
  }
  flush();
  return { lines: out, pre };
}

/** The most of a file the journal sets: so many lines, each cut at what a page holds. A one-line data file can run to half a megabyte. */
const SET = { lines: 2000, chars: 1500 } as const;
/**
 * A file's text as the journal sets it, and how many lines of it are left
 * out; none of a file that isn't text, such as an image, or before it comes.
 */
function setOf(lines: readonly string[] | undefined): { readonly lines: readonly string[]; readonly rest: number } {
  if (lines === undefined || lines.slice(0, 50).some((l) => l.includes("\u0000") || l.includes("\uFFFD"))) return { lines: [], rest: 0 };
  return { lines: lines.slice(0, SET.lines).map((l) => (l.length > SET.chars ? `${l.slice(0, SET.chars)} …` : l)), rest: Math.max(0, lines.length - SET.lines) };
}

/** How many lines after its signature a definition's page holds whole, about. */
const FITS = 24;

/**
 * A definition's or a file's words for the appendix: its name, then all of
 * its text with Jev's marks, which only the appendix shows. What Jev judged
 * otherwise is on its page and its caption.
 */
export function appendixWords(src: WordsSource, e: JournalEntry): PageWords {
  const page = wordsOf(src, e, true);
  if (page.body.kind !== "code") return page;
  const { opensAt: _, kind: __, ...text } = page.body;
  return { ...page, body: { ...text, kind: "full" } };
}
