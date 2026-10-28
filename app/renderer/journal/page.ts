// Builds one journal page's DOM from its `PageWords` (`words.ts`): the path in
// small capitals, the name with quality and importance meters, a definition's
// signature, then its rows or its code. A code page ends on a whole line with a
// fold to the rest, and a left-hand page holds a picture with a caption of
// facts across its foot.

import { type Measure, canvasMeasure, nameBreaks } from "../immersive/map-names.ts";
import { TRAVELLER_SVG } from "../immersive/map-styles.ts";
import type { CaptionFact } from "./caption.ts";
import { type Piece, highlight } from "./highlight.ts";
import { TITLE_FAMILY } from "./title-face.ts";
import type { Folded, Full, Mark, PageWords, Row, Snippet } from "./words.ts";

/** The page's vitality color: russet at 0, ochre at 0.5 and green at 1, interpolated between. */
export function healthColor(v: number): string {
  const stops: readonly (readonly [number, readonly [number, number, number]])[] = [
    [0, [154, 98, 70]],
    [0.5, [184, 154, 74]],
    [1, [111, 154, 74]],
  ];
  const t = Math.max(0, Math.min(1, v));
  for (let k = 1; k < stops.length; k++) {
    const [a, ca] = stops[k - 1] as (typeof stops)[number];
    const [b, cb] = stops[k] as (typeof stops)[number];
    if (t <= b) {
      const u = (t - a) / (b - a);
      return `rgb(${ca.map((c, i) => Math.round(c + ((cb[i] as number) - c) * u)).join(",")})`;
    }
  }
  return "rgb(111,154,74)";
}

/** A page's size in its own pixels, as in the book. */
const PAGE_W = 520;
const PAGE_H = 660;
/**
 * The world's name on the title page, in the face of Gaia's logo. It is at most `size` px, with lines no wider than the
 * page minus its 44 px margins (journal.css). A name that would need more than `lines` lines, or has a piece too long
 * for one line, shrinks, but not below `least` px. A piece longer still breaks wherever it must.
 */
const TITLE = { size: 52, least: 22, width: PAGE_W - 88, lines: 3 } as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Formats a score from 0 to 1 as a percentage. */
const percent = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** The color of the importance meter. The quality meter uses `healthColor`. */
const INK = "#6b5640";

/** A score as a short meter filled to its share, followed by its percentage. */
function meter(v: number, color: string, cls: string): HTMLElement {
  const m = el("span", cls);
  const track = el("i", "jp-track");
  const fill = el("b", "");
  fill.style.width = percent(v);
  fill.style.background = color;
  track.append(fill);
  m.append(track, el("span", "jp-pct", percent(v)));
  return m;
}

/** The two numbers beside a page's name, each with a meter: quality in its vitality color, and importance in ink. */
function numbersOf(words: PageWords): HTMLElement {
  const numbers = el("span", "jp-numbers");
  const quality = el("span", "jp-number");
  quality.append(el("span", "jp-number-label", "quality"), meter(words.vitality, healthColor(words.vitality), "jp-meter"));
  numbers.append(quality);
  if (words.importance !== undefined) {
    const importance = el("span", "jp-number");
    importance.append(el("span", "jp-number-label", "importance"), meter(words.importance, INK, "jp-meter"));
    numbers.append(importance);
  }
  return numbers;
}

/** Mark colors beside appendix lines: green for code that is key to understanding, russet for code that most needs work. */
const MARK_COLOR = { understand: "#5f8f3e", improve: "#a4553a" } as const;
function marked(e: HTMLElement, mark: Mark | undefined): void {
  if (mark === undefined) return;
  e.classList.add("jp-marked");
  e.style.setProperty("--mark", MARK_COLOR[mark.kind]);
}

function rowsOf(rows: readonly Row[], turnTo: (of: string) => void): HTMLElement {
  const list = el("div", "jp-rows");
  for (const r of rows) {
    const row = el("button", `jp-row d${Math.min(r.depth, 3)}`);
    row.type = "button";
    row.append(el("span", "jp-row-name", r.name), el("span", "jp-dots"), meter(r.vitality, healthColor(r.vitality), "jp-row-meter"), ...(r.importance === undefined ? [] : [meter(r.importance, INK, "jp-row-meter")]), el("span", "jp-row-page", r.page.toLocaleString("en-US")));
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      turnTo(r.of);
    });
    list.append(row);
  }
  return list;
}

