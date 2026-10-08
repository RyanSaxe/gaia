// What a thing says to a person who walks up to it: the minimap's scrap grows
// into a page of the traveller's sketchbook, drawn over the faint land it
// stands on. The sketch is the news: an ink drawing of the thing washed in
// its health (a failing tree's crown thins and browns, a failing house's roof
// rots through and ivy climbs it), with a few words in the traveller's hand
// pointing at what the drawing shows is wrong, and only what is specific and
// true of this thing: a thing with nothing wrong says nothing but its name
// and how it fares. Under the drawing, where it lives in small capitals and
// its name lettered as the map letters names, the first sentence of its doc
// comment, and the details behind "more".
//
// The words come from one function (`describe`, by default `symptomsOf`,
// which reads the thing's vitality signals); Jev's own judgment of what to
// say plugs in there.

import type { CardThing } from "../terrain/lab.ts";
import { standing } from "../terrain/card.ts";

/** The part of a sketch a note points at. */
export type SketchPart = "crown" | "trunk" | "roof" | "walls" | "ground";

/** A few true words about a thing, and the part of its sketch they point at. */
export interface Descriptor {
  readonly words: string;
  readonly part: SketchPart;
}

export interface SketchPage {
  /** Shows the page for what the person walked up to, or lets it go (null). */
  show(thing: CardThing | null): void;
  /** What shows now, for scripted checks: the thing's name and the notes on its sketch. */
  state(): { readonly shown: string | null; readonly notes: readonly string[] };
}

