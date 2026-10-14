// One page of the journal, drawn from its words (`words.ts`): where it lives
// in small capitals, its name, its vitality as a wash and a reading, a
// definition's signature, then its list or its text. A list's rows are
// links: a tap turns to that page. Code is set in round 29's type with its
// line numbers written by hand down a pencil-ruled gutter; a long line wraps
// under a small hanging indent, and the page ends on a whole line, with the
// rest a drag away. A document is set as prose. A left-hand page carries its
// picture, and under it what Jev says of the thing as its caption. Nothing
// fades.

import { TRAVELLER_SVG } from "../immersive/map-styles.ts";
import type { CaptionFact } from "./caption.ts";
import { type Piece, highlight } from "./highlight.ts";
import type { Folded, Full, Mark, PageWords, Row, Snippet } from "./words.ts";

/** The field map's health colors: russet when failing, ochre as it declines, green when well. */
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

/** A page's size in its own pixels, as the book lays it. */
const PAGE_W = 520;
const PAGE_H = 660;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A score as the page shows it: a percentage, so it reads as a share of 0 to 1. */
const percent = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** The ink an importance's meter is drawn in; a quality's is its health color. */
const INK = "#6b5640";

/** A score as the page shows it: a short meter filled to its share, then its percentage. */
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

/** A page's two numbers beside its name, each with its meter: its quality, in its health color, and how much it matters, in ink. */
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

/** A mark beside a line of the appendix: green for key to understanding, russet for what needs work most. */
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

/** An entity's trails, at its page's foot, by their way: what it imports from and what imports from it, each name a tap to its page. */
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

/** What a marked block is called in the appendix, in its stroke's color where its code starts. */
const MARK_LABEL = { improve: "weak", understand: "key" } as const;

/**
 * A page's lead: the definition that matters most, at a glance, unmarked:
 * the name of the part it stands for and that part's page, then its first
 * line and its key block, the rest folded away. A tap on the name turns to
 * that part's page; a tap on the code, to the definition in full, as the
 * reference under it says.
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
    // A snippet is a button itself, which never holds another, so its reference is lettered, not a button.
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
 * A reference by hand, as a book says where something goes on: "→ in full,
 * p. 5,415a" to the appendix, or "← back to its page, p. 5,415". A tap goes
 * where it says.
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

/** Where a thing lives, in small capitals, each folder a tap to its page, and in a definition's path its file a tap to the file's. */
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

/** How far a definition's lines are indented in common: what its code is set back by on the page. */
const baseIndent = (lines: readonly string[]): number => Math.min(...lines.filter((l) => l.trim() !== "").map(indentOf), Infinity);

/** A definition's signature, inked as its code is. */
function signatureOf(signature: string, path: string): HTMLElement {
  const sig = el("div", "jp-sig");
  sig.append(...inkedLine(highlight([signature], path)[0], signature).childNodes);
  return sig;
}