/** An entity's trails at the foot of its page: what it imports from and what imports from it. Each name turns to its page. */
function trailsOf(trails: NonNullable<PageWords["trails"]>, turnTo: (of: string) => void): HTMLElement {
  const foot = el("div", "jp-trails");
  for (const [label, rows] of [["uses", trails.uses], ["used by", trails.usedBy]] as const) {
    if (rows.length === 0) continue;
    const line = el("div", "jp-trail-line");
    line.append(el("span", "jp-number-label", label));
    const names = el("span", "jp-trail-names");
    rows.forEach((r, k) => {
      if (k > 0) names.append(el("span", "jp-trail-sep", " · "));
      const b = el("button", "jp-trail-name", r.name);
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        turnTo(r.of);
      });
      names.append(b);
    });
    line.append(names);
    foot.append(line);
  }
  return foot;
}

/** The label of a marked block in the appendix, shown in its stroke's color at the block's first line. */
const MARK_LABEL = { improve: "weak", understand: "key" } as const;

/**
 * A page's lead: its most important definition, without marks. It shows the
 * name and page of the part it belongs to, then the signature and the key
 * lines, with the rest folded. A tap on the name turns to that part's page,
 * and a tap on the code turns to the definition in full, as the reference
 * under it says.
 */
function leadOf(s: Snippet, path: string, turnTo: (of: string) => void, fullOf: ((of: string) => InFull) | undefined): HTMLElement {
  const lead = el("div", "jp-lead");
  const snippet = el("button", "jp-snippet");
  snippet.type = "button";
  const head = el("span", "jp-snippet-head");
  head.append(el("span", "jp-snippet-name", s.name), el("span", "jp-dots"), el("span", "jp-row-page", s.page.toLocaleString("en-US")));
  const lines = [s.signature.text, ...s.lines];
  const pieces = highlight(lines, path);
  const base = baseIndent(lines);
  const line = (k: number, n: number): HTMLElement => {
    const row = el("span", "jp-line");
    const text = inkedLine(pieces[k], lines[k] as string);
    text.style.setProperty("--ind", String(Number.isFinite(base) ? indentOf(lines[k] as string) - base : 0));
    row.append(el("span", "jp-ln", String(n)), text);
    return row;
  };
  const code = el("span", "jp-code jp-snippet-code");
  code.append(line(0, s.signature.n));
  if (s.before > 0) code.append(foldOf(linesOf(s.before)));
  s.lines.forEach((_, k) => code.append(line(k + 1, s.first + k)));
  if (s.after > 0) code.append(foldOf(linesOf(s.after)));
  const full = fullOf?.(s.shows);
  if (full !== undefined) {
    code.classList.add("jp-tapcode");
    code.addEventListener("click", (e) => {
      e.stopPropagation();
      full.turn();
    });
    // The snippet is a button, and a button cannot contain another, so its reference is a span.
    code.append(referenceOf(`in full, p. ${full.folio}`, full.turn, "on", "span"));
  }
  snippet.append(head, code);
  snippet.addEventListener("click", (e) => {
    e.stopPropagation();
    turnTo(s.of);
  });
  lead.append(snippet);
  return lead;
}

/**
 * A cross-reference such as "→ in full, p. 5,415a" to the appendix or "← back
 * to its page, p. 5,415". A tap turns to that page.
 */
function referenceOf(says: string, tap: () => void, way: "on" | "back", tag: "button" | "span" = "button"): HTMLElement {
  const ref = el(tag, way === "back" ? "jp-xref back" : "jp-xref", says);
  if (ref instanceof HTMLButtonElement) ref.type = "button";
  ref.addEventListener("click", (e) => {
    e.stopPropagation();
    tap();
  });
  return ref;
}

/** A thing's path in small capitals. Each folder, and a definition's file, turns to its page. */
function whereOf(path: readonly string[], turnTo: (of: string) => void): HTMLElement {
  const where = el("div", "jp-where");
  path.forEach((name, k) => {
    if (k > 0) where.append(el("span", "jp-crumb-sep", " / "));
    const step = el("button", "jp-crumb", name);
    step.type = "button";
    step.addEventListener("click", (e) => {
      e.stopPropagation();
      turnTo(path.slice(0, k + 1).join("/"));
    });
    where.append(step);
  });
  return where;
}

/** Leading spaces, counted with a tab as two. */
const indentOf = (line: string): number => {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  return [...lead].reduce((n, c) => n + (c === "\t" ? 2 : 1), 0);
};