/** A small hash of a name, for a sketch's own wobble. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A seeded stream of numbers from 0 to 1. */
function streamOf(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

type SketchKind = "tree" | "house" | "mill" | "tower" | "stone" | "flowers" | "bush" | "landmark";

/** Which sketch a thing gets, from what it stands as in the world. */
function kindOf(standsAs: string): SketchKind {
  const s = standsAs.toLowerCase();
  if (/mill/.test(s)) return "mill";
  if (/tower|lighthouse/.test(s)) return "tower";
  if (/cottage|house|croft|cabin|hall|barn|workshop/.test(s)) return "house";
  if (/tree|oak|willow|birch|pine|maple|cherry|elm|beech/.test(s)) return "tree";
  if (/stone|boulder|rock|cairn/.test(s)) return "stone";
  if (/flower|daisies|daisy|bluebell|poppies|poppy|lavender|foxglove/.test(s)) return "flowers";
  if (/circle|arch|monolith|shrine|ring/.test(s)) return "landmark";
  return "bush";
}

const mix = (a: readonly number[], b: readonly number[], t: number): string => `rgb(${a.map((x, i) => Math.round(x + ((b[i] as number) - x) * t)).join(",")})`;
const DRY = [176, 156, 118];
const LIFE = [118, 158, 82];
const BLOOM = [214, 150, 170];

/** Where each part of a sketch lies in its 160 by 120 drawing, for a note's leader to reach. */
const PARTS: Record<SketchKind, Partial<Record<SketchPart, readonly [number, number]>>> = {
  tree: { crown: [66, 40], trunk: [80, 92], ground: [100, 111] },
  house: { roof: [70, 56], walls: [100, 96], ground: [120, 111] },
  mill: { roof: [70, 56], walls: [96, 96], ground: [120, 111] },
  tower: { roof: [80, 34], walls: [86, 80], ground: [104, 111] },
  stone: { crown: [80, 70], walls: [96, 92], ground: [108, 111] },
  flowers: { crown: [72, 80], trunk: [84, 100], ground: [100, 111] },
  bush: { crown: [80, 84], walls: [100, 98], ground: [108, 111] },
  landmark: { crown: [75, 72], walls: [100, 90], ground: [108, 111] },
};

/**
 * An ink sketch of a thing, its wash in its health's color. Vitality is the
 * sketch's own state: a crown's blobs thin and brown, a roof rots through,
 * moss leaves a stone.
 */
export function sketchOf(standsAs: string, name: string, vitality: number): string {
  const rand = streamOf(hashOf(name));
  const v = Math.max(0, Math.min(1, vitality));
  const wash = mix(DRY, LIFE, v);
  const wob = (x: number): number => +(x + (rand() - 0.5) * 2.2).toFixed(1);
  const ink = `fill="none" stroke="#4a3c2c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  const blobs = (cx: number, cy: number, rx: number, ry: number, n: number, color: string): string => {
    let out = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.6;
      const r = 0.55 + rand() * 0.4;
      // A failing crown keeps only some of its blobs.
      if (rand() > 0.25 + v * 0.8) continue;
      const x = cx + Math.cos(a) * rx * r;
      const y = cy + Math.sin(a) * ry * r;
      const s = 9 + rand() * 9;
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(1)}" fill="${color}" opacity="${(0.55 + rand() * 0.25).toFixed(2)}"/>`;
      out += `<path class="pen" pathLength="1" d="M${(x - s).toFixed(1)} ${y.toFixed(1)} a${s.toFixed(1)} ${s.toFixed(1)} 0 0 1 ${(s * 1.9).toFixed(1)} ${(-s * 0.3).toFixed(1)}" ${ink} stroke-width="1.1" opacity=".7"/>`;
    }
    return out;
  };
  const ground = `<path class="pen" pathLength="1" d="M8 ${wob(112)} C 40 ${wob(108)}, 80 ${wob(114)}, 112 ${wob(110)} S 150 ${wob(112)}, 152 ${wob(111)}" ${ink} stroke-width="1.2" opacity=".75"/>`;
  let body = "";
  switch (kindOf(standsAs)) {
    case "tree": {
      body += `<path class="pen" pathLength="1" d="M${wob(76)} 111 C 77 90, 74 74, ${wob(72)} 58 M${wob(84)} 111 C 82 92, 84 76, ${wob(88)} 60 M76 76 C 66 66, 58 62, ${wob(52)} 52 M84 80 C 94 70, 102 66, ${wob(108)} 56" ${ink}/>`;
      // The crown's body, then its masses round it; a failing crown keeps fewer and browns.
      body += `<ellipse cx="80" cy="48" rx="${(18 + v * 14).toFixed(1)}" ry="${(14 + v * 10).toFixed(1)}" fill="${wash}" opacity="${(0.35 + v * 0.35).toFixed(2)}"/>`;
      body += blobs(80, 48, 40, 30, 16, wash);
      break;
    }
    case "house":
    case "mill":
    case "tower": {
      const k = kindOf(standsAs);
      const w = k === "tower" ? 34 : 64;
      const x0 = 80 - w / 2;
      const top = k === "tower" ? 44 : 68;
      body += `<rect x="${x0}" y="${top}" width="${w}" height="${111 - top}" fill="#efe4c8" opacity=".85"/>`;
      body += `<path class="pen" pathLength="1" d="M${wob(x0)} 111 L${wob(x0)} ${top} L${wob(x0 + w)} ${top} L${wob(x0 + w)} 111" ${ink}/>`;
      // The roof: whole while it thrives, holed and sagging as it fails.
      const roof = mix(DRY, [168, 108, 72], v);
      const peak = k === "tower" ? 18 : 36;
      body += `<path d="M${x0 - 8} ${top + 2} L80 ${peak + (1 - v) * 10} L${x0 + w + 8} ${top + 2} Z" fill="${roof}" opacity="${(0.45 + v * 0.4).toFixed(2)}"/>`;
      body += `<path class="pen" pathLength="1" d="M${wob(x0 - 8)} ${top + 2} L80 ${(peak + (1 - v) * 10).toFixed(1)} L${wob(x0 + w + 8)} ${top + 2}" ${ink}/>`;
      if (v < 0.5) body += `<path class="pen" pathLength="1" d="M${x0 + w * 0.55} ${top - 6} l6 8 l-3 5 l7 6" ${ink} stroke-width="1.2"/>`;
      body += `<path class="pen" pathLength="1" d="M${76} 111 L76 ${96} Q80 ${91} 84 96 L84 111" ${ink}/>`;
      body += `<rect x="${x0 + 8}" y="${top + 12}" width="9" height="9" ${ink} stroke-width="1.2"/>`;
      if (k === "mill") body += `<circle cx="${x0 + w + 12}" cy="96" r="15" ${ink}/><path d="M${x0 + w + 12} 81 V111 M${x0 + w - 3} 96 H${x0 + w + 27}" ${ink} stroke-width="1.1"/>`;
      if (v > 0.4 && k !== "tower") body += `<path class="pen" pathLength="1" d="M${x0 + w - 12} ${top - 14} q4 -8 0 -14 q-4 -6 2 -12" ${ink} stroke-width="1" opacity="${((v - 0.4) * 1.4).toFixed(2)}"/>`;
      // Ivy takes a failing wall.
      if (v < 0.6) body += blobs(x0 + 6, 100, 8, 10, 8, mix([92, 120, 70], [92, 120, 70], 1)).replaceAll(/r="[\d.]+"/g, 'r="5"');
      break;
    }
    case "stone": {
      body += `<path d="M${wob(52)} 111 C 50 90, 58 70, ${wob(80)} 64 C 100 66, 110 88, ${wob(108)} 111 Z" fill="#c9c2b2" opacity=".8"/>`;
      body += `<path class="pen" pathLength="1" d="M${wob(52)} 111 C 50 90, 58 70, ${wob(80)} 64 C 100 66, 110 88, ${wob(108)} 111" ${ink}/>`;
      body += `<path d="M66 80 c6 -6 14 -8 22 -6" fill="none" stroke="${wash}" stroke-width="${(2 + v * 7).toFixed(1)}" stroke-linecap="round" opacity="${(0.25 + v * 0.55).toFixed(2)}"/>`;
      if (v < 0.5) body += `<path class="pen" pathLength="1" d="M84 70 l-4 12 l5 8" ${ink} stroke-width="1.1"/>`;
      break;
    }
    case "flowers": {
      for (let i = 0; i < 7; i++) {
        const x = 50 + i * 10 + rand() * 6;
        const h = 22 + rand() * 18;
        const droop = (1 - v) * 10;
        body += `<path class="pen" pathLength="1" d="M${x.toFixed(1)} 111 q${(droop * 0.4).toFixed(1)} ${(-h * 0.6).toFixed(1)} ${droop.toFixed(1)} ${(-h + droop).toFixed(1)}" ${ink} stroke-width="1.2"/>`;
        if (rand() < 0.3 + v * 0.7) body += `<circle cx="${(x + droop).toFixed(1)}" cy="${(111 - h + droop).toFixed(1)}" r="5" fill="${mix(DRY, BLOOM, v)}" opacity=".8"/>`;
      }
      break;
    }
    case "landmark": {
      for (const x of [50, 70, 92, 110]) body += `<path d="M${wob(x)} 111 L${wob(x)} ${wob(70)} L${wob(x + 10)} ${wob(68)} L${wob(x + 10)} 111" fill="#c9c2b2" opacity=".75"/><path class="pen" pathLength="1" d="M${x} 111 L${x} 70 L${x + 10} 68 L${x + 10} 111" ${ink}/>`;
      break;
    }
    default: {
      body += blobs(80, 92, 30, 16, 14, wash);
      body += `<path class="pen" pathLength="1" d="M${wob(50)} 108 C 52 84, 70 74, ${wob(82)} 76 C 98 76, 112 88, ${wob(110)} 108" ${ink} opacity=".8"/>`;
    }
  }
  return `${body}${ground}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const numbers = (s: string | undefined): number[] => (s ?? "").match(/\d+/g)?.map(Number) ?? [];

/**
 * What a thing's sketch says, from its vitality signals: each one that is
 * specific to it, in the world's voice, pointing at the part of the drawing
 * that shows it, the strongest first and at most two. A signal nearly every
 * file shares (no test of its own, a warning or two) says nothing unless it
 * is the thing's real trouble, so a thing with nothing particular wrong says
 * nothing at all.
 */
export function symptomsOf(thing: CardThing): readonly Descriptor[] {
  const kind = kindOf(thing.standsAs);
  const built = kind === "house" || kind === "mill" || kind === "tower";
  const top: SketchPart = built ? "roof" : "crown";
  const body: SketchPart = built ? "walls" : "trunk";
  const limb = kind === "tree" ? "bough" : built ? "wing" : "stem";
  const out: { words: string; part: SketchPart; cost: number }[] = [];
  for (const t of thing.represented.report.terms) {
    const cost = t.weight * t.penalty;
    if (cost <= 0) continue;
    const [a = 0, b = 0] = numbers(t.reading);
    switch (t.id) {
      case "tests":
        out.push({ words: `${a} of ${plural(b, "test")} that reach it failing`, part: top, cost });
        break;
      case "errors":
        out.push({ words: `${plural(a, "error")} where it is built`, part: body, cost });
        break;
      case "complexity":
        if (t.penalty >= 0.2) out.push({ words: `one ${limb} grown ${a} lines long, knotted ${b} deep`, part: body, cost });
        break;
      case "untested":
        // Nearly every file lacks a test of its own: it is news only where Jev thinks this one needs one.
        if (/Jev: (\d+)%/.test(t.reading ?? "") && Number(/Jev: (\d+)%/.exec(t.reading ?? "")?.[1]) >= 70) out.push({ words: "no test reaches it, though it wants one", part: "ground", cost });
        else if (/% of files/.test(t.reading ?? "") && t.penalty >= 0.6) out.push({ words: `no test reaches ${a}% of it`, part: "ground", cost });
        break;
      case "lint":
        if (a >= 5) out.push({ words: plural(a, "warning"), part: top, cost });
        break;
      case "unused":
        out.push({ words: "nothing leans on it", part: "ground", cost });
        break;
      case "debt":
        if (a >= 2) out.push({ words: `${a} notes left to come back to`, part: body, cost });
        break;
      default:
        if (t.penalty >= 0.3) out.push({ words: t.label.toLowerCase(), part: top, cost });
    }
  }
  return out.sort((x, y) => y.cost - x.cost).slice(0, 2).map(({ words, part }) => ({ words, part }));
}

/** The first sentence of a doc comment, short enough for a page in a hand, with no code marks. */
function firstSentence(doc: string): string {
  const one = doc.replace(/`/g, "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return one.length > 150 ? `${one.slice(0, 147).replace(/\s+\S*$/, "")}…` : one;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * The sketch page, inside `host` (the minimap's scrap, which grows to hold
 * it). `describe` says what the sketch's notes say; by default its symptoms.
 */
