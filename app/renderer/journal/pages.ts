// Lays out the journal's spreads for the book: the map across the endpapers,
// the title page and contents, each entry in `journalOf` order, then the
// appendix of full texts. A folder or a file with definitions faces its map,
// and any other thing faces its painting. Each spread is built from its words
// (`words.ts`) when it comes into view, never before its picture is ready.

import { type Travel, type Trip, wayLeft } from "@gaia/terrain";
import { type Journal, type JournalEntry, type PageRoom, entityOf } from "@gaia/world";
import type { BookPages, Spread } from "./book.ts";
import { type CaptionFact, conceptsCaption } from "./caption.ts";
import { tapsOf } from "./maps.ts";
import { type InFull, fullItems, pagePx, placeCross, placeTraveller, renderCross, renderFullPage, renderNameLine, renderPage, renderPassingPage, renderPicture, renderTitle, renderTraveller, renderWay } from "./page.ts";
import { type Full, type PageWords, type WordsSource, appendixWords, contentsWords, fileOfEntry, leadFiles, wordsOf } from "./words.ts";

/** How many entries after and before the open page are painted ahead. */
const AHEAD = 5;
const BEHIND = 5;
/** How close in page pixels a tap must be to a map's cross to travel there. */
const CROSS_REACH = 16;
/** List rows per page under the full heading (`first`) and under a running head (`next`), and the rows a first page gives to its lead (`lead`). */
export const ROOM: PageRoom = { first: 18, next: 21, lead: 6 };

export interface JournalPagesSource {
  /** The words source for the current world, or null before one loads. */
  words(): WordsSource | null;
  /** One half of the whole land's map across the endpapers, or null before the map is painted. */
  endpaper(side: "left" | "right"): HTMLElement | null;
  /** A folder's or a file's own map, for its left-hand page, or null before the map is painted. */
  map(area: string): HTMLElement | null;
  /** The painting of a page's thing for its left-hand page. It fills in as the painting progresses. */
  picture(of: string): HTMLElement;
  /** The title page's painting: the repository's building or landmark, close enough to read, under a wide sky. */
  frontispiece(): HTMLElement;
  /** Resolves once a page's thing is painted, or the title page's painting for "", so a page never shows before its painting. */
  painted(of: string): Promise<void>;
  /** Paints the things these pages are about next, in this order. */
  ahead(ofs: readonly string[]): void;
  /** Turns the book to a place, for a row tapped on a page. */
  turnTo(at: string): void;
  /** Resolves once the field map's paper is painted, so a map page never shows before its map. */
  mapped(): Promise<void>;
  /** The person's position and heading in radians (0 faces -z), for the map pages' traveller. */
  person(): { readonly x: number; readonly z: number; readonly yaw: number };
  /** The running trip and its start time in `performance.now()` ms, or null. Map pages draw its route ahead. */
  trip(): { readonly plan: Trip; readonly at: Travel; readonly began: number } | null;
  /** Moves the person to the world spot tapped on a map. */
  travelTo(x: number, z: number): void;
  /** Moves the person to the spot a thing's painting was seen from, when the page's picture is tapped. */
  travel(of: string): void;
  /** Resolves once a file's text has arrived, for a definition's or a file's page. */
  text(path: string): Promise<void>;
}

/** The journal's pages, plus the traveller and route that move on their maps. */
export interface JournalPages extends BookPages {
  /**
   * Moves each map page's traveller to the person and draws a running trip's route from the traveller to its end.
   * Called every frame while the book is open.
   */
  follow(): void;
}

/** Whether an entry is a container, whose first spread faces its map: a folder, or a file with definitions. */
const mapped = (e: JournalEntry): boolean => e.kind === "chapter" || (e.kind === "file" && e.lists.length > 0);

/**
 * Returns the caption for an entry's left-hand page: what the understanding
 * pass judged about its thing, each concept as a percentage. A folder whose
 * entity has its own page gets none here, since the entity's painting carries
 * it. A file with definitions gets none either.
 */