/** The smallest indent among a definition's non-blank lines, which the page removes from every line. */
const baseIndent = (lines: readonly string[]): number => Math.min(...lines.filter((l) => l.trim() !== "").map(indentOf), Infinity);

/** A definition's signature, highlighted like its code. */
function signatureOf(signature: string, path: string): HTMLElement {
  const sig = el("div", "jp-sig");
  sig.append(...inkedLine(highlight([signature], path)[0], signature).childNodes);
  return sig;
}

/** A line's text as highlighted pieces, without the leading indent, which the page sets with `--ind`. */
function inkedLine(pieces: readonly Piece[] | undefined, line: string): HTMLElement {
  const text = el("span", "jp-text");
  let lead = true;
  for (const p of pieces ?? [{ text: line }]) {
    const t = lead ? p.text.trimStart() : p.text;
    if (t === "") continue;
    lead = false;
    if (p.ink === undefined) text.append(document.createTextNode(t));
    else text.append(el("span", `ink-${p.ink}`, t));
  }
  return text;
}

function codeOf(at: readonly number[], body: Full, base: number, pieces: readonly (readonly Piece[])[]): HTMLElement {
  const code = el("div", body.prose === true ? "jp-code prose" : "jp-code");
  for (const k of at) {
    const line = body.lines[k] as string;
    const n = body.first + k;
    const row = el("div", "jp-line");
    row.dataset.line = String(n);
    // The first mark covering a line sets its stroke, and the block's first line gets the mark's label.
    const mark = body.marks.find((m) => m.from <= n && n <= m.to);
    marked(row, mark);
    if (mark !== undefined && mark.from === n) row.dataset.label = MARK_LABEL[mark.kind];
    if (body.prose === true) {
      // A Markdown heading is styled as a heading without its # marks, and a fenced block's lines as code.
      const heading = body.pre?.[k] === true ? null : /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading !== null) row.classList.add(`h${(heading[1] as string).length}`);
      if (body.pre?.[k] === true) row.classList.add("pre");
      else if (line === "") row.classList.add("gap");
      row.append(el("span", "jp-ln", String(n)), el("span", "jp-text", heading === null ? line : (heading[2] as string)));
    } else {
      const text = inkedLine(pieces[k], line);
      text.style.setProperty("--ind", String(Number.isFinite(base) ? indentOf(line) - base : 0));
      row.append(el("span", "jp-ln", String(n)), text);
    }
    code.append(row);
  }
  return code;
}

/**
 * A page of a file's code for a riffle's leaf: the file's path as its running head, its lines from `first` set like
 * any code page, and its folio.
 */
export function renderPassingPage(path: string, first: number, lines: readonly string[], folio: string): HTMLElement {
  const page = el("div", "jp");
  const head = el("div", "jp-head");
  head.append(el("div", "jp-running", path.split("/").join(" / ")));
  const body = el("div", "jp-body");
  const text: Full = { kind: "full", first, lines, marks: [] };
  body.append(codeOf(lines.map((_, k) => k), text, baseIndent(lines), highlight(lines, path)));
  page.append(head, body, el("div", "jp-folio", folio));
  return page;
}

/** Where a page's text appears in full: a function that turns there, and the folio of its first appendix page, such as "5,475a". */
export interface InFull {
  readonly turn: () => void;
  readonly folio: string;
}

/**
 * Builds a page from its words. `turnTo` turns the book to a row's page, and
 * `folio` is the page's number. A list too long for one page is drawn a slice
 * of `rows` at a time: the first page under the full heading, and each
 * continuation under a running head. A page with text links to where it
 * appears in full (`full`): its name, its folds and its code turn there, and a
 * reference at its foot gives the page. `fullOf` finds the full text of any
 * definition, for the code a page leads with.
 */