export function createSketchPage(host: HTMLElement, describe: (thing: CardThing) => readonly Descriptor[] = symptomsOf): SketchPage {
  const page = el("div", "sketch-page");
  page.setAttribute("role", "dialog");
  host.append(page);
  let shown: CardThing | null = null;
  let notes: readonly Descriptor[] = [];

  function fill(thing: CardThing): void {
    const r = thing.represented;
    const v = r.report.vitality;
    const kind = kindOf(thing.standsAs);
    notes = describe(thing);
    // The drawing, and each note's leader from the margin to the part it names, in the traveller's pencil.
    const sides: readonly (readonly [number, number])[] = [[-6, 24], [166, 78]];
    let leaders = "";
    const callouts = notes.map((n, k) => {
      const [nx, ny] = sides[k] as readonly [number, number];
      const [px, py] = PARTS[kind][n.part] ?? PARTS[kind].ground ?? [80, 111];
      leaders += `<path class="leader" pathLength="1" d="M${nx} ${ny} Q${((nx + px) / 2).toFixed(1)} ${(Math.min(ny, py) - 8).toFixed(1)} ${px} ${py}"/>`;
      const note = el("div", `sketch-note ${k === 0 ? "left" : "right"}`, n.words);
      return note;
    });
    const drawing = el("div", "sketch-drawing");
    drawing.innerHTML = `<svg viewBox="0 0 160 120" aria-hidden="true">${sketchOf(thing.standsAs, r.name, v)}${leaders}</svg>`;
    drawing.append(...callouts);
    const where = r.where.replace(/:\d+$/, "").split("/").slice(0, -1).join(" / ");
    const more = el("button", "sketch-more", "more");
    more.type = "button";
    const details = el("dl", "sketch-details");
    const fact = (term: string, value: string): void => {
      details.append(el("dt", "", term), el("dd", "", value));
    };
    fact("Lives in", r.where);
    fact("Size", r.size);
    if (r.dependsOn.length > 0) fact("Leans on", r.dependsOn.join(", "));
    if (r.dependents.length > 0) fact("Leaned on by", r.dependents.join(", "));
    fact("Stands as", thing.standsAs.toLowerCase());
    if (thing.judge !== undefined) fact("Judged by", thing.judge === "jev" ? "Jev" : "the stand-in");
    more.addEventListener("click", () => page.classList.toggle("unfolded"));
    const doc = firstSentence(r.doc);
    page.replaceChildren(
      drawing,
      ...(where === "" ? [] : [el("div", "sketch-where", where)]),
      el("div", "sketch-name", r.name),
      el("div", "sketch-fares", standing(v).toLowerCase()),
      ...(doc === "" ? [] : [el("p", "sketch-doc", doc)]),
      more,
      details,
    );
    page.classList.remove("unfolded");
    page.setAttribute("aria-label", `About ${r.name}`);
  }

  return {
    show(thing) {
      shown = thing;
      page.classList.remove("on");
      host.classList.toggle("page", thing !== null);
      if (thing === null) return;
      fill(thing);
      // The scrap grows to just hold the page.
      host.style.setProperty("--page-h", `${Math.ceil(page.scrollHeight + 4)}px`);
      // A frame later, so the pen draws the sketch from nothing as the page grows.
      requestAnimationFrame(() => requestAnimationFrame(() => page.classList.toggle("on", shown === thing)));
    },
    state: () => ({ shown: shown?.represented.name ?? null, notes: notes.map((n) => n.words) }),
  };
}
