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

/** A vitality as the page shows it: a small wash of its health color and its reading. */
function reading(v: number, cls: string): HTMLElement {
  const r = el("span", cls);
  const wash = el("i", "");
  wash.style.background = healthColor(v);
  r.append(wash, document.createTextNode(percent(v)));
  return r;
}

/** A page's two numbers beside its name: its quality, as its vitality's wash and reading, and how much it matters. */
function numbersOf(words: PageWords): HTMLElement {
  const numbers = el("span", "jp-numbers");
  const quality = el("span", "jp-number");
  quality.append(el("span", "jp-number-label", "quality"), reading(words.vitality, "jp-vit"));
  numbers.append(quality);
  if (words.importance !== undefined) {
    const importance = el("span", "jp-number");
    importance.append(el("span", "jp-number-label", "importance"), el("span", "jp-imp", percent(words.importance)));
    numbers.append(importance);
  }
  return numbers;
}

/** A mark beside a row or a line: green for key to understanding, russet for what needs work most, slate blue for a page's best part. */
const MARK_COLOR = { understand: "#5f8f3e", improve: "#a4553a", finest: "#4d6f8f" } as const;
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
    marked(row, r.mark);
    row.append(el("span", "jp-row-name", r.name), el("span", "jp-dots"), reading(r.vitality, "jp-row-vit"), el("span", "jp-row-page", r.page.toLocaleString("en-US")));
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      turnTo(r.of);
    });
    list.append(row);
  }
  return list;
}

/** What a snippet is called on the page: its kind, as the mark beside it says it. */
const LEAD_LABEL = { finest: "best", improve: "needs work most" } as const;

/**
 * A page's lead: each snippet a definition at a glance, marked as the best
 * or as what needs work most, its name and page, its first line and the block
 * Jev picked, the rest folded away; a tap turns to the definition's page.
 */