export function renderPage(words: PageWords, folio: string, turnTo: (of: string) => void, rows?: { readonly from: number; readonly to: number }, full?: InFull, fullOf?: (of: string) => InFull): HTMLElement {
  const inFull = full?.turn;
  const page = el("div", "jp");
  page.style.setProperty("--health", healthColor(words.vitality));
  const head = el("div", "jp-head");
  if (rows !== undefined && rows.from > 0) head.append(el("div", "jp-running", [...words.path, words.name].join(" / ")));
  else {
    if (words.path.length > 0) head.append(whereOf(words.path, turnTo));
    const title = el("div", "jp-title");
    // A definition's name turns to it in full, in the appendix.
    const name = el(inFull === undefined ? "span" : "button", "jp-name", words.name);
    if (inFull !== undefined) {
      (name as HTMLButtonElement).type = "button";
      name.addEventListener("click", (e) => {
        e.stopPropagation();
        inFull();
      });
    }
    title.append(name, numbersOf(words));
    head.append(title);
    if (words.signature !== undefined) head.append(signatureOf(words.signature, words.path.join("/")));
    head.append(el("div", "jp-rule"));
  }
  const body = el("div", "jp-body");
  if (words.body.kind === "rows" && words.body.lead !== undefined && (rows === undefined || rows.from === 0)) body.append(leadOf(words.body.lead, words.path.join("/"), turnTo, fullOf));
  if (words.body.kind === "rows") {
    body.append(rowsOf(rows === undefined ? words.body.rows : words.body.rows.slice(rows.from, rows.to), turnTo));
    if (words.trails !== undefined && (rows === undefined || rows.from === 0)) body.append(trailsOf(words.trails, turnTo));
  } else if (words.body.kind === "code") {
    // Starts at `opensAt` and folds the lines above it.
    const { opensAt, kind: _, ...code } = words.body;
    const skipped = opensAt - code.first;
    const shown: Full = { ...code, kind: "full", first: opensAt, lines: code.lines.slice(skipped) };
    if (skipped > 0 && inFull !== undefined) body.append(foldOf(linesOf(skipped), inFull));
    setItems(body, shown, fullItems(shown), baseIndent(code.lines), piecesOf(shown, words), turnTo);
    // A fold at the end of a long definition's page. `finish` in book.ts shows it with the count of remaining lines when some are left over.
    if (full !== undefined) {
      body.append(foldOf("", full.turn, "after"));
      // A tap on the code turns to it in full, and the reference at the page's foot gives the page.
      for (const code of body.querySelectorAll<HTMLElement>(".jp-code")) {
        code.classList.add("jp-tapcode");
        code.addEventListener("click", (e) => {
          e.stopPropagation();
          full.turn();
        });
      }
      page.append(head, body, referenceOf(`in full, p. ${full.folio}`, full.turn, "on"), el("div", "jp-folio", folio));
      return page;
    }
  }
  page.append(head, body, el("div", "jp-folio", folio));
  return page;
}

/**
 * One row of a text in the appendix: a line, a definition with its own page
 * folded to one line, or a count of lines left out. A page is a run of items.
 */
export type FullItem =
  | { readonly kind: "line"; readonly at: number }
  | { readonly kind: "fold"; readonly fold: Folded }
  | { readonly kind: "rest"; readonly lines: number };

export function fullItems(body: Full): FullItem[] {
  const items: FullItem[] = [];
  const folds = new Map((body.folded ?? []).map((f) => [f.from, f]));
  for (let k = 0; k < body.lines.length; k++) {
    // A definition with its own page becomes one fold line that turns to it.
    const fold = folds.get(body.first + k);
    if (fold !== undefined) {
      items.push({ kind: "fold", fold });
      k += fold.to - fold.from;
    } else items.push({ kind: "line", at: k });
  }
  if (body.rest !== undefined) items.push({ kind: "rest", lines: body.rest });
  return items;
}

/** Each of a text's lines as highlighted pieces. A document's lines stay plain. */
const piecesOf = (body: Pick<Full, "lines" | "prose">, words: PageWords): Piece[][] => (body.prose === true ? [] : highlight(body.lines, words.path.join("/")));

/**
 * Builds an appendix page of a definition in full from a slice of its
 * `fullItems`. The first page has the full heading, the path linking to each
 * folder, and a reference back to its journal page at its foot. Later pages
 * have a running head that also turns back there.
 */
export function renderFullPage(words: PageWords, body: Full, folio: string, items: { readonly from: number; readonly to: number }, first: boolean, back: () => void, turnTo: (of: string) => void): HTMLElement {
  const page = el("div", "jp jp-full");
  page.style.setProperty("--health", healthColor(words.vitality));
  const head = el("div", "jp-head");
  const backTo = (e: HTMLElement): HTMLElement => {
    (e as HTMLButtonElement).type = "button";
    e.addEventListener("click", (ev) => {
      ev.stopPropagation();
      back();
    });
    return e;
  };
  if (!first) head.append(backTo(el("button", "jp-running jp-back", [...words.path, words.name].join(" / "))));
  else {
    if (words.path.length > 0) head.append(whereOf(words.path, turnTo));
    const title = el("div", "jp-title");
    title.append(backTo(el("button", "jp-name", words.name)), numbersOf(words));
    head.append(title);
    if (words.signature !== undefined) head.append(signatureOf(words.signature, words.path.join("/")));
    head.append(el("div", "jp-rule"));
  }
  const content = el("div", "jp-body");
  setItems(content, body, fullItems(body).slice(items.from, items.to), baseIndent(body.lines), piecesOf(body, words), turnTo);
  // The first page's back reference uses the appendix folio without its letter, which is the journal page's folio.
  page.append(head, content, ...(first ? [referenceOf(`back to its page, p. ${folio.replace(/[a-z]+$/, "")}`, back, "back")] : []), el("div", "jp-folio", folio));
  return page;
}

