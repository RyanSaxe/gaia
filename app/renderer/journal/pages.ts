// What the journal opens onto, spread by spread: the map across the
// endpapers; the title page facing the contents, the contents running on as
// far as they need; then each place and thing in the order the code's tree
// lists them (`journalOf`), its picture facing its first page, and a long
// list running on over the spreads after. Each spread is drawn from its words
// (`words.ts`) and its picture when it comes into view; until the pictures
// are painted, a left-hand page is bare paper.

import type { Journal, JournalEntry, PageRoom } from "@gaia/world";
import type { BookPages, Spread } from "./book.ts";
import { fullItems, renderFullPage, renderPage, renderPicture, renderTitle } from "./page.ts";
import { type Full, type PageWords, type WordsSource, appendixWords, contentsWords, wordsOf } from "./words.ts";

/** How many of the things after an open page are painted ahead of the reader. */
const AHEAD = 4;
/** How many rows of a list a page holds: under the heading, and under a running head on the pages it runs on to. */
export const ROOM: PageRoom = { first: 18, next: 21 };

export interface JournalPagesSource {
  /** The words' source for the world standing now, or null before one stands. */
  words(): WordsSource | null;
  /** One half of the whole land's map across the endpapers, or null before the map is painted. */
  endpaper(side: "left" | "right"): HTMLElement | null;
  /** A folder's own map, for its chapter's left-hand page, or null before the map is painted. */
  map(area: string): HTMLElement | null;
  /** The painting of the thing a page is about, for its left-hand page, filling in as it is painted. */
  picture(of: string): HTMLElement;
  /** Paints the things these pages are about next, in this order. */
  ahead(ofs: readonly string[]): void;
  /** Turns the book to a place, for a row tapped on a page. */
  turnTo(at: string): void;
  /** Settles once a file's text has come, for a definition's page. */
  text(path: string): Promise<void>;
}

/** The spreads a list of `rows` takes from its first page on: the first page faces its picture, the rest come two to a spread. */
const pagesOf = (rows: number): number => (rows <= ROOM.first ? 1 : 1 + Math.ceil((rows - ROOM.first) / ROOM.next));
const spreadsOf = (pages: number): number => 1 + Math.ceil((pages - 1) / 2);
/** A spread after an entry's first is named by the entry and its place among them. */
const SEP = "§";
const nth = (of: string, k: number): string => (k === 0 ? of : `${of}${SEP}${k}`);
/**
 * The appendix at the back: every definition in full, in the book's order,
 * each opening on a spread of its own. A place there names the definition
 * and its spread, or "end" for its last, whose number is known once its code
 * has come and been laid out.
 */
const APPENDIX = "appendix:";
const inFull = (id: string, k: number | "end"): string => `${APPENDIX}${id}${SEP}${k}`;
const fullAt = (at: string): { id: string; k: number | "end" } | null => {
  if (!at.startsWith(APPENDIX)) return null;
  const [id, k] = at.slice(APPENDIX.length).split(SEP);
  return { id: id as string, k: k === "end" ? "end" : Number(k ?? 0) };
};
/** A page of the appendix is numbered by its definition's page in the journal and a letter: 2,055a, 2,055b, … */
const lettered = (n: number): string => (n < 26 ? String.fromCharCode(97 + n) : lettered(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
/** The rows a page holds, by the page's place in its list (0 for the first). */
const rowsOn = (page: number): { from: number; to: number } =>
  page === 0 ? { from: 0, to: ROOM.first } : { from: ROOM.first + (page - 1) * ROOM.next, to: ROOM.first + page * ROOM.next };

/** A run of a definition's items in full, one page's worth. */
type Slice = { readonly from: number; readonly to: number };

/**
 * How a definition in full falls into pages: each item measured once as the
 * page will set it, in a page of the book's size kept out of sight, then laid
 * page by page until the next would not fit whole, so every page ends on a
 * whole row and nothing is ever cut.
 */
function layOut(words: PageWords, body: Full, host: HTMLElement): Slice[] {
  const total = fullItems(body).length;
  const measure = (first: boolean, slice: Slice): { room: number; rows: { top: number; bottom: number }[] } => {
    const page = renderFullPage(words, body, "", slice, first, () => {});
    host.replaceChildren(page);
    const holder = page.querySelector(".jp-body") as HTMLElement;
    const top = holder.getBoundingClientRect().top;
    const rows = [...holder.querySelectorAll<HTMLElement>(".jp-said-row, .jp-line")].map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top - top, bottom: b.bottom - top };
    });
    return { room: holder.clientHeight, rows };
  };
  const { room: firstRoom, rows } = measure(true, { from: 0, to: total });
  const { room: nextRoom } = measure(false, { from: 0, to: 0 });
  host.replaceChildren();
  const pages: Slice[] = [];
  for (let from = 0, room = firstRoom; from < total || pages.length === 0; room = nextRoom) {
    let to = from;
    const start = rows[from]?.top ?? 0;
    while (to < total && (rows[to]?.bottom ?? 0) - start <= room) to++;
    if (to === from && from < total) to++;
    pages.push({ from, to });
    from = to;
  }
  return pages;
}