function leadOf(snippets: readonly Snippet[], path: string, turnTo: (of: string) => void): HTMLElement {
  const lead = el("div", "jp-lead");
  for (const s of snippets) {
    const snippet = el("button", "jp-snippet");
    snippet.type = "button";
    marked(snippet, { kind: s.kind });
    const head = el("span", "jp-snippet-head");
    head.append(el("span", "jp-snippet-label", LEAD_LABEL[s.kind]), el("span", "jp-snippet-name", s.name), el("span", "jp-dots"), el("span", "jp-row-page", s.page.toLocaleString("en-US")));
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
    const fold = (count: number): HTMLElement => el("span", "jp-snippet-fold", `${count.toLocaleString("en-US")} ${count === 1 ? "line" : "lines"}`);
    const code = el("span", "jp-code jp-snippet-code");
    code.append(line(0, s.signature.n));
    if (s.before > 0) code.append(fold(s.before));
    s.lines.forEach((_, k) => code.append(line(k + 1, s.first + k)));
    if (s.after > 0) code.append(fold(s.after));
    snippet.append(head, code);
    snippet.addEventListener("click", (e) => {
      e.stopPropagation();
      turnTo(s.of);
    });
    lead.append(snippet);
  }
  return lead;
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
    // The first mark over a line is the one its gutter shows.
    marked(row, body.marks.find((m) => m.from <= n && n <= m.to));
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
 * A page from its words; `turnTo` turns the book to a row's page, and `folio`
 * is the page's number. A list too long for one page is drawn a slice of rows
 * at a time: the first page under the full heading, each page it runs on to
 * under a running head, as a book's pages carry one.
 */
export function renderPage(words: PageWords, folio: string, turnTo: (of: string) => void, rows?: { readonly from: number; readonly to: number }, inFull?: () => void): HTMLElement {
  const page = el("div", "jp");
  page.style.setProperty("--health", healthColor(words.vitality));
  const head = el("div", "jp-head");
  if (rows !== undefined && rows.from > 0) head.append(el("div", "jp-running", [...words.path, words.name].join(" / ")));
  else {
    if (words.path.length > 0) head.append(el("div", "jp-where", words.path.join(" / ")));
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
  if (words.body.kind === "rows" && words.body.lead !== undefined && (rows === undefined || rows.from === 0)) body.append(leadOf(words.body.lead, words.path.join("/"), turnTo));
  if (words.body.kind === "rows") body.append(rowsOf(rows === undefined ? words.body.rows : words.body.rows.slice(rows.from, rows.to), turnTo));
  else if (words.body.kind === "code") {
    // From the line it opens at; lines above it fold away.
    const { opensAt, kind: _, ...code } = words.body;
    const skipped = opensAt - code.first;
    const shown: Full = { ...code, kind: "full", first: opensAt, lines: code.lines.slice(skipped) };
    if (skipped > 0 && inFull !== undefined) body.append(foldOf(skipped, inFull, "before"));
    setItems(body, shown, fullItems(shown), baseIndent(code.lines), piecesOf(shown, words), turnTo);
    // Where a long definition's page ends, a fold: the book shows it, with how many lines it holds, when lines are left over.
    if (inFull !== undefined) body.append(foldOf(0, inFull, "after"));
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
 * `fullItems`, its first page under the full heading and the rest under a
 * running head; both turn back to its page in the journal.
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
    if (words.path.length > 0) head.append(backTo(el("button", "jp-where jp-back", words.path.join(" / "))));
    const title = el("div", "jp-title");
    title.append(backTo(el("button", "jp-name", words.name)), numbersOf(words));
    head.append(title);
    if (words.signature !== undefined) head.append(signatureOf(words.signature, words.path.join("/")));
    head.append(el("div", "jp-rule"));
  }
  const content = el("div", "jp-body");
  setItems(content, body, fullItems(body).slice(items.from, items.to), baseIndent(body.lines), piecesOf(body, words), turnTo);
  page.append(head, content, el("div", "jp-folio", folio));
  return page;
}

/** Sets `items` of a text on a page: a run of its lines as code or prose, and a folded definition as a line. */
function setItems(content: HTMLElement, body: Full, items: readonly FullItem[], base: number, pieces: readonly (readonly Piece[])[], turnTo: (of: string) => void): void {
  let run: FullItem[] = [];
  const close = (): void => {
    const [start] = run;
    if (start === undefined) return;
    if (start.kind === "line") content.append(codeOf(run.map((r) => (r.kind === "line" ? r.at : 0)), body, base, pieces));
    else for (const r of run) content.append(r.kind === "fold" ? foldedOf(r.fold, turnTo) : el("div", "jp-rest", `${(r as Extract<FullItem, { kind: "rest" }>).lines.toLocaleString("en-US")} more lines, not set here`));
    run = [];
  };
  const group = (item: FullItem): string => (item.kind === "line" ? "line" : "fold");
  for (const item of items) {
    if (run.length > 0 && group(run[0] as FullItem) !== group(item)) close();
    run.push(item);
  }
  close();
}

/** A definition folded in its file's text: how many lines it holds and its page, a tap turning to it. */
function foldedOf(fold: Folded, turnTo: (of: string) => void): HTMLElement {
  const lines = fold.to - fold.from + 1;
  const row = el("button", "jp-fold inline", `${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"}, page ${fold.page.toLocaleString("en-US")}`);
  row.type = "button";
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    turnTo(fold.of);
  });
  return row;
}

/** A fold: a dotted rule across the code with how many lines it holds, which turns to the definition in full. */
function foldOf(lines: number, inFull: () => void, where: "before" | "after"): HTMLElement {
  const fold = el("button", `jp-fold ${where}`, lines > 0 ? `${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"} ${where === "before" ? "before" : "more"}` : "");
  fold.type = "button";
  fold.addEventListener("click", (e) => {
    e.stopPropagation();
    inFull();
  });
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