/** Sets `items` of a text on a page: a run of its lines as code or prose, and a folded definition as a line. */
function setItems(content: HTMLElement, body: Full, items: readonly FullItem[], base: number, pieces: readonly (readonly Piece[])[], turnTo: (of: string) => void): void {
  let run: FullItem[] = [];
  const close = (): void => {
    const [start] = run;
    if (start === undefined) return;
    if (start.kind === "line") content.append(codeOf(run.map((r) => (r.kind === "line" ? r.at : 0)), body, base, pieces));
    else {
      for (const r of run) {
        // A definition with its own page folds to one line that turns there. A "rest" item counts the lines the appendix leaves out.
        if (r.kind === "fold") content.append(foldOf(`${linesOf(r.fold.to - r.fold.from + 1)}, page ${r.fold.page.toLocaleString("en-US")}`, () => turnTo(r.fold.of)));
        else content.append(foldOf(`${linesOf((r as Extract<FullItem, { kind: "rest" }>).lines)}, not set here`));
      }
    }
    run = [];
  };
  const group = (item: FullItem): string => (item.kind === "line" ? "line" : "fold");
  for (const item of items) {
    if (run.length > 0 && group(run[0] as FullItem) !== group(item)) close();
    run.push(item);
  }
  close();
}

/** A line count as a fold shows it: "1 line", "20 lines". */
export const linesOf = (n: number): string => `${n.toLocaleString("en-US")} ${n === 1 ? "line" : "lines"}`;

/**
 * A fold for hidden lines anywhere code is shown, such as "⋯ 20 lines" at the
 * code's indent, with any extra text such as their page, and a tap that turns
 * to where they can be read. Every fold in the journal uses this. A long
 * definition's page gets an `after` fold, which `finish` in book.ts places and
 * labels once the page is laid out.
 */
function foldOf(says: string, tap?: () => void, where?: "after"): HTMLElement {
  const fold = el(tap === undefined ? "span" : "button", where === undefined ? "jp-fold" : `jp-fold ${where}`, says);
  if (tap !== undefined) {
    (fold as HTMLButtonElement).type = "button";
    fold.addEventListener("click", (e) => {
      e.stopPropagation();
      tap();
    });
  }
  return fold;
}

/**
 * The title page, facing the contents: a full-bleed painting of the world with
 * its name lettered across the sky in the face of Gaia's logo. The world's
 * vitality appears on the facing contents page.
 */
export function renderTitle(name: string, folio: string, painting: HTMLElement): HTMLElement {
  const page = el("div", "jp jp-picture jp-title-page");
  const lettered = el("div", "jp-title-lettering");
  // Breaks the name at `nameBreaks` points into lines of similar length (journal.css).
  const lettering = el("div", "jp-book-name");
  lettering.append(...nameBreaks(name).flatMap((piece, k) => (k === 0 ? [piece] : [document.createElement("wbr"), piece])));
  measure ??= canvasMeasure(document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D);
  lettering.style.fontSize = `${titleSize(name, measure).toFixed(1)}px`;
  lettered.append(lettering);
  page.append(painting, lettered, el("div", "jp-folio", folio));
  return page;
}

/** The title lettering's measure, created on first use. */
let measure: Measure | null = null;

/** The font size in px for `name` on the title page (`TITLE`), measured with `measure`. */
export function titleSize(name: string, measure: Measure): number {
  const width = (text: string): number => measure(text, `600 ${TITLE.size}px ${TITLE_FAMILY}`, 0);
  const longest = Math.max(...nameBreaks(name).map(width));
  const fit = Math.min(1, TITLE.width / longest, (TITLE.width * TITLE.lines) / width(name));
  return Math.max(TITLE.least, TITLE.size * fit);
}

/** The traveller marker on a map page, the same as the field map's, with footprints behind it along its heading. */
export function renderTraveller(px: number, py: number, yaw: number): HTMLElement {
  const here = el("div", "jp-here");
  here.innerHTML = TRAVELLER_SVG;
  placeTraveller(here, px, py, yaw);
  return here;
}

