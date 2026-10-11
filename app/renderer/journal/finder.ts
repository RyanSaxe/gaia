// Press "/" and a slip of the journal's paper is laid over the world: type a
// few letters of any folder, building or landmark, file or definition, choose
// one, and the journal opens at its page. Letters are matched in order, as a
// fuzzy finder matches them: in the name before the path, at the start of a
// word, and run together rank higher. It is a reader's shortcut, so nothing on
// the screen announces it.

import type { Journal } from "@gaia/world";

/** Something the finder can turn the journal to. */
export interface Findable {
  /** The journal's place for it. */
  readonly at: string;
  readonly name: string;
  /** Where it lives: a folder's path, or a definition's file. */
  readonly where: string;
  readonly page: number;
}

/** A findable that matches, with how well and which letters of its name matched. */
export interface Found {
  readonly item: Findable;
  readonly score: number;
  readonly letters: readonly number[];
}

/** Whether a letter begins a word: the first, after a separator, or a capital after a small letter. */
const startsWord = (text: string, k: number): boolean => {
  if (k === 0) return true;
  const before = text[k - 1] as string;
  const here = text[k] as string;
  return /[/._\-\s#]/.test(before) || (before === before.toLowerCase() && here !== here.toLowerCase());
};

/**
 * How well `term` matches `text` with its letters in order, and where: each
 * letter scores, more at the start of a word and more again run on from the
 * last, less the farther it is from the last; the whole term as one run
 * scores most, and the whole text more again. Null if some letter is missing.
 */
function matchOf(text: string, term: string): { score: number; letters: number[] } | null {
  const lower = text.toLowerCase();
  // The whole term as one run, at the start of a word if it can be.
  const runs = [...lower.matchAll(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].map((m) => m.index ?? 0);
  const run = runs.find((k) => startsWord(text, k)) ?? runs[0];
  if (run !== undefined) {
    const letters = Array.from({ length: term.length }, (_, q) => run + q);
    return { score: term.length * 4 + (startsWord(text, run) ? 8 : 0) + (term.length === lower.length ? 16 : 0), letters };
  }
  // Otherwise each letter in order, two ways: running on from the last letter where it can, or at the start of a
  // word where it can. The better of the two is the match.
  const spelled = (runOn: boolean): { score: number; letters: number[] } | null => {
    const letters: number[] = [];
    let score = 0;
    for (const ch of term) {
      const last = letters[letters.length - 1];
      const from = last === undefined ? 0 : last + 1;
      let k = runOn && last !== undefined && lower[from] === ch ? from : -1;
      for (let q = from; k === -1 && q < lower.length; q++) if (lower[q] === ch && startsWord(text, q)) k = q;
      if (k === -1) k = lower.indexOf(ch, from);
      if (k === -1) return null;
      const gap = last === undefined ? 0 : k - last - 1;
      score += 1 + (startsWord(text, k) ? 3 : 0) + (last !== undefined && gap === 0 ? 2 : 0) - (gap > 0 ? 1 + gap * 0.2 : 0);
      letters.push(k);
    }
    return { score, letters };
  };
  const [a, b] = [spelled(true), spelled(false)];
  return a === null || b === null ? (a ?? b) : b.score > a.score ? b : a;
}

/**
 * The findables matching `query`, best first, at most `limit`. Each word of
 * the query must match the item's name or, scoring less, its path; a shorter
 * name breaks a tie, so `world` finds the folder before every file in it.
 */
export function find(items: readonly Findable[], query: string, limit = 8): Found[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t !== "");
  if (terms.length === 0) return [];
  const found: Found[] = [];
  for (const item of items) {
    let score = 0;
    const letters: number[] = [];
    let ok = true;
    for (const term of terms) {
      const named = matchOf(item.name, term);
      const placed = named === null ? matchOf(`${item.where}/${item.name}`, term) : null;
      if (named === null && placed === null) {
        ok = false;
        break;
      }
      if (named !== null) {
        score += named.score * 2;
        letters.push(...named.letters);
      } else score += (placed as { score: number }).score;
    }
    if (ok) found.push({ item, score: score - item.name.length * 0.05 - item.where.length * 0.01, letters });
  }
  return found.sort((a, b) => b.score - a.score || a.item.page - b.item.page).slice(0, limit);
}

export interface Finder {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The finder's slip in `layer`, searching `items` as they stand when it opens; `choose` turns the journal to a place. */
export function createFinder(layer: HTMLElement, items: () => readonly Findable[], choose: (at: string) => void): Finder {
  const veil = el("div", "finder");
  veil.hidden = true;
  const slip = el("div", "finder-slip");
  const ask = el("input", "finder-ask");
  ask.type = "text";
  ask.spellcheck = false;
  ask.autocomplete = "off";
  ask.setAttribute("aria-label", "Find in the journal");
  const list = el("div", "finder-found");
  slip.append(ask, list);
  veil.append(slip);
  layer.append(veil);

  let all: readonly Findable[] = [];
  let shown: Found[] = [];
  let on = 0;
  const pick = (k: number): void => {
    on = Math.max(0, Math.min(shown.length - 1, k));
    list.querySelectorAll(".finder-row").forEach((row, q) => row.classList.toggle("on", q === on));
  };
  const take = (k: number): void => {
    const f = shown[k];
    if (f === undefined) return;
    close();
    choose(f.item.at);
  };
  function draw(): void {
    shown = find(all, ask.value);
    list.replaceChildren(
      ...shown.map((f, k) => {
        const row = el("button", "finder-row");
        row.type = "button";
        // The name, its matched letters inked darker.
        const name = el("span", "finder-name");
        const marked = new Set(f.letters);
        [...f.item.name].forEach((ch, q) => name.append(marked.has(q) ? el("b", "", ch) : document.createTextNode(ch)));
        row.append(name, el("span", "finder-where", f.item.where), el("span", "finder-page", f.item.page.toLocaleString("en-US")));
        // Only a pointer that moves picks a row: rows drawn under a resting one leave the first picked.
        row.addEventListener("pointermove", () => {
          if (on !== k) pick(k);
        });
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          take(k);
        });
        return row;
      }),
    );
    pick(0);
  }
  ask.addEventListener("input", draw);
  ask.addEventListener("keydown", (e) => {
    if (e.code === "Escape") close();
    else if (e.code === "ArrowDown") pick(on + 1);
    else if (e.code === "ArrowUp") pick(on - 1);
    else if (e.code === "Enter") take(on);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // A click off the slip puts it away.
  veil.addEventListener("pointerdown", (e) => {
    if (e.target === veil) close();
  });

  function close(): void {
    if (veil.hidden) return;
    veil.hidden = true;
    ask.blur();
  }
  return {
    open() {
      all = items();
      veil.hidden = false;
      ask.value = "";
      draw();
      ask.focus();
    },
    close,
    get isOpen() {
      return !veil.hidden;
    },
  };
}

/** Everything in the journal the finder turns to: every folder, building or landmark, file and definition. */
export function findablesOf(journal: Pick<Journal, "entries">): Findable[] {
  const parent = (path: string): string => path.split("/").slice(0, -1).join("/");
  return journal.entries.flatMap((e): Findable[] => {
    // A file's own page is the file's, which is found by its name.
    if (e.kind === "own") return [];
    if (e.kind === "definition") return [{ at: e.of, name: e.of.slice(e.of.indexOf("#") + 1), where: e.of.slice(0, e.of.indexOf("#")), page: e.page }];
    if (e.kind === "entity") return [{ at: e.of, name: e.name, where: e.of.slice("entity:".length), page: e.page }];
    return [{ at: e.of, name: e.name, where: parent(e.of), page: e.page }];
  });
}
