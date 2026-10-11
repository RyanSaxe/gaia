// What a page of the journal says. Every page says the same few things in
// the same shape: where it lives, its name, its vitality, a definition's
// signature as the code writes it, then either a list or code. The contents,
// a chapter and a file list rows (each one's name, vitality and page); a
// definition is its code. The book draws whatever words it is handed, so a
// new kind of page needs nothing new in the book.

import type { Choice, Judged, Score, Span, YesNo } from "@gaia/schema";
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

/** What Jev judged about a node, in the graph's own terms; a block's judgment names the lines it covers. */
export interface Judgment {
  readonly judged: Judged;
  readonly lines?: Span;
}

/** The reasons to stop and look that are key to understanding; the rest, but routine, are where it could be better. */
const UNDERSTAND = new Set(["heart", "intricate", "doorway", "hot path"]);

/**
 * How a page shows what Jev judged: the one place a judgment becomes
 * something seen. For now an attention that isn't routine is a mark, as sure
 * as Jev is of it.
 */
export function markOf(judged: Judged): Mark | undefined {
  const a = judged.attention;
  if (a === undefined || a.choice === "routine") return undefined;
  return { kind: UNDERSTAND.has(a.choice) ? "understand" : "improve", sure: a.p[a.choice] ?? 0 };
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
  /** What Jev says about the block or two a page points out, Jev's surest of each kind, shown just above each. */
  readonly notes: readonly Said[];
}

/** One thing Jev says about a node, in plain words: what it was asked, and its answer. */
export interface Fact {
  readonly asked: string;
  readonly answer: string;
  /** How sure Jev is of a choice or a yes or no, 0 to 1. */
  readonly sure?: number;
  /** Where a score stands between its lowest level and its top, 0 to 1. */
  readonly level?: number;
}

/** What Jev says about a definition itself, or about a block of its lines. */
export interface Said {
  readonly lines?: Span;
  readonly facts: readonly Fact[];
}

/** A definition in full, for the appendix: everything Jev says about it, then every line of its code. */
export interface Full {
  readonly kind: "full";
  readonly said: readonly Said[];
  readonly first: number;
  readonly lines: readonly string[];
  readonly marks: readonly (Mark & { readonly from: number; readonly to: number })[];
}

export interface PageWords {
  /** The folders it lives in, outermost first, its file last for a definition: ["app", "world-service", "open-world.ts"]. */
  readonly path: readonly string[];
  readonly name: string;
  readonly vitality: number;
  /** A definition's first line, as the code writes it. */
  readonly signature?: string;
  readonly body: Rows | Code | Full;
}

/** What the words are read from: the world, each place's and file's vitality, and a file's text once it has arrived. */
export interface WordsSource {
  readonly journal: Journal;
  readonly world: { readonly name: string; readonly symbols: readonly Pick<CodeSymbol, "id" | "line" | "lines">[] };
  /** A folder's vitality, its subfolders' included, a file's by its path, or an entity's by `entity:<path>`. */
  vitality(of: string): number;
  /** A file's lines, or undefined until they arrive. */
  lines(path: string): readonly string[] | undefined;
  /** What Jev judged about a folder, entity, file or definition, and about each block of a definition's lines. */
  judged?(of: string): readonly Judgment[];
}

/** What each question Jev answers is called on the page; a question not named here is called by its own key. */
const ASKED: Readonly<Record<string, string>> = {
  kind: "kind",
  role: "role",
  attention: "why look",
  stand: "stands out",
  readability: "reads",
  naming: "named",
  doc: "documented",
  errors: "errors",
  change: "risk in changing",
  cohesion: "holds together",
  breaks: "a bug would break",
  central: "central",
  needsTests: "needs tests",
  dead: "unused",
};

/**
 * Everything Jev judged about a node, as the page says it: each answer under
 * the question it answers, whatever questions the node was asked, so the
 * journal follows Jev's questions as they change. A choice says its option
 * and how sure Jev is; a score where it stands; a yes or no which, and how
 * sure. Of what a node does, only what Jev says it does.
 */
export function factsOf(judged: Judged): Fact[] {
  const facts: Fact[] = [];
  const asked = (key: string): string => ASKED[key] ?? key;
  const add = (key: string, a: Choice | Score | YesNo | undefined): void => {
    if (a === undefined) return;
    if ("choice" in a) facts.push({ asked: asked(key), answer: a.choice, sure: a.p[a.choice] ?? 0 });
    else if ("score" in a) facts.push({ asked: asked(key), answer: a.score.toFixed(1), level: a.value });
    else facts.push({ asked: asked(key), answer: a.p >= 0.5 ? "yes" : "no", sure: Math.max(a.p, 1 - a.p) });
  };
  add("attention", judged.attention);
  add("role", judged.role);
  add("kind", judged.kind);
  for (const [k, q] of Object.entries(judged.quality ?? {})) add(k, q);
  if (judged.importance !== undefined) {
    add("breaks", judged.importance.breaks);
    add("central", judged.importance.central);
  }
  add("needsTests", judged.needsTests);
  add("dead", judged.dead);
  add("stand", judged.stand);
  for (const [k, yes] of Object.entries(judged.does ?? {})) if (yes.p >= 0.5) facts.push({ asked: "does", answer: k, sure: yes.p });
  return facts;
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
  const own = src.judged?.(e.of).find((j) => j.lines === undefined);
  const mark = own === undefined ? undefined : markOf(own.judged);
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
  const blocks = (src.judged?.(e.of) ?? []).flatMap((j) => {
    const mark = j.lines === undefined ? undefined : markOf(j.judged);
    return mark === undefined || j.lines === undefined ? [] : [{ mark, lines: j.lines, judged: j.judged }];
  });
  const marks = blocks.map((b) => ({ ...b.mark, from: b.lines.start, to: b.lines.end }));
  // A page points out a block or two: Jev's surest of each kind, one key to understanding and one that could be better,
  // each with what Jev says about it. A definition too long for its page opens at the first of them.
  const pointed = (["understand", "improve"] as const)
    .flatMap((kind) => [...blocks].filter((b) => b.mark.kind === kind).sort((a, b) => b.mark.sure - a.mark.sure).slice(0, 1))
    .sort((a, b) => a.lines.start - b.lines.start);
  const opensAt = count - 1 > FITS && pointed[0] !== undefined ? pointed[0].lines.start : line + 1;
  return {
    path: file.split("/"),
    name: e.name,
    vitality: src.vitality(file),
    ...(signature === undefined ? {} : { signature }),
    body: { kind: "code", first: line + 1, lines: text?.slice(line, line + count - 1) ?? [], opensAt, marks, notes: pointed.map((b) => ({ lines: b.lines, facts: factsOf(b.judged) })) },
  };
}

/** How many lines after its signature a definition's page holds whole, about. */
const FITS = 24;

/** A definition's words for the appendix: its name and signature, everything Jev says about it, then all of its code. */
export function appendixWords(src: WordsSource, e: JournalEntry): PageWords {
  const page = wordsOf(src, e);
  const judged = src.judged?.(e.of) ?? [];
  const said: Said[] = [...judged]
    .sort((a, b) => (a.lines?.start ?? 0) - (b.lines?.start ?? 0))
    .flatMap((j) => {
      const facts = factsOf(j.judged);
      return facts.length === 0 ? [] : [{ ...(j.lines === undefined ? {} : { lines: j.lines }), facts }];
    });
  if (page.body.kind !== "code") return page;
  return { ...page, body: { kind: "full", said, first: page.body.first, lines: page.body.lines, marks: page.body.marks } };
}
