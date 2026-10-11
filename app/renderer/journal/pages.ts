// What the journal opens onto, spread by spread: the map across the
// endpapers; the title page facing the contents, the contents running on as
// far as they need; then each place and thing in the order the code's tree
// lists them (`journalOf`), its picture facing its first page, and a long
// list running on over the spreads after. Each spread is drawn from its words
// (`words.ts`) and its picture when it comes into view; until the pictures
// are painted, a left-hand page is bare paper.

import type { Journal, JournalEntry, PageRoom } from "@gaia/world";
import type { BookPages, Spread } from "./book.ts";
import { renderPage, renderPicture, renderTitle } from "./page.ts";
import { type WordsSource, contentsWords, wordsOf } from "./words.ts";

/** How many rows of a list a page holds: under the heading, and under a running head on the pages it runs on to. */
export const ROOM: PageRoom = { first: 18, next: 21 };

export interface JournalPagesSource {
  /** The words' source for the world standing now, or null before one stands. */
  words(): WordsSource | null;
  /** One half of the map across the endpapers, or null before it is painted. */
  map(side: "left" | "right"): HTMLElement | null;
  /** Turns the book to a place, for a row tapped on a page. */
  turnTo(at: string): void;
}

/** The spreads a list of `rows` takes from its first page on: the first page faces its picture, the rest come two to a spread. */
const pagesOf = (rows: number): number => (rows <= ROOM.first ? 1 : 1 + Math.ceil((rows - ROOM.first) / ROOM.next));
const spreadsOf = (pages: number): number => 1 + Math.ceil((pages - 1) / 2);
/** A spread after an entry's first is named by the entry and its place among them. */
const SEP = "§";
const nth = (of: string, k: number): string => (k === 0 ? of : `${of}${SEP}${k}`);
/** The rows a page holds, by the page's place in its list (0 for the first). */
const rowsOn = (page: number): { from: number; to: number } =>
  page === 0 ? { from: 0, to: ROOM.first } : { from: ROOM.first + (page - 1) * ROOM.next, to: ROOM.first + page * ROOM.next };

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
  const folio = (n: number): string => (n > 0 ? n.toLocaleString("en-US") : "");
  const roman = (n: number): string => ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n] ?? String(n);
  const blank = (f = ""): HTMLElement => renderPicture(null, f);

  function entrySpread(words: WordsSource, e: JournalEntry, k: number): Spread {
    const said = wordsOf(words, e);
    // Page p of the entry's words (0 for the first): its number, and the slice of the list it holds.
    const page = (p: number): HTMLElement => (p >= e.pages ? blank() : renderPage(said, folio(e.page + p), src.turnTo, said.body.kind === "rows" ? rowsOn(p) : undefined));
    if (k === 0) return { left: renderPicture(null, folio(e.page - 1)), right: page(0) };
    return { left: page(2 * k - 1), right: page(2 * k) };
  }

  return {
    spread(at): Spread {
      const words = src.words();
      if (at === "map" || words === null) return { left: renderPicture(src.map("left"), ""), right: renderPicture(src.map("right"), "") };
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
      return e === undefined ? { left: blank(), right: blank() } : entrySpread(words, e, k);
    },
    next(at, by) {
      const { order, places } = index();
      return places[(order.get(at) ?? 0) + by] ?? null;
    },
    order(a, b) {
      const { order } = index();
      return (order.get(a) ?? 0) - (order.get(b) ?? 0);
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