export function journalPages(src: JournalPagesSource): BookPages {
  let indexed: { words: WordsSource | null; places: readonly string[]; order: Map<string, number>; contents: number } | null = null;
  const index = (): NonNullable<typeof indexed> => {
    const words = src.words();
    if (indexed === null || indexed.words !== words) {
      const listed = words === null ? undefined : contentsWords(words).body;
      const contents = spreadsOf(pagesOf(listed?.kind === "rows" ? listed.rows.length : 0));
      const places = ["map", ...Array.from({ length: contents }, (_, k) => nth("contents", k)), ...(words?.journal.entries.flatMap((e) => Array.from({ length: spreadsOf(e.pages) }, (_, k) => nth(e.of, k))) ?? [])];
      indexed = { words, places, order: new Map(places.map((p, k) => [p, k])), contents };
    }
    return indexed;
  };
  /** Each definition's place in the appendix's order, and how its full code falls into pages once laid out. */
  let definitions: { words: WordsSource | null; ids: readonly string[]; at: Map<string, number>; laid: Map<string, Slice[]> } | null = null;
  const inOrder = (): NonNullable<typeof definitions> => {
    const words = src.words();
    if (definitions === null || definitions.words !== words) {
      const ids = words?.journal.entries.filter((e) => e.kind === "definition").map((e) => e.of) ?? [];
      definitions = { words, ids, at: new Map(ids.map((id, k) => [id, k])), laid: new Map() };
    }
    return definitions;
  };
  let host: HTMLElement | null = null;
  /** A definition's pages in the appendix, laid out once its code has come; null before. */
  function pagesInFull(id: string): Slice[] | null {
    const words = src.words();
    const e = words?.journal.entry(id);
    if (words === null || e === undefined) return null;
    const order = inOrder();
    const known = order.laid.get(id);
    if (known !== undefined) return known;
    const said = appendixWords(words, e);
    if (said.body.kind !== "full" || words.lines(id.slice(0, id.indexOf("#"))) === undefined) return null;
    if (host === null) {
      host = document.createElement("div");
      host.className = "journal-measure";
      host.style.cssText = "position: fixed; left: -4000px; top: 0; width: 520px; height: 660px; visibility: hidden; pointer-events: none;";
      document.body.append(host);
    }
    const laid = layOut(said, said.body, host);
    order.laid.set(id, laid);
    return laid;
  }
  /** Which spread of a definition's appendix a place is, "end" made its last. */
  const spreadIn = (id: string, k: number | "end"): number => (k === "end" ? Math.max(0, Math.ceil((pagesInFull(id)?.length ?? 1) / 2) - 1) : k);
  function fullSpread(id: string, k: number | "end"): Spread {
    const words = src.words();
    const e = words?.journal.entry(id);
    const laid = pagesInFull(id);
    if (words === null || e === undefined || laid === null) return { left: blank(), right: blank() };
    const said = appendixWords(words, e);
    if (said.body.kind !== "full") return { left: blank(), right: blank() };
    const body = said.body;
    const kk = spreadIn(id, k);
    const page = (p: number): HTMLElement => {
      const slice = laid[p];
      return slice === undefined ? blank() : renderFullPage(said, body, `${e.page.toLocaleString("en-US")}${lettered(p)}`, slice, p === 0, () => src.turnTo(id));
    };
    return { left: page(2 * kk), right: page(2 * kk + 1) };
  }

  const folio = (n: number): string => (n > 0 ? n.toLocaleString("en-US") : "");
  const roman = (n: number): string => ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n] ?? String(n);
  const blank = (f = ""): HTMLElement => renderPicture(null, f);

  function entrySpread(words: WordsSource, e: JournalEntry, k: number): Spread {
    const said = wordsOf(words, e);
    // Page p of the entry's words (0 for the first): its number, and the slice of the list it holds.
    const toFull = e.kind === "definition" ? () => src.turnTo(inFull(e.of, 0)) : undefined;
    const page = (p: number): HTMLElement => (p >= e.pages ? blank() : renderPage(said, folio(e.page + p), src.turnTo, said.body.kind === "rows" ? rowsOn(p) : undefined, toFull));
    // A chapter faces its folder's map; anything that stands faces its painting, bare paper until it is painted.
    if (k === 0) return { left: renderPicture(e.kind === "chapter" ? src.map(e.of) : src.picture(e.of), folio(e.page - 1)), right: page(0) };
    return { left: page(2 * k - 1), right: page(2 * k) };
  }

  return {
    spread(at): Spread {
      const full = fullAt(at);
      if (full !== null) return fullSpread(full.id, full.k);
      const words = src.words();
      if (at === "map" || words === null) return { left: renderPicture(src.endpaper("left"), ""), right: renderPicture(src.endpaper("right"), "") };
      const [of, kk] = at.split(SEP);
      const k = Number(kk ?? 0);
      if (of === "contents") {
        // The contents face the title page, and run on two pages to a spread, numbered in small roman.
        const contents = contentsWords(words);
        const page = (p: number): HTMLElement =>
          contents.body.kind === "rows" && rowsOn(p).from < contents.body.rows.length ? renderPage({ ...contents, name: "Contents", path: [] }, roman(p + 2), src.turnTo, rowsOn(p)) : blank();
        return k === 0 ? { left: renderTitle(words.world.name, words.vitality(""), roman(1)), right: page(0) } : { left: page(2 * k - 1), right: page(2 * k) };
      }
      const e = words.journal.entry(of as string);
      if (e === undefined) return { left: blank(), right: blank() };
      // The next few things in the book are painted next, so turning on rarely finds bare paper.
      const here = words.journal.entries.indexOf(e);
      src.ahead(words.journal.entries.slice(here + 1, here + 1 + AHEAD).filter((n) => n.kind !== "chapter").map((n) => n.of));
      return entrySpread(words, e, k);
    },
    next(at, by) {
      const { order, places } = index();
      const full = fullAt(at);
      if (full === null) {
        const k = (order.get(at) ?? 0) + by;
        // Past the journal's last page comes the appendix.
        if (k === places.length && by === 1) return inOrder().ids[0] === undefined ? null : inFull(inOrder().ids[0] as string, 0);
        return places[k] ?? null;
      }
      const { ids, at: where } = inOrder();
      const n = where.get(full.id) ?? 0;
      const k = spreadIn(full.id, full.k);
      if (by === 1) {
        if (k + 1 < Math.ceil((pagesInFull(full.id)?.length ?? 1) / 2)) return inFull(full.id, k + 1);
        return ids[n + 1] === undefined ? null : inFull(ids[n + 1] as string, 0);
      }
      if (k > 0) return inFull(full.id, k - 1);
      return n > 0 ? inFull(ids[n - 1] as string, "end") : (places[places.length - 1] ?? null);
    },
    order(a, b) {
      const { order } = index();
      const { at: where } = inOrder();
      const rank = (p: string): readonly [number, number, number] => {
        const full = fullAt(p);
        return full === null ? [0, order.get(p) ?? 0, 0] : [1, where.get(full.id) ?? 0, full.k === "end" ? Infinity : full.k];
      };
      const [ra, rb] = [rank(a), rank(b)];
      return ra[0] - rb[0] || ra[1] - rb[1] || (ra[2] === rb[2] ? 0 : ra[2] < rb[2] ? -1 : 1);
    },
    async ready(at) {
      const full = fullAt(at);
      const of = full?.id ?? (at.split(SEP)[0] as string);
      const e = src.words()?.journal.entry(of);
      if (e?.kind !== "definition") return;
      await src.text(e.of.slice(0, e.of.indexOf("#")));
      // A definition's appendix is laid out before the leaf that shows it moves.
      if (full !== null) pagesInFull(full.id);
    },
    tabs() {
      const journal: Journal | undefined = index().words?.journal;
      return (journal?.contents ?? []).flatMap((of) => {
        const e = journal?.entry(of);
        return e?.kind === "chapter" ? [{ name: e.name, at: of }] : [];
      });
    },
  };
}
