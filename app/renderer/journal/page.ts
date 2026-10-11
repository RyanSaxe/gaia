// One page of the journal, drawn from its words (`words.ts`): where it lives
// in small capitals, its name, its vitality as a wash and a reading, a
// definition's signature, then its list or its text. A list's rows are
// links: a tap turns to that page. Code is set in round 29's type with its
// line numbers written by hand down a pencil-ruled gutter; a long line wraps
// under a small hanging indent, and the page ends on a whole line, with the
// rest a drag away. A document is set as prose. A left-hand page carries its
// picture, and under it what Jev says of the thing as its caption. Nothing
// fades.

import type { Span } from "@gaia/schema";
import { TRAVELLER_SVG } from "../immersive/map-styles.ts";
import type { CaptionFact } from "./caption.ts";
import { type Piece, highlight } from "./highlight.ts";
import type { Fact, Folded, Full, Mark, PageWords, Row, Said } from "./words.ts";

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

/** A vitality as the page shows it: a small wash of its health color and its reading. */
function reading(v: number, cls: string): HTMLElement {
  const r = el("span", cls);
  const wash = el("i", "");
  wash.style.background = healthColor(v);
  r.append(wash, document.createTextNode(v.toFixed(2)));
  return r;
}

/** Jev's mark beside a row or a line: green for key to understanding, russet for could be better, stronger the surer Jev is. */
const MARK_COLOR = { understand: "#5f8f3e", improve: "#a4553a" } as const;
function marked(e: HTMLElement, mark: Mark | undefined): void {
  if (mark === undefined) return;
  e.classList.add("jp-marked");
  e.style.setProperty("--mark", MARK_COLOR[mark.kind]);
  e.style.setProperty("--mark-strength", (0.25 + 0.75 * Math.max(0, Math.min(1, mark.sure))).toFixed(2));
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
    // The surest mark over a line is the one its gutter shows.
    marked(row, body.marks.filter((m) => m.from <= n && n <= m.to).sort((a, b) => b.sure - a.sure)[0]);
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
    title.append(name, reading(words.vitality, "jp-vit"));
    head.append(title);
    if (words.signature !== undefined) head.append(signatureOf(words.signature, words.path.join("/")));
    head.append(el("div", "jp-rule"));
  }
  const body = el("div", "jp-body");
  if (words.body.kind === "rows") body.append(rowsOf(rows === undefined ? words.body.rows : words.body.rows.slice(rows.from, rows.to), turnTo));
  else if (words.body.kind === "code") {
    // From the line it opens at; lines above it fold away.
    const { opensAt, kind: _, ...code } = words.body;
    const skipped = opensAt - code.first;
    const shown: Full = { ...code, kind: "full", said: [], first: opensAt, lines: code.lines.slice(skipped) };
    if (skipped > 0 && inFull !== undefined) body.append(foldOf(skipped, inFull, "before"));
    setItems(body, shown, fullItems(shown), baseIndent(code.lines), piecesOf(code, words), turnTo);
    // Where a long definition's page ends, a fold: the book shows it, with how many lines it holds, when lines are left over.
    if (inFull !== undefined) body.append(foldOf(0, inFull, "after"));
  }
  page.append(head, body, el("div", "jp-folio", folio));
  return page;
}

/**
 * A definition in full, as the appendix sets it: everything Jev says about
 * the definition itself first, then its lines, what Jev says about a block
 * of them standing just above the block's first line. Each item is one row
 * on the page, so a page is a run of items.
 */
export type FullItem =
  | { readonly kind: "block"; readonly lines: Span }
  | { readonly kind: "fact"; readonly fact: Fact; readonly block: boolean }
  | { readonly kind: "line"; readonly at: number }
  | { readonly kind: "fold"; readonly fold: Folded }
  | { readonly kind: "rest"; readonly lines: number };

