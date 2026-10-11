// What a page of the journal says. Every page says the same few things in
// the same shape: where it lives, its name, its vitality, a definition's
// signature as the code writes it, then either a list or code. The contents,
// a chapter and a file list rows (each one's name, vitality and page); a
// definition is its code. The book draws whatever words it is handed, so a
// new kind of page needs nothing new in the book.

import type { CodeSymbol, Journal, JournalEntry } from "@gaia/world";

/**
 * What Jev points out, marked the same way at every level: a definition's
 * lines, a file's definitions, a folder's files and folders, an entity's
 * trails. Key to understanding, or could be better; stronger the surer Jev is.
 */
export interface Mark {
  readonly kind: "understand" | "improve";
  /** How sure Jev is, 0 to 1. */
  readonly sure: number;
}

/** One line of a list, indented by how deep it sits under the page's own subject. */
export interface Row {
  readonly of: string;
  readonly name: string;
  readonly depth: number;
  readonly vitality: number;
  readonly page: number;
  readonly mark?: Mark;
}

export interface Rows {
  readonly kind: "rows";
  readonly rows: readonly Row[];
}

export interface Code {
  readonly kind: "code";
  /** The definition's lines after its signature, numbered from `first`; empty until its file's text arrives. */
  readonly first: number;
  readonly lines: readonly string[];
  /** The line the page opens on. */
  readonly opensAt: number;
  /** The lines Jev points out, by line number. */
  readonly marks: readonly (Mark & { readonly from: number; readonly to: number })[];
}

export interface PageWords {
  /** The folders it lives in, outermost first, its file last for a definition: ["app", "world-service", "open-world.ts"]. */
  readonly path: readonly string[];
  readonly name: string;
  readonly vitality: number;
  /** A definition's first line, as the code writes it. */
  readonly signature?: string;
  readonly body: Rows | Code;
}

/** What the words are read from: the world, each place's and file's vitality, and a file's text once it has arrived. */
export interface WordsSource {
  readonly journal: Journal;
  readonly world: { readonly name: string; readonly symbols: readonly Pick<CodeSymbol, "id" | "line" | "lines">[] };
  /** A folder's vitality, its subfolders' included, a file's by its path, or an entity's by `entity:<path>`. */
  vitality(of: string): number;
  /** A file's lines, or undefined until they arrive. */
  lines(path: string): readonly string[] | undefined;
  /** What Jev points out about a folder, entity, file or definition, if anything. */
  marked?(of: string): Mark | undefined;
  /** The lines Jev points out in a definition. */
  markedLines?(id: string): readonly (Mark & { readonly from: number; readonly to: number })[];
}

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

/** A definition's vitality is its file's. */
const vitalityPath = (e: JournalEntry): string => (e.kind === "definition" ? e.of.slice(0, e.of.indexOf("#")) : e.of);

function rowOf(src: WordsSource, e: JournalEntry, depth: number): Row {
  const mark = src.marked?.(e.of);
  return { of: e.of, name: e.name, depth, vitality: src.vitality(vitalityPath(e)), page: e.page, ...(mark === undefined ? {} : { mark }) };
}

/** The words of one entry's page. */
export function wordsOf(src: WordsSource, e: JournalEntry): PageWords {
  if (e.kind === "entity") {
    // An entity lists the things its trails join it to.
    const path = e.of.slice("entity:".length);
    return { path: path === "" ? [] : path.split("/"), name: e.name, vitality: src.vitality(e.of), body: { kind: "rows", rows: e.lists.map((of) => rowOf(src, src.journal.entry(of) as JournalEntry, 0)) } };
  }
  if (e.kind === "chapter") return { path: folders(e.of), name: e.name, vitality: src.vitality(e.of), body: { kind: "rows", rows: e.lists.map((of) => rowOf(src, src.journal.entry(of) as JournalEntry, 0)) } };
  if (e.kind === "file") {
    // A file lists every definition in it, the ones inside another under it.
    const rows: Row[] = [];
    const walk = (of: string, depth: number): void => {
      const d = src.journal.entry(of) as JournalEntry;
      rows.push(rowOf(src, d, depth));
      for (const inner of d.lists) walk(inner, depth + 1);
    };
    for (const of of e.lists) walk(of, 0);
    return { path: folders(e.of), name: e.name, vitality: src.vitality(e.of), body: { kind: "rows", rows } };
  }
  const symbol = src.world.symbols.find((s) => s.id === e.of);
  const file = e.of.slice(0, e.of.indexOf("#"));
  const text = src.lines(file);
  const line = symbol?.line ?? 1;
  const count = symbol?.lines ?? 1;
  const signature = text?.[line - 1]?.trim();
  return {
    path: file.split("/"),
    name: e.name,
    vitality: src.vitality(file),
    ...(signature === undefined ? {} : { signature }),
    body: { kind: "code", first: line + 1, lines: text?.slice(line, line + count - 1) ?? [], opensAt: line + 1, marks: src.markedLines?.(e.of) ?? [] },
  };
}
