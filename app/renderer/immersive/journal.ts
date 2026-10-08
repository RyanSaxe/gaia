// What a thing tells a person who walks up to it, in round 14's sandbox of
// options (`?card=`). Each speaks in the world's voice: what the thing is and
// how it fares, with the details only on asking.
//
// - "journal": a page of the traveller's journal, low at the left, written
//   in a hand, with an ink sketch of the thing washed in its health's color:
//   a failing tree's crown thins and browns, a failing house loses its roof.
// - "ask": a small slip of paper at the lower edge with the thing's name
//   and one word for how it fares; a tap on it opens the journal page.
// - "sign": no paper at all: the view turns to the thing and its own sign.
// - "page": today's field-guide card, for comparison (the terrain lab's).

import type { CardThing } from "../terrain/lab.ts";
import { standing } from "../terrain/card.ts";

export type CardStyle = "page" | "journal" | "ask" | "sign";
export const CARD_STYLES: readonly CardStyle[] = ["page", "journal", "ask", "sign"];

export interface Journal {
  /** Shows what the person walked up to, or lets it go (null). */
  show(thing: CardThing | null): void;
  style(next: CardStyle): void;
  /** What shows now, for scripted checks. */
  state(): { readonly style: CardStyle; readonly shown: string | null; readonly open: boolean };
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
  if (/circle|arch|monolith|shrine/.test(s)) return "landmark";
  return "bush";
}

const mix = (a: readonly number[], b: readonly number[], t: number): string => `rgb(${a.map((x, i) => Math.round(x + ((b[i] as number) - x) * t)).join(",")})`;
const DRY = [176, 156, 118];
const LIFE = [118, 158, 82];
const BLOOM = [214, 150, 170];

/**
 * An ink sketch of a thing, its wash in its health's color. Vitality is the
 * sketch's own state: a crown's blobs thin and brown, a roof loses its
 * thatch, moss leaves a stone.
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
      out += `<path d="M${(x - s).toFixed(1)} ${y.toFixed(1)} a${s.toFixed(1)} ${s.toFixed(1)} 0 0 1 ${(s * 1.9).toFixed(1)} ${(-s * 0.3).toFixed(1)}" ${ink} stroke-width="1.1" opacity=".7"/>`;
    }
    return out;
  };
  const ground = `<path d="M8 ${wob(112)} C 40 ${wob(108)}, 80 ${wob(114)}, 112 ${wob(110)} S 150 ${wob(112)}, 152 ${wob(111)}" ${ink} stroke-width="1.2" opacity=".75"/>`;
  let body = "";
  switch (kindOf(standsAs)) {
    case "tree": {
      body += `<path d="M${wob(76)} 111 C 77 90, 74 74, ${wob(72)} 58 M${wob(84)} 111 C 82 92, 84 76, ${wob(88)} 60 M76 76 C 66 66, 58 62, ${wob(52)} 52 M84 80 C 94 70, 102 66, ${wob(108)} 56" ${ink}/>`;
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
      body += `<path d="M${wob(x0)} 111 L${wob(x0)} ${top} L${wob(x0 + w)} ${top} L${wob(x0 + w)} 111" ${ink}/>`;
      // The roof: whole while it thrives, holed and sagging as it fails.
      const roof = mix(DRY, [168, 108, 72], v);
      const peak = k === "tower" ? 18 : 36;
      body += `<path d="M${x0 - 8} ${top + 2} L80 ${peak + (1 - v) * 10} L${x0 + w + 8} ${top + 2} Z" fill="${roof}" opacity="${(0.45 + v * 0.4).toFixed(2)}"/>`;
      body += `<path d="M${wob(x0 - 8)} ${top + 2} L80 ${(peak + (1 - v) * 10).toFixed(1)} L${wob(x0 + w + 8)} ${top + 2}" ${ink}/>`;
      if (v < 0.5) body += `<path d="M${x0 + w * 0.55} ${top - 6} l6 8 l-3 5 l7 6" ${ink} stroke-width="1.2"/>`;
      body += `<path d="M${76} 111 L76 ${96} Q80 ${91} 84 96 L84 111" ${ink}/>`;
      body += `<rect x="${x0 + 8}" y="${top + 12}" width="9" height="9" ${ink} stroke-width="1.2"/>`;
      if (k === "mill") body += `<circle cx="${x0 + w + 12}" cy="96" r="15" ${ink}/><path d="M${x0 + w + 12} 81 V111 M${x0 + w - 3} 96 H${x0 + w + 27}" ${ink} stroke-width="1.1"/>`;
      if (v > 0.4 && k !== "tower") body += `<path d="M${x0 + w - 12} ${top - 14} q4 -8 0 -14 q-4 -6 2 -12" ${ink} stroke-width="1" opacity="${((v - 0.4) * 1.4).toFixed(2)}"/>`;
      // Ivy takes a failing wall.
      if (v < 0.6) body += blobs(x0 + 6, 100, 8, 10, 8, mix([92, 120, 70], [92, 120, 70], 1)).replaceAll(/r="[\d.]+"/g, 'r="5"');
      break;
    }
    case "stone": {
      body += `<path d="M${wob(52)} 111 C 50 90, 58 70, ${wob(80)} 64 C 100 66, 110 88, ${wob(108)} 111 Z" fill="#c9c2b2" opacity=".8"/>`;
      body += `<path d="M${wob(52)} 111 C 50 90, 58 70, ${wob(80)} 64 C 100 66, 110 88, ${wob(108)} 111" ${ink}/>`;
      body += `<path d="M66 80 c6 -6 14 -8 22 -6" fill="none" stroke="${wash}" stroke-width="${(2 + v * 7).toFixed(1)}" stroke-linecap="round" opacity="${(0.25 + v * 0.55).toFixed(2)}"/>`;
      if (v < 0.5) body += `<path d="M84 70 l-4 12 l5 8" ${ink} stroke-width="1.1"/>`;
      break;
    }
    case "flowers": {
      for (let i = 0; i < 7; i++) {
        const x = 50 + i * 10 + rand() * 6;
        const h = 22 + rand() * 18;
        const droop = (1 - v) * 10;
        body += `<path d="M${x.toFixed(1)} 111 q${(droop * 0.4).toFixed(1)} ${(-h * 0.6).toFixed(1)} ${droop.toFixed(1)} ${(-h + droop).toFixed(1)}" ${ink} stroke-width="1.2"/>`;
        if (rand() < 0.3 + v * 0.7) body += `<circle cx="${(x + droop).toFixed(1)}" cy="${(111 - h + droop).toFixed(1)}" r="5" fill="${mix(DRY, BLOOM, v)}" opacity=".8"/>`;
      }
      break;
    }
    case "landmark": {
      for (const x of [50, 70, 92, 110]) body += `<path d="M${wob(x)} 111 L${wob(x)} ${wob(70)} L${wob(x + 10)} ${wob(68)} L${wob(x + 10)} 111" fill="#c9c2b2" opacity=".75"/><path d="M${x} 111 L${x} 70 L${x + 10} 68 L${x + 10} 111" ${ink}/>`;
      break;
    }
    default: {
      body += blobs(80, 92, 30, 16, 14, wash);
      body += `<path d="M${wob(50)} 108 C 52 84, 70 74, ${wob(82)} 76 C 98 76, 112 88, ${wob(110)} 108" ${ink} opacity=".8"/>`;
    }
  }
  return `<svg viewBox="0 0 160 120" aria-hidden="true">${body}${ground}</svg>`;
}

/** How a thing fares, in a few words of the world's voice, with the reason when something is wrong. */
export function faring(thing: CardThing): string {
  const v = thing.represented.report.vitality;
  const word = standing(v);
  const worst = thing.represented.report.terms.filter((t) => t.penalty > 0).sort((a, b) => b.weight * b.penalty - a.weight * a.penalty)[0];
  const lead = word === "Thriving" ? "It is thriving" : word === "Healthy" ? "It is doing well" : word === "Tired" ? "It looks tired" : word === "Failing" ? "It is failing" : "It has fallen to ruin";
  return worst === undefined || v >= 0.85 ? `${lead}.` : `${lead}: ${(worst.reading ?? worst.label).replace(/\.$/, "")}.`;
}