/**
 * Moves a map page's traveller to (px, py) in the page's pixels, facing `yaw`, to three decimal places of a percent so
 * it moves smoothly. It hides the marker off the page and writes no style when nothing changed.
 */
export function placeTraveller(here: HTMLElement, px: number, py: number, yaw: number): void {
  const left = `${((px / PAGE_W) * 100).toFixed(3)}%`;
  const top = `${((py / PAGE_H) * 100).toFixed(3)}%`;
  const facing = `rotate(${((-yaw * 180) / Math.PI).toFixed(1)})`;
  const off = !(px > 0 && px < PAGE_W && py > 0 && py < PAGE_H);
  if (here.hidden !== off) here.hidden = off;
  if (here.style.left !== left) here.style.left = left;
  if (here.style.top !== top) here.style.top = top;
  const steps = here.querySelector(".traveller-steps");
  if (steps !== null && steps.getAttribute("transform") !== facing) steps.setAttribute("transform", facing);
}

/**
 * A trip's route on a map page in vermilion: a line ending at a cross, over the map. `follow` in `journalPages` sets
 * the line's path in the page's pixels as the trip goes.
 */
export function renderWay(): { readonly way: SVGSVGElement; readonly cross: HTMLElement } {
  const way = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  way.setAttribute("class", "jp-way");
  way.setAttribute("viewBox", `0 0 ${PAGE_W} ${PAGE_H}`);
  way.setAttribute("aria-hidden", "true");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("pathLength", "1");
  way.append(line);
  return { way, cross: renderCross(0, 0) };
}

/** Moves a cross on a map's page to (px, py) in the page's own pixels. */
export function placeCross(cross: HTMLElement, px: number, py: number): void {
  cross.style.left = `${((px / PAGE_W) * 100).toFixed(2)}%`;
  cross.style.top = `${((py / PAGE_H) * 100).toFixed(2)}%`;
}

/** A vermilion cross marking a spot on a map page, as on the field map. A second click on it travels there. */
export function renderCross(px: number, py: number): HTMLElement {
  const cross = el("div", "jp-cross");
  cross.innerHTML = '<svg viewBox="0 0 18 18"><path d="M3 3 L15 15 M15 3 L3 15"/></svg>';
  placeCross(cross, px, py);
  return cross;
}

/** An underline under a name on a map while the pointer is on it. `box` is in the page's pixels. */
export function renderNameLine(box: readonly [number, number, number, number]): HTMLElement {
  const line = el("div", "jp-name-line");
  line.style.left = `${((box[0] / PAGE_W) * 100).toFixed(2)}%`;
  line.style.width = `${(((box[2] - box[0]) / PAGE_W) * 100).toFixed(2)}%`;
  line.style.top = `${(((box[3] - 3) / PAGE_H) * 100).toFixed(2)}%`;
  return line;
}

/** A pointer's position on a picture in the page's pixels, unaffected by the book's 3D transform. */
export const pagePx = (picture: HTMLElement, e: MouseEvent): { readonly px: number; readonly py: number } => ({
  px: (e.offsetX * PAGE_W) / (picture.offsetWidth || PAGE_W),
  py: (e.offsetY * PAGE_H) / (picture.offsetHeight || PAGE_H),
});

/**
 * A left-hand page: its picture, caption and folio. `onTap`, if given,
 * receives a tap on the picture as a point in the page's pixels.
 */
export function renderPicture(picture: HTMLElement | null, folio: string, onTap?: (px: number, py: number) => void, caption: readonly CaptionFact[] = []): HTMLElement {
  const page = el("div", "jp jp-picture");
  if (picture !== null) {
    page.append(picture);
    if (onTap !== undefined) {
      picture.classList.add("jp-tap");
      // Uses `onclick` so a redraw replaces the handler, since a map or painting is the same element on every redraw.
      picture.onclick = (e) => {
        e.stopPropagation();
        const at = pagePx(picture, e);
        onTap(at.px, at.py);
      };
    }
  }
  if (caption.length > 0) {
    // Lettered across the bottom of the picture.
    const plate = el("div", "jp-caption");
    for (const fact of caption) {
      const item = el("span", "jp-caption-item");
      item.append(el("span", "jp-caption-label", fact.label), el("span", "jp-caption-value", fact.value));
      plate.append(item);
    }
    page.append(plate);
  }
  page.append(el("div", "jp-folio", folio));
  return page;
}