export function fullItems(body: Full): FullItem[] {
  const items: FullItem[] = [];
  const blocks = new Map<number, Said[]>();
  for (const said of body.said) {
    if (said.lines === undefined) items.push(...said.facts.map((fact) => ({ kind: "fact" as const, fact, block: false })));
    else blocks.set(said.lines.start, [...(blocks.get(said.lines.start) ?? []), said]);
  }
  const folds = new Map((body.folded ?? []).map((f) => [f.from, f]));
  for (let k = 0; k < body.lines.length; k++) {
    for (const said of blocks.get(body.first + k) ?? []) {
      items.push({ kind: "block", lines: said.lines as Span });
      items.push(...said.facts.map((fact) => ({ kind: "fact" as const, fact, block: true })));
    }
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

function factOf(fact: Fact, block: boolean): HTMLElement {
  const row = el("div", `jp-said-row jp-fact${block ? " in-block" : ""}`);
  const answer = el("span", "jp-fact-answer");
  // A choice or a yes or no is as strong as Jev is sure; a score's wash fills as far as it stands.
  const wash = el("i", fact.level !== undefined ? "level" : "sure");
  if (fact.level !== undefined) wash.style.setProperty("--level", fact.level.toFixed(2));
  else wash.style.opacity = (0.25 + 0.75 * (fact.sure ?? 0)).toFixed(2);
  answer.append(wash, document.createTextNode(fact.answer));
  row.append(el("span", "jp-fact-asked", fact.asked), el("span", "jp-dots"), answer);
  return row;
}

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
    title.append(backTo(el("button", "jp-name", words.name)), reading(words.vitality, "jp-vit"));
    head.append(title);
    if (words.signature !== undefined) head.append(signatureOf(words.signature, words.path.join("/")));
    head.append(el("div", "jp-rule"));
  }
  const content = el("div", "jp-body");
  setItems(content, body, fullItems(body).slice(items.from, items.to), baseIndent(body.lines), piecesOf(body, words), turnTo);
  page.append(head, content, el("div", "jp-folio", folio));
  return page;
}

/** Sets `items` of a text on a page: a run of its lines as code or prose, a folded definition as a line, a run of what Jev says as its rows. */
function setItems(content: HTMLElement, body: Full, items: readonly FullItem[], base: number, pieces: readonly (readonly Piece[])[], turnTo: (of: string) => void): void {
  let run: FullItem[] = [];
  const close = (): void => {
    const [start] = run;
    if (start === undefined) return;
    if (start.kind === "line") content.append(codeOf(run.map((r) => (r.kind === "line" ? r.at : 0)), body, base, pieces));
    else if (start.kind === "fold" || start.kind === "rest") {
      for (const r of run) content.append(r.kind === "fold" ? foldedOf(r.fold, turnTo) : el("div", "jp-rest", `${(r as Extract<FullItem, { kind: "rest" }>).lines.toLocaleString("en-US")} more lines, not set here`));
    } else {
      const said = el("div", `jp-said${start.kind === "fact" && !start.block ? "" : " in-code"}`);
      for (const r of run) said.append(r.kind === "block" ? el("div", "jp-said-row jp-said-block", r.lines.start === r.lines.end ? `line ${r.lines.start}` : `lines ${r.lines.start}–${r.lines.end}`) : factOf((r as Extract<FullItem, { kind: "fact" }>).fact, (r as Extract<FullItem, { kind: "fact" }>).block));
      content.append(said);
    }
    run = [];
  };
  const group = (item: FullItem): string => (item.kind === "line" ? "line" : item.kind === "fold" || item.kind === "rest" ? "fold" : "said");
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
      picture.addEventListener("click", (e) => {
        e.stopPropagation();
        // The tap in the picture's own layout pixels, which the book's turn and tilt leave alone.
        onTap((e.offsetX * PAGE_W) / (picture.offsetWidth || PAGE_W), (e.offsetY * PAGE_H) / (picture.offsetHeight || PAGE_H));
      });
    }
  }
  if (caption.length > 0) {
    // Lettered across the picture's foot, each answer as strong as Jev is sure of it.
    const plate = el("div", "jp-caption");
    for (const fact of caption) {
      const item = el("span", "jp-caption-item");
      const value = el("span", "jp-caption-value", fact.value);
      if (fact.sure !== undefined) value.style.opacity = (0.5 + 0.5 * fact.sure).toFixed(2);
      item.append(el("span", "jp-caption-label", fact.label), value);
      plate.append(item);
    }
    page.append(plate);
  }
  page.append(el("div", "jp-folio", folio));
  return page;
}