function captionFor(words: WordsSource, e: JournalEntry): CaptionFact[] {
  const thing = e.kind === "file" && e.lists.length > 0 ? undefined : words.thing?.(e.of);
  if (thing !== undefined && (e.kind !== "chapter" || words.journal.entry(entityOf(e.of)) === undefined)) return conceptsCaption(thing);
  return [];
}

/** The pages a list of `rows` needs, and the spreads those pages take. The first page faces its picture, and the rest are two to a spread. */
const pagesOf = (rows: number): number => (rows <= ROOM.first ? 1 : 1 + Math.ceil((rows - ROOM.first) / ROOM.next));
const spreadsOf = (pages: number): number => 1 + Math.ceil((pages - 1) / 2);
/** A spread after an entry's first is addressed as the entry's `of`, then `SEP`, then the spread's index. */
const SEP = "§";
const nth = (of: string, k: number): string => (k === 0 ? of : `${of}${SEP}${k}`);
/**
 * The appendix at the back: every definition's and file's full text in book
 * order, each starting on its own spread. A place there is the entry and its
 * spread index, or "end" for its last spread, whose index is known only once
 * its text has arrived and been laid out.
 */
const APPENDIX = "appendix:";
const inFull = (id: string, k: number | "end"): string => `${APPENDIX}${id}${SEP}${k}`;
const fullAt = (at: string): { id: string; k: number | "end" } | null => {
  if (!at.startsWith(APPENDIX)) return null;
  const [id, k] = at.slice(APPENDIX.length).split(SEP);
  return { id: id as string, k: k === "end" ? "end" : Number(k ?? 0) };
};
/** Appendix pages are numbered by the definition's journal page plus a letter: 2,055a, 2,055b, and so on. */
const lettered = (n: number): string => (n < 26 ? String.fromCharCode(97 + n) : lettered(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
/** The row range on page `page` of a list (0 for the first), after the `lead` rows the first page gives to its lead. */
const rowsOn = (page: number, lead = 0): { from: number; to: number } => {
  const first = ROOM.first - lead;
  return page === 0 ? { from: 0, to: first } : { from: first + (page - 1) * ROOM.next, to: first + page * ROOM.next };
};
/** The files whose text an entry's page needs: its own file and the files of its lead's snippets. */
const textsOf = (words: WordsSource | null, e: JournalEntry): string[] => [...new Set([...(fileOfEntry(e) === undefined ? [] : [fileOfEntry(e) as string]), ...(words === null ? [] : leadFiles(words, e))])];

/** Files a riffle's leaves never show: documents and data that are not code. */
const NOT_CODE = /\.(md|mdx|markdown|txt|rst|json|lock|svg)$/i;
/** How many files along a riffle's route its leaves draw from, and how many lines of a file each leaf shows. */
const PASSING = { files: 12, lines: 44 } as const;

/** How many readable tabs fit on the fore-edge. */
export const TABS = 7;

/**
 * Tabs for these top folders in contents order: one per folder while they
 * fit, and otherwise a dictionary-style thumb index. Each tab then covers an
 * even run of folders, labeled by the first letters of its first and last
 * folders, with a second letter where a neighbor shares the first.
 */
export function thumbIndex(names: readonly string[], room = TABS): { readonly from: number; readonly to: number; readonly label: string }[] {
  if (names.length <= room) return names.map((name, k) => ({ from: k, to: k + 1, label: name }));
  const runs = Array.from({ length: room }, (_, k) => ({ from: Math.round((k * names.length) / room), to: Math.round(((k + 1) * names.length) / room) }));
  const key = (name: string): string => name.replace(/^[^a-z0-9]+/i, "").toLowerCase();
  const letters = (name: string, n: number): string => key(name).slice(0, n);
  const first = runs.map((r) => names[r.from] as string);
  const last = runs.map((r) => names[r.to - 1] as string);
  return runs.map((r, k) => {
    const prev = last[k - 1];
    const next = first[k + 1];
    const before = prev !== undefined && letters(prev, 1) === letters(first[k] as string, 1) ? 2 : 1;
    const after = next !== undefined && letters(next, 1) === letters(last[k] as string, 1) ? 2 : 1;
    // A run of one folder gets one label, with as many letters as either neighbor needs.
    if (r.to - r.from === 1) return { ...r, label: letters(first[k] as string, Math.max(before, after)) };
    const [a, b] = [letters(first[k] as string, before), letters(last[k] as string, after)];
    return { ...r, label: a === b ? a : `${a}–${b}` };
  });
}

/** A run of a definition's items in full, one page's worth. */
type Slice = { readonly from: number; readonly to: number };

/**
 * Splits a definition's full text into pages. It measures each item once in a
 * hidden page of the book's size, then fills pages until the next item would
 * not fit, so every page ends on a whole row and nothing is cut.
 */
function layOut(words: PageWords, body: Full, host: HTMLElement): Slice[] {
  const total = fullItems(body).length;
  const measure = (first: boolean, slice: Slice): { room: number; rows: { top: number; bottom: number }[] } => {
    const page = renderFullPage(words, body, "", slice, first, () => {}, () => {});
    host.replaceChildren(page);
    const holder = page.querySelector(".jp-body") as HTMLElement;
    const top = holder.getBoundingClientRect().top;
    const rows = [...holder.querySelectorAll<HTMLElement>(".jp-line, .jp-fold")].map((r) => {
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

export function journalPages(src: JournalPagesSource): JournalPages {
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
  /** Each entry's index in appendix order, and its full text's page slices once laid out. */
  let definitions: { words: WordsSource | null; ids: readonly string[]; at: Map<string, number>; laid: Map<string, Slice[]> } | null = null;
  const inOrder = (): NonNullable<typeof definitions> => {
    const words = src.words();
    if (definitions === null || definitions.words !== words) {
      const ids = words?.journal.entries.filter((e) => fileOfEntry(e) !== undefined).map((e) => e.of) ?? [];
      definitions = { words, ids, at: new Map(ids.map((id, k) => [id, k])), laid: new Map() };
    }
    return definitions;
  };
  let host: HTMLElement | null = null;
  /** An entry's appendix pages, laid out once its text has arrived, or null before. */
  function pagesInFull(id: string): Slice[] | null {
    const words = src.words();
    const e = words?.journal.entry(id);
    if (words === null || e === undefined) return null;
    const order = inOrder();
    const known = order.laid.get(id);
    if (known !== undefined) return known;
    const said = appendixWords(words, e);
    const file = fileOfEntry(e);
    if (said.body.kind !== "full" || file === undefined || words.lines(file) === undefined) return null;
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
  /** The spread index within a definition's appendix, with "end" resolved to the last. */
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
      return slice === undefined ? blank() : renderFullPage(said, body, `${e.page.toLocaleString("en-US")}${lettered(p)}`, slice, p === 0, () => src.turnTo(id), src.turnTo);
    };
    return { left: page(2 * kk), right: page(2 * kk + 1) };
  }

  const folio = (n: number): string => (n > 0 ? n.toLocaleString("en-US") : "");
  /** Where an entry appears in full: a turn to its first appendix spread, whose first page is its journal page number plus "a". */
  const fullOf = (of: string): InFull => ({ turn: () => src.turnTo(inFull(of, 0)), folio: `${(src.words()?.journal.entry(of)?.page ?? 0).toLocaleString("en-US")}${lettered(0)}` });
  const roman = (n: number): string => ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n] ?? String(n);
  const blank = (f = ""): HTMLElement => renderPicture(null, f);
  /** Each drawn map page and its `follow`. A page off the open spread for `AWAY` frames is dropped. */
  const live = new Set<{ readonly page: HTMLElement; readonly follow: () => void; away: number }>();
  const AWAY = 120;
  /**
   * Builds a map page. The traveller marker follows the person while they are
   * on this page, as on the field map. A tap on a folder's or file's name turns
   * to its page. A tap on the land marks the spot with a cross, a second tap on
   * the cross travels there, and a tap elsewhere moves the cross, so a near
   * miss of a name never moves the person. During a trip, its route is drawn
   * from the traveller to a cross at its end. With a mouse, the name under the
   * pointer is underlined, and the cursor is a pointer over a name or the
   * cross and a crosshair over the land.
   */
  const mapPage = (map: HTMLElement | null, f: string, caption: readonly CaptionFact[] = []): HTMLElement => {
    let cross: { readonly px: number; readonly py: number; readonly el: HTMLElement } | null = null;
    const onCross = (px: number, py: number): boolean => cross !== null && Math.hypot(px - cross.px, py - cross.py) < CROSS_REACH;
    const page = renderPicture(
      map,
      f,
      (px, py) => {
        const taps = tapsOf(map);
        if (taps === null) return;
        const name = taps.name(px, py);
        if (name !== null) return src.turnTo(name);
        if (cross !== null && onCross(px, py)) {
          const at = taps.at(cross.px, cross.py);
          // The trip's own end cross replaces this one.
          cross.el.remove();
          cross = null;
          return src.travelTo(at.x, at.z);
        }
        cross?.el.remove();
        cross = { px, py, el: renderCross(px, py) };
        page.append(cross.el);
      },
      caption,
    );
    if (map !== null) {
      map.classList.add("jp-map");
      let line: HTMLElement | null = null;
      map.onpointermove = (e) => {
        if (e.pointerType !== "mouse") return;
        const { px, py } = pagePx(map, e);
        const box = tapsOf(map)?.nameBox(px, py) ?? null;
        line?.remove();
        line = box === null ? null : renderNameLine(box);
        if (line !== null) page.append(line);
        map.style.cursor = box !== null || onCross(px, py) ? "pointer" : "crosshair";
      };
      map.onpointerleave = () => {
        line?.remove();
        line = null;
      };
    }
    const taps = tapsOf(map);
    if (taps !== null) {
      const me = src.person();
      const at = taps.page(me.x, me.z);
      const traveller = renderTraveller(at.px, at.py, me.yaw);
      const { way, cross: end } = renderWay();
      const line = way.firstElementChild as SVGPathElement;
      end.hidden = true;
      page.append(way, end, traveller);
      /** The trip whose route is drawn here, and the line's last path data. */
      let drawn: { readonly plan: Trip; d: string } | null = null;
      const follow = (): void => {
        const me = src.person();
        const at = taps.page(me.x, me.z);
        placeTraveller(traveller, at.px, at.py, me.yaw);
        const trip = src.trip();
        if (trip === null) {
          // The trip has ended, so the line and its cross fade out.
          if (drawn !== null) for (const e of [way, end]) e.classList.add("over");
          drawn = null;
          return;
        }
        if (trip.plan !== drawn?.plan) {
          drawn = { plan: trip.plan, d: "" };
          const n = trip.plan.points.length / 2;
          const last = taps.page(trip.plan.points[(n - 1) * 2] as number, trip.plan.points[(n - 1) * 2 + 1] as number);
          placeCross(end, last.px, last.py);
          end.hidden = false;
          for (const e of [way, end]) e.classList.remove("on", "over");
        }
        // Draws the line in from the traveller as the trip starts. On a page drawn later, a negative delay starts the animation as far along as it would be by then.
        if (!way.classList.contains("on") && page.isConnected) {
          void way.getBoundingClientRect();
          way.style.setProperty("--pencil-delay", `${(trip.began - performance.now()).toFixed(0)}ms`);
          way.classList.add("on");
        }
        // Keeps a point about every 1.5 page pixels.
        let d = "";
        let prior = { px: Number.NaN, py: Number.NaN };
        const left = wayLeft(trip.plan, trip.at.s);
        left.forEach((p, i) => {
          const q = taps.page(p.x, p.z);
          if (i > 0 && i < left.length - 1 && Math.hypot(q.px - prior.px, q.py - prior.py) < 1.5) return;
          d += `${i === 0 ? "M" : "L"}${q.px.toFixed(1)} ${q.py.toFixed(1)}`;
          prior = q;
        });
        if (d !== drawn.d) {
          drawn.d = d;
          line.setAttribute("d", d);
        }
      };
      follow();
      live.add({ page, follow, away: 0 });
    }
    return page;
  };

  function entrySpread(words: WordsSource, e: JournalEntry, k: number): Spread {
    const said = wordsOf(words, e);
    // Page p of the entry's words (0 for the first), with its folio and its slice of the list.
    const page = (p: number): HTMLElement => (p >= e.pages ? blank() : renderPage(said, folio(e.page + p), src.turnTo, said.body.kind === "rows" ? rowsOn(p, e.lead) : undefined, fileOfEntry(e) === undefined ? undefined : fullOf(e.of), fullOf));
    // A container faces its map and a thing faces its painting, each with its caption.
    const caption = captionFor(words, e);
    if (k === 0) return { left: mapped(e) ? mapPage(src.map(e.of), folio(e.page - 1), caption) : renderPicture(src.picture(e.of), folio(e.page - 1), () => src.travel(e.of), caption), right: page(0) };
    return { left: page(2 * k - 1), right: page(2 * k) };
  }

  function nextPlace(at: string, by: 1 | -1): string | null {
    const { order, places } = index();
    const full = fullAt(at);
    if (full === null) {
      const k = (order.get(at) ?? 0) + by;
      // The appendix follows the journal's last page.
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
  }
  /** Every file whose text has arrived, in arrival order, for a riffle's leaves to show. */
  const arrived: string[] = [];
  const fetchText = (file: string): void => {
    void src.text(file).then(() => {
      if (!arrived.includes(file) && (src.words()?.lines(file)?.length ?? 0) > 0) arrived.push(file);
    });
  };
  /** A deterministic draw in 0..1 for a name. */
  const draw = (name: string): number => ([...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0) / 4294967296;

  return {
    follow() {
      for (const map of live) {
        if (!map.page.isConnected) {
          if (++map.away > AWAY) live.delete(map);
          continue;
        }
        map.away = 0;
        map.follow();
      }
    },
    passing(from, toward) {
      const words = src.words();
      if (words === null) return () => null;
      const entryOf = (at: string): JournalEntry | undefined => words.journal.entry(fullAt(at)?.id ?? (at.split(SEP)[0] as string));
      const [a, b] = [entryOf(from), entryOf(toward)];
      const all = words.journal.entries;
      const [i0, i1] = [a === undefined ? 0 : all.indexOf(a), b === undefined ? all.length - 1 : all.indexOf(b)];
      const lo = Math.min(i0, i1);
      const hi = Math.max(i0, i1);
      // Up to about `PASSING.files` code files spread evenly along the route, fetched now so they arrive while the leaves turn.
      const along: string[] = [];
      const step = Math.max(1, Math.floor((hi - lo) / PASSING.files));
      for (let i = lo; i <= hi; i += step) {
        const e = all[i];
        const file = e === undefined ? undefined : fileOfEntry(e);
        if (file !== undefined && !NOT_CODE.test(file) && !along.includes(file)) along.push(file);
      }
      for (const f of along) fetchText(f);
      const [p0, p1] = [a?.page ?? 0, b?.page ?? 0];
      return (k, of) => {
        const t = of <= 1 ? 0 : k / (of - 1);
        // The arrived file nearest this point along the route, else any arrived file.
        const want = Math.round(t * (along.length - 1));
        const ready = (f: string): boolean => arrived.includes(f);
        let file: string | undefined;
        for (let d = 0; d < along.length && file === undefined; d++) file = [along[want + d], along[want - d]].find((f) => f !== undefined && ready(f));
        file ??= arrived.length === 0 ? undefined : arrived[k % arrived.length];
        if (file === undefined) return null;
        const lines = words.lines(file) ?? [];
        // Opens at one of the file's definitions, chosen by a hash of the file and leaf index, else at the file's top.
        const defs = words.world.symbols.filter((s) => s.id.startsWith(`${file}#`) && s.lines > 3);
        const def = defs[Math.floor(draw(`${file}:${k}`) * defs.length)];
        const first = def?.line ?? 1;
        return renderPassingPage(file, first, lines.slice(first - 1, first - 1 + PASSING.lines).map((l) => (l.length > 400 ? `${l.slice(0, 400)} …` : l)), Math.round(p0 + t * (p1 - p0)).toLocaleString("en-US"));
      };
    },
    fraction(at) {
      // The journal takes the first nine tenths of the book and the appendix the rest.
      const full = fullAt(at);
      if (full !== null) {
        const { ids, at: where } = inOrder();
        return 0.9 + (0.1 * (where.get(full.id) ?? 0)) / Math.max(1, ids.length);
      }
      const { order, places } = index();
      return (0.9 * (order.get(at) ?? 0)) / Math.max(1, places.length - 1);
    },
    spread(at): Spread {
      const full = fullAt(at);
      if (full !== null) return fullSpread(full.id, full.k);
      const words = src.words();
      if (at === "map" || words === null) return { left: mapPage(src.endpaper("left"), ""), right: mapPage(src.endpaper("right"), "") };
      const [of, kk] = at.split(SEP);
      const k = Number(kk ?? 0);
      if (of === "contents") {
        // The contents face the title page and continue two pages to a spread, numbered in lowercase roman numerals.
        const contents = contentsWords(words);
        const page = (p: number): HTMLElement =>
          contents.body.kind === "rows" && rowsOn(p).from < contents.body.rows.length ? renderPage({ ...contents, name: "Contents", path: [] }, roman(p + 2), src.turnTo, rowsOn(p)) : blank();
        return k === 0 ? { left: renderTitle(words.world.name, roman(1), src.frontispiece()), right: page(0) } : { left: page(2 * k - 1), right: page(2 * k) };
      }
      const e = words.journal.entry(of as string);
      if (e === undefined) return { left: blank(), right: blank() };
      // Paints the neighboring entries next and fetches their code, so a turn or a drag is rarely delayed by either.
      const here = words.journal.entries.indexOf(e);
      const around = [...words.journal.entries.slice(here + 1, here + 1 + AHEAD), ...words.journal.entries.slice(Math.max(0, here - BEHIND), here)];
      src.ahead(around.filter((n) => !mapped(n)).map((n) => n.of));
      for (const n of [e, ...around]) for (const file of textsOf(words, n)) fetchText(file);
      return entrySpread(words, e, k);
    },
    next: nextPlace,
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
      const words = src.words();
      const e = words?.journal.entry(full?.id ?? (at.split(SEP)[0] as string));
      const files = e === undefined ? [] : full === null ? textsOf(words ?? null, e) : [fileOfEntry(e)].filter((f): f is string => f !== undefined);
      if (files.length === 0) return;
      await Promise.all(files.map((f) => src.text(f)));
      // Lays out the entry's appendix before the leaf that shows it starts moving.
      if (full !== null) pagesInFull(full.id);
    },
    painted(at) {
      if (fullAt(at) !== null) return Promise.resolve();
      const [of, k = "0"] = at.split(SEP);
      // The endpapers and a container's first spread are maps.
      const e = src.words()?.journal.entry(of as string);
      if (of === "map" || (k === "0" && e !== undefined && mapped(e))) return src.mapped();
      // The title page faces the contents, and a thing's first spread faces its painting.
      if (of === "contents") return k === "0" ? src.painted("") : Promise.resolve();
      return e !== undefined && k === "0" ? src.painted(e.of) : Promise.resolve();
    },
    tabs() {
      const words = index().words;
      const journal: Journal | undefined = words?.journal;
      const chapters = (journal?.contents ?? []).flatMap((of) => {
        const e = journal?.entry(of);
        return e?.kind === "chapter" ? [e] : [];
      });
      if (chapters.length <= TABS || words === null || words === undefined) return chapters.map((e) => ({ name: e.name, at: e.of, from: e.of }));
      // A thumb index tab opens the contents at the spread where its run starts.
      const listed = contentsWords(words).body;
      const rows = listed.kind === "rows" ? listed.rows.map((r) => r.of) : [];
      return thumbIndex(chapters.map((e) => e.name)).map((run) => {
        const from = (chapters[run.from] as JournalEntry).of;
        const page = Math.max(0, rows.indexOf(from));
        const p = page < ROOM.first ? 0 : 1 + Math.floor((page - ROOM.first) / ROOM.next);
        return { name: run.label, at: nth("contents", Math.ceil(p / 2)), from };
      });
    },
  };
}
