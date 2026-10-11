// One page of the journal, drawn from its words (`words.ts`): where it lives
// in small capitals, its name, its vitality as a wash and a reading, a
// definition's signature, then its list or its code. A list's rows are
// links: a tap turns to that page. Code is set in round 29's type with its
// line numbers written by hand down a pencil-ruled gutter; a long line wraps
// under a small hanging indent, and the page ends on a whole line, with the
// rest a drag away. Nothing fades.

import type { Span } from "@gaia/schema";
import type { Fact, Full, Mark, PageWords, Row, Said } from "./words.ts";

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

function codeOf(first: number, lines: readonly string[], marks: readonly (Mark & { readonly from: number; readonly to: number })[], base = baseIndent(lines)): HTMLElement {
  const code = el("div", "jp-code");
  lines.forEach((line, k) => {
    const row = el("div", "jp-line");
    row.dataset.line = String(first + k);
    // The surest mark over a line is the one its gutter shows.
    marked(row, marks.filter((m) => m.from <= first + k && first + k <= m.to).sort((a, b) => b.sure - a.sure)[0]);
    const text = el("span", "jp-text", line.trim());
    text.style.setProperty("--ind", String(Number.isFinite(base) ? indentOf(line) - base : 0));
    row.append(el("span", "jp-ln", String(first + k)), text);
    code.append(row);
  });
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
    if (words.signature !== undefined) head.append(el("div", "jp-sig", words.signature));
    head.append(el("div", "jp-rule"));
  }
  const body = el("div", "jp-body");
  if (words.body.kind === "rows") body.append(rowsOf(rows === undefined ? words.body.rows : words.body.rows.slice(rows.from, rows.to), turnTo));
  else if (words.body.kind === "code") {
    const code = codeOf(words.body.first, words.body.lines, words.body.marks);
    // Where a long definition's page ends, a fold: the book shows it, with how many lines it holds, when lines are left over.
    if (inFull !== undefined) {
      const fold = el("button", "jp-fold");
      fold.type = "button";
      fold.addEventListener("click", (e) => {
        e.stopPropagation();
        inFull();
      });
      code.append(fold);
    }
    body.append(code);
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
export type FullItem = { readonly kind: "block"; readonly lines: Span } | { readonly kind: "fact"; readonly fact: Fact; readonly block: boolean } | { readonly kind: "line"; readonly at: number };

export function fullItems(body: Full): FullItem[] {
  const items: FullItem[] = [];
  const blocks = new Map<number, Said[]>();
  for (const said of body.said) {
    if (said.lines === undefined) items.push(...said.facts.map((fact) => ({ kind: "fact" as const, fact, block: false })));
    else blocks.set(said.lines.start, [...(blocks.get(said.lines.start) ?? []), said]);
  }
  body.lines.forEach((_, k) => {
    for (const said of blocks.get(body.first + k) ?? []) {
      items.push({ kind: "block", lines: said.lines as Span });
      items.push(...said.facts.map((fact) => ({ kind: "fact" as const, fact, block: true })));
    }
    items.push({ kind: "line", at: k });
  });
  return items;
}

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
export function renderFullPage(words: PageWords, body: Full, folio: string, items: { readonly from: number; readonly to: number }, first: boolean, back: () => void): HTMLElement {
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
    if (words.signature !== undefined) head.append(el("div", "jp-sig", words.signature));
    head.append(el("div", "jp-rule"));
  }
  const content = el("div", "jp-body");
  const base = baseIndent(body.lines);
  let run: FullItem[] = [];
  const close = (): void => {
    const [start] = run;
    if (start === undefined) return;
    if (start.kind === "line") {
      const at = run.map((r) => (r.kind === "line" ? r.at : 0));
      content.append(codeOf(body.first + (at[0] as number), at.map((k) => body.lines[k] as string), body.marks, base));
    } else {
      const said = el("div", `jp-said${start.kind === "fact" && !start.block ? "" : " in-code"}`);
      for (const r of run) said.append(r.kind === "block" ? el("div", "jp-said-row jp-said-block", r.lines.start === r.lines.end ? `line ${r.lines.start}` : `lines ${r.lines.start}–${r.lines.end}`) : factOf((r as Extract<FullItem, { kind: "fact" }>).fact, (r as Extract<FullItem, { kind: "fact" }>).block));
      content.append(said);
    }
    run = [];
  };
  for (const item of fullItems(body).slice(items.from, items.to)) {
    if (run.length > 0 && (run[0]?.kind === "line") !== (item.kind === "line")) close();
    run.push(item);
  }
  close();
  page.append(head, content, el("div", "jp-folio", folio));
  return page;
}

/** The title page, facing the contents: the world's name and its vitality, large. */
export function renderTitle(name: string, vitality: number, folio: string): HTMLElement {
  const page = el("div", "jp jp-title-page");
  page.style.setProperty("--health", healthColor(vitality));
  const middle = el("div", "jp-title-middle");
  middle.append(el("div", "jp-book-name", name), reading(vitality, "jp-vit"));
  page.append(middle, el("div", "jp-folio", folio));
  return page;
}

/** A left-hand page: its picture, until it is painted bare paper, and its number. */
export function renderPicture(picture: HTMLElement | null, folio: string): HTMLElement {
  const page = el("div", "jp jp-picture");
  if (picture !== null) page.append(picture);
  page.append(el("div", "jp-folio", folio));
  return page;
}