/** A line's text as its pieces, inked by what each is, without the indent the page sets as a hanging indent. */
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
    // The first mark over a line is the one its stroke shows; the block's first line says what it is.
    const mark = body.marks.find((m) => m.from <= n && n <= m.to);
    marked(row, mark);
    if (mark !== undefined && mark.from === n) row.dataset.label = MARK_LABEL[mark.kind];
    if (body.prose === true) {
      // A document's heading is set as one, without the marks that make it; a fenced block's lines as code.
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
 * A page of a file's code as a riffle's leaf shows it in passing: the file's path as its running head, its lines
 * from `first` set as every page sets code, and its number.
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

/** Where a page's text is set in full: a turn there, and the number of its first page in the appendix, such as "5,475a". */
export interface InFull {
  readonly turn: () => void;
  readonly folio: string;
}

/**
 * A page from its words; `turnTo` turns the book to a row's page, and `folio`
 * is the page's number. A list too long for one page is drawn a slice of rows
 * at a time: the first page under the full heading, each page it runs on to
 * under a running head, as a book's pages carry one. A page with text names
 * where it is set in full (`full`): its name, its folds and its code turn
 * there, and a reference at its foot says where. `fullOf` names where any
 * definition is set in full, for the code a page leads with.
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
    // From the line it opens at; lines above it fold away.
    const { opensAt, kind: _, ...code } = words.body;
    const skipped = opensAt - code.first;
    const shown: Full = { ...code, kind: "full", first: opensAt, lines: code.lines.slice(skipped) };
    if (skipped > 0 && inFull !== undefined) body.append(foldOf(linesOf(skipped), inFull));
    setItems(body, shown, fullItems(shown), baseIndent(code.lines), piecesOf(shown, words), turnTo);
    // Where a long definition's page ends, a fold: the book shows it, with how many lines it holds, when lines are left over.
    if (full !== undefined) {
      body.append(foldOf("", full.turn, "after"));
      // The code itself is a tap to it in full, and the page's foot says where that is.
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
 * A text in full, as the appendix sets it: its lines, each definition with a
 * page of its own folded to one line, and how many lines are left out. Each
 * item is one row on the page, so a page is a run of items.
 */
export type FullItem =
  | { readonly kind: "line"; readonly at: number }
  | { readonly kind: "fold"; readonly fold: Folded }
  | { readonly kind: "rest"; readonly lines: number };

export function fullItems(body: Full): FullItem[] {
  const items: FullItem[] = [];
  const folds = new Map((body.folded ?? []).map((f) => [f.from, f]));
  for (let k = 0; k < body.lines.length; k++) {
    // A definition with a page of its own is one line here, which turns to it.
    const fold = folds.get(body.first + k);
    if (fold !== undefined) {
      items.push({ kind: "fold", fold });
      k += fold.to - fold.from;
    } else items.push({ kind: "line", at: k });
  }
  if (body.rest !== undefined) items.push({ kind: "rest", lines: body.rest });
  return items;
}

/** Each of a text's lines as its pieces, inked by what they are; a document's are left plain. */
const piecesOf = (body: Pick<Full, "lines" | "prose">, words: PageWords): Piece[][] => (body.prose === true ? [] : highlight(body.lines, words.path.join("/")));

/**
 * A page of a definition in full, in the appendix: `items` of its
 * `fullItems`, its first page under the full heading, its path a way up to
 * each folder, and a reference back to its page in the journal at its foot;
 * the rest under a running head, which turns back there too.
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
  // Its first page says by hand where its page in the journal is: the appendix's number without its letter.
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
        // A definition with a page of its own folds to one line that turns there; past what the appendix sets, the rest.
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

/** How many lines, as a fold says it: "1 line", "20 lines". */
export const linesOf = (n: number): string => `${n.toLocaleString("en-US")} ${n === 1 ? "line" : "lines"}`;

/**
 * Lines folded away, wherever code is shown: "⋯ 20 lines" in the hand at the
 * code's indent, with anything else it says, such as the page they are on,
 * and a tap to them where they can be read. Every fold in the journal is this
 * one; a long definition's page folds where it ends (`after`), which the book
 * places and words once the page is laid out.
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
 * The title page, facing the contents: a frontispiece painting of the world
 * running to the page's edges, the world's name lettered across its sky as
 * the map letters a place, and its vitality as a wash beneath.
 */
export function renderTitle(name: string, vitality: number, folio: string, painting: HTMLElement): HTMLElement {
  const page = el("div", "jp jp-picture jp-title-page");
  page.style.setProperty("--health", healthColor(vitality));
  const lettered = el("div", "jp-title-lettering");
  const wash = el("i", "jp-title-wash");
  wash.style.background = healthColor(vitality);
  lettered.append(el("div", "jp-book-name", name), wash);
  page.append(painting, lettered, el("div", "jp-folio", folio));
  return page;
}

/** You are here, on a map's page: the field map's own traveller, their footprints behind them along the way they look. */
export function renderTraveller(px: number, py: number, yaw: number): HTMLElement {
  const here = el("div", "jp-here");
  here.innerHTML = TRAVELLER_SVG;
  here.style.left = `${((px / PAGE_W) * 100).toFixed(2)}%`;
  here.style.top = `${((py / PAGE_H) * 100).toFixed(2)}%`;
  here.querySelector(".traveller-steps")?.setAttribute("transform", `rotate(${((-yaw * 180) / Math.PI).toFixed(1)})`);
  return here;
}

/** A spot marked on a map's page: a vermilion pencil cross, the field map's own mark. A second click on it travels there. */
export function renderCross(px: number, py: number): HTMLElement {
  const cross = el("div", "jp-cross");
  cross.innerHTML = '<svg viewBox="0 0 18 18"><path d="M3 3 L15 15 M15 3 L3 15"/></svg>';
  cross.style.left = `${((px / PAGE_W) * 100).toFixed(2)}%`;
  cross.style.top = `${((py / PAGE_H) * 100).toFixed(2)}%`;
  return cross;
}

/** A pencil underline under a name lettered on a map, while the pointer is on it; `box` in the page's pixels. */
export function renderNameLine(box: readonly [number, number, number, number]): HTMLElement {
  const line = el("div", "jp-name-line");
  line.style.left = `${((box[0] / PAGE_W) * 100).toFixed(2)}%`;
  line.style.width = `${(((box[2] - box[0]) / PAGE_W) * 100).toFixed(2)}%`;
  line.style.top = `${(((box[3] - 3) / PAGE_H) * 100).toFixed(2)}%`;
  return line;
}

/** A pointer's spot on a picture, in the page's own pixels, which the book's turn and tilt leave alone. */
export const pagePx = (picture: HTMLElement, e: MouseEvent): { readonly px: number; readonly py: number } => ({
  px: (e.offsetX * PAGE_W) / (picture.offsetWidth || PAGE_W),
  py: (e.offsetY * PAGE_H) / (picture.offsetHeight || PAGE_H),
});

/**
 * A left-hand page: its picture, its caption and its number. `onTap`, given,
 * hears a tap on the picture, at a spot in the page's own pixels.
 */
export function renderPicture(picture: HTMLElement | null, folio: string, onTap?: (px: number, py: number) => void, caption: readonly CaptionFact[] = []): HTMLElement {
  const page = el("div", "jp jp-picture");
  if (picture !== null) {
    page.append(picture);
    if (onTap !== undefined) {
      picture.classList.add("jp-tap");
      // One handler, set afresh: a map or a painting is the same element each time its page is drawn.
      picture.onclick = (e) => {
        e.stopPropagation();
        const at = pagePx(picture, e);
        onTap(at.px, at.py);
      };
    }
  }
  if (caption.length > 0) {
    // Lettered across the picture's foot.
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
