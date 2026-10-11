// What the journal opens onto, place by place: the map across the endpapers,
// then the contents, then a spread for every place and thing in the order the
// code's tree lists them (`journalOf`). Each spread is drawn from its words
// (`words.ts`) and its picture when it comes into view; until the pictures
// are painted, the left-hand page is bare paper.

import type { Journal } from "@gaia/world";
import type { BookPages, Spread } from "./book.ts";
import { renderPage, renderPicture } from "./page.ts";
import { type WordsSource, contentsWords, wordsOf } from "./words.ts";

export interface JournalPagesSource {
  /** The words' source for the world standing now, or null before one stands. */
  words(): WordsSource | null;
  /** One half of the map across the endpapers, or null before it is painted. */
  map(side: "left" | "right"): HTMLElement | null;
  /** Turns the book to a place, for a row tapped on a page. */
  turnTo(at: string): void;
}

/** The places a journal opens onto, in order: the map, the contents, then every entry. */
function placesOf(journal: Journal | null): readonly string[] {
  return ["map", "contents", ...(journal?.entries.map((e) => e.of) ?? [])];
}

export function journalPages(src: JournalPagesSource): BookPages {
  let indexed: { journal: Journal | null; order: Map<string, number>; places: readonly string[] } | null = null;
  const index = (): NonNullable<typeof indexed> => {
    const journal = src.words()?.journal ?? null;
    if (indexed === null || indexed.journal !== journal) {
      const places = placesOf(journal);
      indexed = { journal, places, order: new Map(places.map((p, k) => [p, k])) };
    }
    return indexed;
  };
  const folio = (n: number): string => (n > 0 ? n.toLocaleString("en-US") : "");
  return {
    spread(at): Spread {
      const words = src.words();
      if (at === "map" || words === null) return { left: renderPicture(src.map("left"), ""), right: renderPicture(src.map("right"), "") };
      if (at === "contents") return { left: renderPicture(null, "ii"), right: renderPage(contentsWords(words), "iii", src.turnTo) };
      const e = words.journal.entry(at);
      if (e === undefined) return { left: renderPicture(null, ""), right: renderPicture(null, "") };
      return { left: renderPicture(null, folio(e.page - 1)), right: renderPage(wordsOf(words, e), folio(e.page), src.turnTo) };
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
      const journal = index().journal;
      return (journal?.contents ?? []).flatMap((of) => {
        const e = journal?.entry(of);
        return e?.kind === "chapter" ? [{ name: e.name, at: of }] : [];
      });
    },
  };
}
