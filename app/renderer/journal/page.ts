// One page of the journal, drawn from its words (`words.ts`): where it lives
// in small capitals, its name, its vitality as a wash and a reading, a
// definition's signature, then its list or its code. A list's rows are
// links: a tap turns to that page. Code is set in round 29's type with its
// line numbers written by hand down a pencil-ruled gutter; a long line wraps
// under a small hanging indent, and the page ends on a whole line, with the
// rest a drag away. Nothing fades.

import type { PageWords, Row } from "./words.ts";

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

function rowsOf(rows: readonly Row[], turnTo: (of: string) => void): HTMLElement {
  const list = el("div", "jp-rows");
  for (const r of rows) {
    const row = el("button", `jp-row d${Math.min(r.depth, 3)}`);
    row.type = "button";
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

function codeOf(first: number, lines: readonly string[]): HTMLElement {
  const code = el("div", "jp-code");
  const base = Math.min(...lines.filter((l) => l.trim() !== "").map(indentOf), Infinity);
  lines.forEach((line, k) => {
    const row = el("div", "jp-line");
    row.dataset.line = String(first + k);
    const text = el("span", "jp-text", line.trim());
    text.style.setProperty("--ind", String(Number.isFinite(base) ? indentOf(line) - base : 0));
    row.append(el("span", "jp-ln", String(first + k)), text);
    code.append(row);
  });
  return code;
}

/** A page from its words; `turnTo` turns the book to a row's page, and `folio` is the page's number. */
export function renderPage(words: PageWords, folio: string, turnTo: (of: string) => void): HTMLElement {
  const page = el("div", "jp");
  page.style.setProperty("--health", healthColor(words.vitality));
  const head = el("div", "jp-head");
  if (words.path.length > 0) head.append(el("div", "jp-where", words.path.join(" / ")));
  const title = el("div", "jp-title");
  title.append(el("span", "jp-name", words.name), reading(words.vitality, "jp-vit"));
  head.append(title);
  if (words.signature !== undefined) head.append(el("div", "jp-sig", words.signature));
  head.append(el("div", "jp-rule"));
  const body = el("div", "jp-body");
  body.append(words.body.kind === "rows" ? rowsOf(words.body.rows, turnTo) : codeOf(words.body.first, words.body.lines));
  page.append(head, body, el("div", "jp-folio", folio));
  return page;
}

/** A left-hand page: its picture, until it is painted bare paper, and its number. */
export function renderPicture(picture: HTMLElement | null, folio: string): HTMLElement {
  const page = el("div", "jp jp-picture");
  if (picture !== null) page.append(picture);
  page.append(el("div", "jp-folio", folio));
  return page;
}