/** The first sentence of a doc comment, short enough for a page in a hand, with no code marks. */
function firstSentence(doc: string): string {
  const one = doc.replace(/`/g, "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return one.length > 150 ? `${one.slice(0, 147).replace(/\s+\S*$/, "")}…` : one;
}

/** What a thing is, as a person would say it: "A watermill for a TypeScript package". */
export function whatItIs(standsAs: string, what: string): string {
  const parts = what.split(" · ");
  const kind = (parts[0] ?? "").toLowerCase();
  const language = parts.length > 1 ? (parts[parts.length - 1] as string) : "";
  const thing = `${language} ${kind}`.trim();
  return thing === "" ? standsAs : `${standsAs} for ${/^[aeiou]/i.test(thing) ? "an" : "a"} ${thing}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createJournal(root: HTMLElement): Journal {
  const page = el("div", "journal");
  page.setAttribute("role", "dialog");
  const tab = el("button", "journal-tab");
  tab.type = "button";
  root.append(page, tab);
  let current: CardStyle = "page";
  let shown: CardThing | null = null;
  let open = false;

  function fill(thing: CardThing): void {
    const r = thing.represented;
    const v = r.report.vitality;
    const sketch = el("div", "journal-sketch");
    sketch.innerHTML = sketchOf(thing.standsAs, r.name, v);
    const more = el("button", "journal-more", "more");
    more.type = "button";
    const details = el("dl", "journal-details");
    const fact = (term: string, value: string): void => {
      details.append(el("dt", "", term), el("dd", "", value));
    };
    fact("Lives in", r.where);
    fact("Size", r.size);
    if (r.dependsOn.length > 0) fact("Leans on", r.dependsOn.join(", "));
    if (r.dependents.length > 0) fact("Leaned on by", r.dependents.join(", "));
    if (thing.judge !== undefined) fact("Judged by", thing.judge === "jev" ? "Jev" : "the stand-in");
    more.addEventListener("click", () => page.classList.toggle("unfolded"));
    const doc = firstSentence(r.doc);
    page.replaceChildren(
      sketch,
      el("div", "journal-name", r.name),
      el("div", "journal-what", whatItIs(thing.standsAs, r.what)),
      ...(doc === "" ? [] : [el("p", "journal-doc", doc)]),
      el("p", "journal-fare", faring(thing)),
      more,
      details,
    );
    page.classList.remove("unfolded");
    tab.replaceChildren(el("i", "", r.name), el("span", "", ` · ${standing(v).toLowerCase()}`));
    tab.setAttribute("aria-label", `About ${r.name}`);
  }

  function apply(): void {
    const has = shown !== null;
    page.classList.toggle("on", has && (current === "journal" || (current === "ask" && open)));
    tab.classList.toggle("on", has && current === "ask" && !open);
  }
  tab.addEventListener("click", () => {
    open = true;
    apply();
  });

  return {
    show(thing) {
      shown = thing;
      open = false;
      if (thing !== null) fill(thing);
      apply();
    },
    style(next) {
      current = next;
      open = false;
      apply();
    },
    state: () => ({ style: current, shown: shown?.represented.name ?? null, open: page.classList.contains("on") }),
  };
}
