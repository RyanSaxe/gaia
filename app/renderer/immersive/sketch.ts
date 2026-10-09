// What a thing says to a person who stops at it: a page of the traveller's
// sketchbook rises from the bottom edge at the lower left, and sinks again
// when they walk away. Its face is the news: an ink drawing of the thing
// washed in its health (a failing tree's crown thins and browns, a failing
// house's roof rots through and ivy climbs it, a ring's lintels fall), with
// up to two notes in the traveller's hand tied by pencil leaders to the parts
// they explain; under it, where it lives in small capitals, its name lettered
// as the map letters names, and its vitality as a reading in the hand. The
// rest is folded up behind the face along a crease at its foot: a tap swings
// it down, and another folds it up.
//
// What the page says comes from one function, `describe`, as one typed value
// (`PageContent`): the Engine and Jev session's to change, and the page shows
// whatever it holds within its limits. Code draws the rest of the face.

import { onTap } from "../lab.ts";
import type { CardThing } from "../terrain/lab.ts";

// ---------- what a page says ----------

/** The part of a sketch a note points at: every sketch has all five, a roof and a crown both its top, walls and a trunk its body. */
export type SketchPart = "crown" | "trunk" | "roof" | "walls" | "ground";

/** A few words on the sketch, tied by a pencil leader to the part they explain. */
export interface Note {
  readonly words: string;
  readonly part: SketchPart;
}

/** One entry in the rest: a fact beside its label, or without a label a line of prose in the hand. A line break in `value` starts a new line. */
export interface Entry {
  readonly label?: string;
  readonly value: string;
}

/**
 * What a thing's page says, beside what code draws on its face (the sketch,
 * where it lives, its name and its vitality). The Engine and Jev session owns
 * what goes in it and may change this type as Gaia learns what is worth
 * saying; the page renders whatever it holds, within its limits:
 *
 * - `notes`: the first two show, each on one line in the traveller's hand,
 *   the first over the sketch and the second under it, tied by a pencil
 *   leader to the part it names. A note too long for its line is set smaller
 *   until it fits, and cut short past that. With no notes the face is only
 *   the sketch, where it lives, its name and its vitality.
 * - `rest`: any number of entries, in order, unfolded below the face; a long
 *   rest scrolls within the page.
 *
 * `describe` fills it today from what the code knows.
 */
export interface PageContent {
  readonly notes: readonly Note[];
  readonly rest: readonly Entry[];
}

/** The most notes a face shows. */
const NOTES = 2;

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
export function symptomsOf(thing: CardThing): readonly Note[] {
  const kind = sketchKindOf(thing.standsAs) ?? "bush";
  const built = BUILT.has(kind);
  const top: SketchPart = built ? "roof" : "crown";
  const body: SketchPart = built ? "walls" : "trunk";
  const limb = kind === "tree" || kind === "willow" ? "bough" : built ? "wing" : "stem";
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
  return out.sort((x, y) => y.cost - x.cost).slice(0, NOTES).map(({ words, part }) => ({ words, part }));
}

/** The first sentence of a doc comment, short enough for a page in a hand, with no code marks. */
function firstSentence(doc: string): string {
  const one = doc.replace(/`/g, "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return one.length > 150 ? `${one.slice(0, 147).replace(/\s+\S*$/, "")}…` : one;
}

/**
 * What a thing's page says today, from what the code knows: its symptoms as
 * notes; and in the rest, the first sentence of its doc comment, where it
 * lives, its size, what it leans on and what leans on it, each reading that
 * lowers its health, the strongest first, and who judged it.
 */
export function describe(thing: CardThing): PageContent {
  const r = thing.represented;
  const doc = firstSentence(r.doc);
  const lowering = r.report.terms
    .filter((t) => t.penalty > 0)
    .sort((a, b) => b.weight * b.penalty - a.weight * a.penalty)
    .map((t) => t.reading ?? t.label.toLowerCase());
  const rest: Entry[] = [
    ...(doc === "" ? [] : [{ value: doc }]),
    { label: "Lives in", value: r.where },
    { label: "Size", value: r.size },
    ...(r.dependsOn.length === 0 ? [] : [{ label: "Leans on", value: r.dependsOn.join(", ") }]),
    ...(r.dependents.length === 0 ? [] : [{ label: "Leaned on by", value: r.dependents.join(", ") }]),
    ...(lowering.length === 0 ? [] : [{ label: "Lowers its health", value: lowering.join("\n") }]),
    ...(thing.judge === undefined ? [] : [{ label: "Judged by", value: thing.judge === "jev" ? "Jev" : "the stand-in" }]),
  ];
  return { notes: symptomsOf(thing), rest };
}

// ---------- the sketch ----------

/** The drawings a sketch can be: one for every kind of thing that can stand for code. */
export type SketchKind = "tree" | "willow" | "house" | "mill" | "tower" | "keep" | "lantern" | "ring" | "stone" | "boulder" | "stones" | "bush" | "feather" | "flowers";

/** Kinds whose top is a roof and whose body is walls. */
const BUILT: ReadonlySet<SketchKind> = new Set(["house", "mill", "tower", "keep", "lantern"]);

/**
 * Which drawing each thing gets, by the words of what it stands as, tried in
 * order: a watermill before a house, a keep and a lantern tower before a
 * plain tower, a stone ring before a standing stone, flowers before trees (a
 * lupine is no pine), a willow before other trees and a stone family before
 * a lone stone.
 */
const KINDS: readonly (readonly [RegExp, SketchKind])[] = [
  [/mill\b/, "mill"],
  [/\b(keep|castle|fort)\b/, "keep"],
  [/\b(lantern tower|lighthouse|lookout|watchtower|spire)\b/, "lantern"],
  [/tower\b/, "tower"],
  [/\b(ring|circle|avenue|dolmen|henge|menhirs)\b/, "ring"],
  [/(cottage|house|croft|cabin|hall|barn|workshop|farmstead|homestead)\b/, "house"],
  [/\b(flowers?|daisies|daisy|bluebells?|poppies|poppy|lupines?|marigolds?|asters?|lavender|foxgloves?)\b/, "flowers"],
  [/willow\b/, "willow"],
  [/\b(tree|oak|birch|pine|maple|cherry|elm|beech|fir|yew|ash|cedar|cypress)s?\b/, "tree"],
  [/\b(family|cairns?|pile)\b/, "stones"],
  [/\b(standing stone|monolith|menhir)\b/, "stone"],
  [/\b(boulder|rock|stone|ledge|sandstone|shale|slab)s?\b/, "boulder"],
  [/\b(feather|fern|reeds?|plumes?|grass)/, "feather"],
  [/(bush|shrub|mound|berry|rhododendron|azalea|box|hedge|heather|gorse)\b/, "bush"],
];

/** Which drawing a thing gets from what it stands as in the world, such as "A watermill"; null when no word names one. */
export function sketchKindOf(standsAs: string): SketchKind | null {
  const s = standsAs.toLowerCase();
  return KINDS.find(([words]) => words.test(s))?.[1] ?? null;
}

/** Where a sketch's top, body and ground lie in its 160 by 120 drawing, for a note's leader to reach. */
const PARTS: Readonly<Record<SketchKind, Readonly<Record<"top" | "body" | "ground", readonly [number, number]>>>> = {
  tree: { top: [66, 40], body: [80, 92], ground: [100, 111] },
  willow: { top: [64, 42], body: [80, 96], ground: [104, 111] },
  house: { top: [70, 56], body: [100, 96], ground: [120, 111] },
  mill: { top: [70, 56], body: [96, 96], ground: [120, 111] },
  tower: { top: [80, 34], body: [86, 80], ground: [104, 111] },
  keep: { top: [70, 30], body: [90, 82], ground: [110, 111] },
  lantern: { top: [80, 24], body: [86, 82], ground: [106, 111] },
  ring: { top: [80, 70], body: [58, 92], ground: [110, 111] },
  stone: { top: [80, 52], body: [88, 92], ground: [106, 111] },
  boulder: { top: [80, 82], body: [100, 100], ground: [118, 111] },
  stones: { top: [68, 80], body: [104, 102], ground: [122, 111] },
  bush: { top: [80, 80], body: [100, 98], ground: [110, 111] },
  feather: { top: [80, 42], body: [82, 98], ground: [104, 111] },
  flowers: { top: [72, 82], body: [86, 100], ground: [104, 111] },
};

/** Where on a sketch of `kind` a note on `part` points. */
function partAt(kind: SketchKind, part: SketchPart): readonly [number, number] {
  const at = PARTS[kind];
  return part === "crown" || part === "roof" ? at.top : part === "trunk" || part === "walls" ? at.body : at.ground;
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

type Rgb = readonly [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): string => `rgb(${a.map((x, i) => Math.round(x + ((b[i] as number) - x) * t)).join(",")})`;
const DRY: Rgb = [176, 156, 118];
const LIFE: Rgb = [118, 158, 82];
const ROOF: Rgb = [168, 108, 72];
const IVY = "rgb(92,120,70)";
const STONE = "#c9c2b2";
const PLASTER = "#efe4c8";
/** Each flower's bloom when it thrives, and the shape the pen gives it. */
const BLOOMS: readonly (readonly [RegExp, Rgb, "disc" | "bell" | "spike"])[] = [
  [/\bbluebell/, [92, 110, 196], "bell"],
  [/\b(lupine|lavender|foxglove)/, [128, 96, 186], "spike"],
  [/\b(poppies|poppy)/, [204, 70, 52], "disc"],
  [/\bmarigold/, [226, 146, 44], "disc"],
  [/\baster/, [222, 132, 172], "disc"],
  [/\b(daisies|daisy)/, [246, 242, 228], "disc"],
];
const BLOOM: Rgb = [214, 150, 170];

const f = (n: number): string => n.toFixed(1);

/**
 * An ink sketch of a thing, its wash in its health's color. Vitality is the
 * sketch's own state: a crown's blobs thin and brown, a roof rots through and
 * ivy climbs the walls, a keep loses its battlements and a lantern goes dark,
 * a ring's lintels fall and then its stones, moss leaves a stone and blooms
 * fall from their stems. Every inked stroke is a `pen` path, which the page
 * draws from nothing as it rises.
 */
export function sketchOf(standsAs: string, name: string, vitality: number): string {
  const rand = streamOf(hashOf(name));
  const v = Math.max(0, Math.min(1, vitality));
  const wash = mix(DRY, LIFE, v);
  const wob = (x: number): string => f(x + (rand() - 0.5) * 2.2);
  const pen = (d: string, width = 1.6, opacity = 1): string =>
    `<path class="pen" pathLength="1" d="${d}" fill="none" stroke="#4a3c2c" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${opacity < 1 ? ` opacity="${opacity.toFixed(2)}"` : ""}/>`;
  const fill = (d: string, color: string, opacity: number): string => `<path d="${d}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
  /** A crown's or a bush's masses round a middle: a failing one keeps only some of them, each a wash with a stroke of the pen over it. */
  const blobs = (cx: number, cy: number, rx: number, ry: number, n: number, color: string, size = 9): string => {
    let out = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.6;
      const r = 0.55 + rand() * 0.4;
      if (rand() > 0.25 + v * 0.8) continue;
      const x = cx + Math.cos(a) * rx * r;
      const y = cy + Math.sin(a) * ry * r;
      const s = size + rand() * size;
      out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s)}" fill="${color}" opacity="${(0.55 + rand() * 0.25).toFixed(2)}"/>`;
      out += pen(`M${f(x - s)} ${f(y)} a${f(s)} ${f(s)} 0 0 1 ${f(s * 1.9)} ${f(-s * 0.3)}`, 1.1, 0.7);
    }
    return out;
  };
  /** Ivy taking a failing wall. */
  const ivy = (x: number, y: number): string => (v < 0.6 ? blobs(x, y, 8, 10, 8, IVY).replaceAll(/r="[\d.]+"/g, 'r="5"') : "");
  const crack = (x: number, y: number): string => (v < 0.5 ? pen(`M${f(x)} ${f(y)} l6 8 l-3 5 l7 6`, 1.2) : "");
  const ground = pen(`M8 ${wob(112)} C 40 ${wob(108)}, 80 ${wob(114)}, 112 ${wob(110)} S 150 ${wob(112)}, 152 ${wob(111)}`, 1.2, 0.75);
  const s = standsAs.toLowerCase();
  const kind = sketchKindOf(standsAs) ?? "bush";
  let body = "";
  switch (kind) {
    case "tree": {
      // A great tree spreads wider on a stouter trunk.
      const k = /great|vast|ancient/.test(s) ? 1.22 : 1;
      body += pen(`M${wob(80 - 4 * k)} 111 C ${f(80 - 3 * k)} 90, ${f(80 - 6 * k)} 74, ${wob(72)} 58 M${wob(80 + 4 * k)} 111 C ${f(80 + 2 * k)} 92, ${f(80 + 4 * k)} 76, ${wob(88)} 60 M76 76 C 66 66, 58 62, ${wob(80 - 28 * k)} 52 M84 80 C 94 70, 102 66, ${wob(80 + 28 * k)} 56`);
      // The crown's body, then its masses round it; a failing crown keeps fewer and browns.
      body += `<ellipse cx="80" cy="48" rx="${f((18 + v * 14) * k)}" ry="${f(14 + v * 10)}" fill="${wash}" opacity="${(0.35 + v * 0.35).toFixed(2)}"/>`;
      body += blobs(80, 48, 40 * k, 30, Math.round(16 * k), wash);
      break;
    }
    case "willow": {
      body += pen(`M${wob(74)} 111 C 76 96, 72 84, ${wob(70)} 70 M${wob(87)} 111 C 85 96, 88 84, ${wob(91)} 70 M72 76 C 64 64, 54 58, ${wob(46)} 56 M89 76 C 98 64, 106 58, ${wob(114)} 56`);
      body += blobs(80, 46, 34, 16, 10, wash, 8);
      // Its strands fall from the crown in a curtain to the grass; a failing willow keeps few, short and brown.
      for (let i = 0; i < 24; i++) {
        const out = (i - 11.5) / 12;
        const x = 80 + out * 44 + (rand() - 0.5) * 3;
        const from = 44 - Math.sqrt(Math.max(0, 1 - out * out)) * 12 + rand() * 6;
        const fall = (100 - from - 6 - rand() * 14) * (0.45 + v * 0.55);
        if (rand() > 0.3 + v * 0.75) continue;
        const d = `M${f(x)} ${f(from)} q${f(out * 9)} ${f(fall * 0.25)} ${f(out * 7 + (rand() - 0.5) * 2)} ${f(fall)}`;
        body += `<path d="${d}" fill="none" stroke="${wash}" stroke-width="${f(1.4 + rand())}" stroke-linecap="round" opacity=".8"/>`;
        if (i % 4 === 1) body += pen(d, 0.8, 0.5);
      }
      break;
    }
    case "house":
    case "mill":
    case "tower": {
      const w = kind === "tower" ? 34 : 64;
      const x0 = 80 - w / 2;
      const top = kind === "tower" ? 44 : 68;
      body += `<rect x="${x0}" y="${top}" width="${w}" height="${111 - top}" fill="${PLASTER}" opacity=".85"/>`;
      body += pen(`M${wob(x0)} 111 L${wob(x0)} ${top} L${wob(x0 + w)} ${top} L${wob(x0 + w)} 111`);
      // The roof: whole while it thrives, holed and sagging as it fails.
      const peak = (kind === "tower" ? 18 : 36) + (1 - v) * 10;
      body += fill(`M${x0 - 8} ${top + 2} L80 ${f(peak)} L${x0 + w + 8} ${top + 2} Z`, mix(DRY, ROOF, v), 0.45 + v * 0.4);
      body += pen(`M${wob(x0 - 8)} ${top + 2} L80 ${f(peak)} L${wob(x0 + w + 8)} ${top + 2}`);
      body += crack(x0 + w * 0.55, top - 6);
      body += pen("M76 111 L76 96 Q80 91 84 96 L84 111");
      body += pen(`M${x0 + 8} ${top + 12} h9 v9 h-9 Z`, 1.2);
      if (kind === "mill") body += pen(`M${x0 + w + 27} 96 a15 15 0 1 0 -30 0 a15 15 0 1 0 30 0`) + pen(`M${x0 + w + 12} 81 V111 M${x0 + w - 3} 96 H${x0 + w + 27}`, 1.1);
      if (v > 0.4 && kind !== "tower") body += pen(`M${x0 + w - 12} ${top - 14} q4 -8 0 -14 q-4 -6 2 -12`, 1, (v - 0.4) * 1.4);
      body += ivy(x0 + 6, 100);
      break;
    }
    case "keep": {
      const x0 = 56;
      const w = 48;
      const top = 34;
      body += `<rect x="${x0}" y="${top}" width="${w}" height="${111 - top}" fill="#ddd4c0" opacity=".9"/>`;
      body += pen(`M${wob(x0)} 111 L${wob(x0)} ${top} M${wob(x0 + w)} ${top} L${wob(x0 + w)} 111`);
      // Its battlements: whole while it thrives, falling one by one as it fails.
      let parapet = `M${x0} ${top}`;
      for (let i = 0; i < 5; i++) {
        const mw = w / 9;
        const mx = x0 + i * (w - mw) / 4;
        if (rand() > 0.2 + v * 0.85) continue;
        body += `<rect x="${f(mx)}" y="${top - 8}" width="${f(mw)}" height="8" fill="#ddd4c0" opacity=".9"/>`;
        parapet += ` L${f(mx)} ${top} L${f(mx)} ${top - 8} L${f(mx + mw)} ${top - 8} L${f(mx + mw)} ${top}`;
      }
      body += pen(`${parapet} L${x0 + w} ${top}`, 1.4);
      body += pen("M75 111 L75 98 Q80 91 85 98 L85 111");
      body += pen("M70 52 v9 M90 52 v9 M80 68 v8", 1.4);
      body += crack(x0 + w * 0.6, top + 4);
      // A ruin's stones lie at its foot.
      if (v < 0.35) body += pen(`M${x0 - 10} 111 q4 -5 8 0 M${x0 + w + 4} 111 q3 -4 7 -1 q3 -2 5 1`, 1.1);
      body += ivy(x0 + 8, 98);
      break;
    }
    case "lantern": {
      // A tapering round tower with a gallery and a lantern room, lit while it thrives; a ruin's top has fallen.
      const ruined = v < 0.35;
      const top = ruined ? 54 : 46;
      body += fill(`M60 111 L67 ${top} L93 ${top} L100 111 Z`, "#ddd3bf", 0.9);
      body += pen(`M${wob(60)} 111 L${wob(67)} ${top} M${wob(93)} ${top} L${wob(100)} 111`);
      body += pen("M76 111 L76 99 Q80 94 84 99 L84 111 M79 66 v8", 1.3);
      if (ruined) body += pen(`M67 ${top} l4 -7 l4 5 l5 -9 l4 7 l5 -4 l4 8`, 1.3);
      else {
        body += pen(`M62 ${top} L98 ${top} M63 ${top - 4} L97 ${top - 4} M66 ${top - 4} v4 M74 ${top - 4} v4 M86 ${top - 4} v4 M94 ${top - 4} v4`, 1.2);
        body += `<rect x="71" y="${top - 18}" width="18" height="14" fill="#f2c45a" opacity="${(v * 0.75).toFixed(2)}"/>`;
        body += pen(`M71 ${top - 4} V${top - 18} H89 V${top - 4} M80 ${top - 18} V${top - 4}`, 1.3);
        // A failing lantern's cap is broken open.
        body += v < 0.6 ? pen(`M68 ${top - 18} L76 ${top - 28} M84 ${top - 26} L92 ${top - 18}`) : pen(`M68 ${top - 18} L80 ${top - 32} L92 ${top - 18}`);
      }
      body += ivy(66, 100);
      break;
    }
    case "ring": {
      // Standing stones round a king stone, seen across the ring: lintels on the far stones while it thrives,
      // lying in the grass as it fails, and then the stones themselves lean and fall.
      const lean = (1 - v) * 7;
      const stone = (x: number, base: number, h: number, tilt: number, fallen: boolean): string => {
        if (fallen) {
          const d = `M${x - 12} ${base} L${x - 12} ${base - 7} L${x + 14} ${base - 8} L${x + 14} ${base}`;
          return fill(`${d} Z`, STONE, 0.8) + pen(d, 1.3);
        }
        const d = `M${f(x - 5)} ${base} L${f(x - 4 + tilt)} ${f(base - h)} L${f(x + 5 + tilt)} ${f(base - h - 1)} L${f(x + 6)} ${base}`;
        return fill(`${d} Z`, STONE, 0.8) + pen(d, 1.4);
      };
      const fallen = (i: number): boolean => v < 0.25 && i % 2 === 1;
      const back: readonly (readonly [number, number])[] = [
        [44, 97],
        [66, 94],
        [94, 94],
        [116, 97],
      ];
      back.forEach(([x, base], i) => (body += stone(x, base, 26, i < 2 ? -lean : lean, fallen(i))));
      // Lintels across the far stones' tops, as many as its health keeps up; the rest lie in the grass. Menhirs carry none.
      const lintels = /menhir/.test(s) ? 0 : 3;
      const up = Math.min(lintels, v > 0.75 ? 3 : v > 0.5 ? 1 : 0);
      for (const [i, [a, b]] of ([[66, 94], [44, 66], [94, 116]] as const).slice(0, lintels).entries()) {
        if (i < up) body += fill(`M${a - 6} 66 L${b + 6} 66 L${b + 6} 71 L${a - 6} 71 Z`, STONE, 0.85) + pen(`M${a - 6} 71 L${a - 6} 66 L${b + 6} 66 L${b + 6} 71 Z`, 1.3);
        else body += pen(`M${52 + i * 22} 110 l18 -1 l0 -4 l-18 1 Z`, 1.1, 0.8);
      }
      body += stone(80, 100, 36, lean * 0.4, false);
      body += stone(36, 107, 30, -lean, fallen(5)) + stone(124, 107, 30, lean, false);
      body += `<path d="M30 92 c6 -4 10 -4 14 -2 M118 94 c5 -3 9 -3 12 0" fill="none" stroke="${wash}" stroke-width="${f(1 + v * 4)}" stroke-linecap="round" opacity="${(0.2 + v * 0.5).toFixed(2)}"/>`;
      break;
    }
    case "stone": {
      const lean = (1 - v) * 5;
      const d = `M${wob(66)} 111 C 64 90, ${f(66 + lean)} 62, ${f(78 + lean)} 46 C ${f(90 + lean)} 48, 96 80, ${wob(96)} 111`;
      body += fill(`${d} Z`, STONE, 0.8) + pen(d);
      body += `<path d="M70 70 c4 -6 10 -10 18 -10" fill="none" stroke="${wash}" stroke-width="${f(2 + v * 6)}" stroke-linecap="round" opacity="${(0.25 + v * 0.55).toFixed(2)}"/>`;
      if (v < 0.5) body += pen("M84 60 l-4 12 l5 8", 1.1);
      break;
    }
    case "boulder":
    case "stones": {
      // A broad stone or a low slab, its moss going as it fails; a family is a big stone and its small ones.
      const flat = /bench|ledge|slab|shale/.test(s);
      const tone = /sand/.test(s) ? "#dcc49a" : STONE;
      const rock = (x0: number, x1: number, top: number): string => {
        const mid = (x0 + x1) / 2;
        const rise = 111 - top;
        const d = flat
          ? `M${wob(x0)} 111 C ${x0} 100, ${x0 + 8} ${top}, ${f(mid)} ${top} C ${x1 - 8} ${top}, ${x1} 100, ${wob(x1)} 111`
          : `M${wob(x0)} 111 C ${x0} ${f(top + rise * 0.3)}, ${f(x0 + (mid - x0) * 0.3)} ${top}, ${f(mid)} ${top} C ${f(x1 - (x1 - mid) * 0.3)} ${top}, ${x1} ${f(top + rise * 0.35)}, ${wob(x1)} 111`;
        return fill(`${d} Z`, tone, 0.8) + pen(d);
      };
      if (kind === "stones") body += rock(44, 96, 70) + rock(98, 120, 96) + rock(122, 136, 103) + rock(26, 42, 101);
      else body += rock(36, 124, flat ? 94 : 76);
      if (flat) body += pen("M44 100 C 60 97, 100 97, 118 100", 1.1, 0.7);
      body += blobs(kind === "stones" ? 70 : 80, flat ? 95 : 80, kind === "stones" ? 16 : 26, 3, 8, wash, 4);
      if (v < 0.5) body += pen("M86 82 l-4 10 l5 7", 1.1);
      break;
    }
    case "bush": {
      // A clipped box keeps its dome; others are loose masses, a rhododendron in flower, a blueberry in fruit.
      if (/\bbox\b|clipped|mound/.test(s)) body += `<ellipse cx="80" cy="96" rx="${f(26 + v * 6)}" ry="${f(14 + v * 4)}" fill="${wash}" opacity="${(0.45 + v * 0.3).toFixed(2)}"/>`;
      body += blobs(80, 92, 30, 16, 14, wash);
      body += pen(`M${wob(50)} 108 C 52 84, 70 74, ${wob(82)} 76 C 98 76, 112 88, ${wob(110)} 108`, 1.6, 0.8);
      const fruit = /rhododendron|azalea|camellia/.test(s) ? { color: mix(DRY, [214, 120, 160], v), r: 3.4 } : /berry/.test(s) ? { color: mix(DRY, [64, 78, 140], v), r: 1.9 } : null;
      for (let i = 0; fruit !== null && i < 12; i++) {
        const x = 56 + rand() * 48;
        const y = 82 + rand() * 20;
        if (rand() < 0.2 + v * 0.8) body += `<circle cx="${f(x)}" cy="${f(y)}" r="${fruit.r}" fill="${fruit.color}" opacity=".85"/>`;
      }
      break;
    }
    case "feather": {
      // Tall plumes fanning from one root, drooping and browning as it fails.
      for (let i = 0; i < 7; i++) {
        const a = (i - 3) * 0.2 + (rand() - 0.5) * 0.08;
        const h = 58 + rand() * 12;
        const droop = (1 - v) * 18 * (i < 3 ? -1 : 1);
        const tx = 80 + Math.sin(a) * h + droop;
        const ty = 111 - Math.cos(a) * h + (1 - v) * 14;
        body += pen(`M${80 + (i - 3) * 1.5} 111 Q${f(80 + Math.sin(a) * h * 0.4)} ${f(111 - h * 0.5)} ${f(tx)} ${f(ty)}`, 1.1);
        body += `<ellipse cx="${f(tx)}" cy="${f(ty + 8)}" rx="4" ry="11" transform="rotate(${f((a * 180) / Math.PI)} ${f(tx)} ${f(ty)})" fill="${wash}" opacity="${(0.35 + v * 0.35).toFixed(2)}"/>`;
      }
      break;
    }
    case "flowers": {
      const [, color, shape] = BLOOMS.find(([words]) => words.test(s)) ?? [null, BLOOM, "disc"];
      const bloom = mix(DRY, color, v);
      // The drift's leaves low in the grass, then its stems and blooms.
      body += `<ellipse cx="82" cy="108" rx="${f(26 + v * 10)}" ry="5" fill="${wash}" opacity="${(0.3 + v * 0.35).toFixed(2)}"/>`;
      body += pen(`M56 110 q6 -9 12 -7 M74 111 q-4 -8 -10 -9 M94 110 q5 -8 11 -6 M106 111 q-3 -7 -8 -8`, 1, 0.7);
      for (let i = 0; i < 7; i++) {
        const x = 50 + i * 10 + rand() * 6;
        const h = 22 + rand() * 18;
        const droop = (1 - v) * 10;
        const tx = x + droop;
        const ty = 111 - h + droop;
        body += pen(`M${f(x)} 111 q${f(droop * 0.4)} ${f(-h * 0.6)} ${f(droop)} ${f(-h + droop)}`, 1.2);
        // A failing drift keeps few blooms.
        if (rand() >= 0.3 + v * 0.7) continue;
        if (shape === "bell") body += `<ellipse cx="${f(tx + 3)}" cy="${f(ty + 4)}" rx="2.6" ry="3.6" fill="${bloom}" opacity=".85"/><ellipse cx="${f(tx - 2)}" cy="${f(ty + 9)}" rx="2.4" ry="3.2" fill="${bloom}" opacity=".8"/>`;
        else if (shape === "spike") for (let k = 0; k < 4; k++) body += `<circle cx="${f(tx + (k % 2 ? 1.6 : -1.6))}" cy="${f(ty + k * 4)}" r="2.4" fill="${bloom}" opacity=".8"/>`;
        else body += `<circle cx="${f(tx)}" cy="${f(ty)}" r="5" fill="${bloom}" opacity=".85"/><circle cx="${f(tx)}" cy="${f(ty)}" r="5" fill="none" stroke="#7a6a50" stroke-width=".5" opacity=".6"/>`;
      }
      break;
    }
  }
  return `${body}${ground}`;
}

// ---------- the page ----------

export interface SketchPage {
  /** Shows the page of what the person stopped at, or lets it sink (null). */
  show(thing: CardThing | null): void;
  /** Swings the rest down below the face, or folds it up. */
  unfold(on: boolean): void;
  /** What shows now, for scripted checks. */
  state(): {
    readonly shown: string | null;
    readonly notes: readonly string[];
    readonly vitality: string | null;
    readonly unfolded: boolean;
    readonly rest: readonly Entry[];
  };
}

/** How long a page takes to sink, ms, as lab.css moves it: a new thing's page rises once the last has gone. */
const SINK_MS = 800;
/** A note never shrinks smaller than this to fit its line, px; past it, it is cut short. */
const NOTE_MIN_PX = 11;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A torn edge on the sides named (t, r, b, l), and a straight one where the paper folds, as a mask. */
function deckle(seed: number, torn: string): string {
  const rand = streamOf(seed);
  const at = (side: string): number => (torn.includes(side) ? 3 + rand() * 4.5 + (rand() < 0.07 ? 4 : 0) : 0);
  const points: string[] = [];
  for (let x = 0; x <= 1000; x += 6) points.push(`${x},${f(at("t"))}`);
  for (let y = 0; y <= 1000; y += 6) points.push(`${f(1000 - at("r"))},${y}`);
  for (let x = 1000; x >= 0; x -= 6) points.push(`${x},${f(1000 - at("b"))}`);
  for (let y = 1000; y >= 0; y -= 6) points.push(`${f(at("l"))},${y}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><polygon points="${points.join(" ")}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Where a thing lives, over its name: its folders, and for something inside a file, the file too. */
function whereOf(where: string, name: string): string {
  const path = where.replace(/:\d+$/, "").split("/");
  return (path[path.length - 1] === name ? path.slice(0, -1) : path).join(" / ");
}

/**
 * A thing's page, standing at the lower left of `root`: it rises when the
 * person stops at a thing and sinks when they walk away. `say` is what the
 * page says (`describe` unless asked otherwise).
 */
export function createSketchPage(root: HTMLElement, say: (thing: CardThing) => PageContent = describe): SketchPage {
  const page = el("div", "thing-page");
  const lift = el("div", "thing-page-lift");
  lift.setAttribute("role", "button");
  lift.setAttribute("aria-expanded", "false");
  lift.tabIndex = -1;
  // Each sheet's torn paper lies in a still layer that casts its shadow, so the page moves by transforms alone.
  const face = el("div", "thing-page-face");
  face.style.setProperty("--deckle", deckle(31, "trl"));
  const rest = el("div", "thing-page-rest");
  rest.style.setProperty("--deckle", deckle(53, "rbl"));
  const flap = el("div", "thing-page-flap");
  const sheet = (paper: HTMLElement): HTMLElement => {
    const s = el("div", "thing-page-sheet");
    s.append(paper);
    return s;
  };
  flap.append(sheet(rest));
  lift.append(sheet(face), flap);
  page.append(lift);
  root.append(page);

  let shown: CardThing | null = null;
  let up = false;
  let content: PageContent = { notes: [], rest: [] };
  let unfolded = false;
  let rising = 0;

  /** Fills the page for a thing while it waits below the screen's edge, then sets each note on its line and draws its leader. */
  function fill(thing: CardThing): void {
    const r = thing.represented;
    const kind = sketchKindOf(thing.standsAs) ?? "bush";
    content = say(thing);
    const notes = content.notes.slice(0, NOTES);
    const drawing = el("div", "thing-page-drawing");
    drawing.classList.toggle("over", notes.length > 0);
    drawing.classList.toggle("under", notes.length > 1);
    drawing.innerHTML = `<svg class="thing-page-sketch" viewBox="0 0 160 120" aria-hidden="true">${sketchOf(thing.standsAs, r.name, r.report.vitality)}</svg><svg class="thing-page-leaders" aria-hidden="true"></svg>`;
    const noteEls = notes.map((n, i) => el("div", `thing-page-note ${i === 0 ? "over" : "under"}`, n.words));
    drawing.append(...noteEls);
    const where = whereOf(r.where, r.name);
    const title = el("div", "thing-page-title");
    title.append(el("div", "thing-page-name", r.name), el("div", "thing-page-vitality", r.report.vitality.toFixed(2)));
    face.replaceChildren(drawing, ...(where === "" ? [] : [el("div", "thing-page-where", where)]), title, el("div", "thing-page-crease"));
    // The rest, in order: facts beside their labels, gathered into one list while they run, and prose in the hand.
    const parts: HTMLElement[] = [];
    let list: HTMLDListElement | null = null;
    for (const e of content.rest) {
      if (e.label === undefined) {
        list = null;
        parts.push(el("p", "thing-page-prose", e.value));
        continue;
      }
      if (list === null) parts.push((list = el("dl", "thing-page-facts")));
      list.append(el("dt", "", e.label), el("dd", "", e.value));
    }
    rest.replaceChildren(...parts);
    lift.setAttribute("aria-label", `About ${r.name}`);

    // Measured once, here: a note too long for its line is set smaller until it fits, with a little to spare
    // so rounding never cuts its last letters.
    const room = drawing.clientWidth;
    for (const n of noteEls) {
      if (n.scrollWidth > room) n.style.fontSize = `${f(Math.max(NOTE_MIN_PX, (parseFloat(getComputedStyle(n).fontSize) * room * 0.97) / n.scrollWidth))}px`;
    }
    // Each note's pencil leader runs from the note to the part it names, ending in a dot.
    const sketch = drawing.querySelector(".thing-page-sketch") as SVGSVGElement;
    const leaders = drawing.querySelector(".thing-page-leaders") as SVGSVGElement;
    leaders.setAttribute("viewBox", `0 0 ${drawing.clientWidth} ${drawing.clientHeight}`);
    const scale = sketch.clientWidth / 160;
    const ox = (drawing.clientWidth - sketch.clientWidth) / 2;
    const oy = parseFloat(getComputedStyle(drawing).paddingTop) || 0;
    leaders.innerHTML = notes
      .map((n, i) => {
        const note = noteEls[i] as HTMLElement;
        const [sx, sy] = partAt(kind, n.part);
        const px = ox + sx * scale;
        const py = oy + sy * scale;
        const [ax, ay, end] =
          i === 0 ? [Math.min(note.offsetLeft + note.offsetWidth - 10, px - 14), note.offsetTop + note.offsetHeight + 2, px - 3] : [Math.max(note.offsetLeft + 10, px + 14), note.offsetTop - 2, px + 3];
        return `<path d="M${f(ax)} ${f(ay)} Q${f(ax)} ${f(py)} ${f(end)} ${f(py)}"/><circle cx="${f(px)}" cy="${f(py)}" r="1.7"/>`;
      })
      .join("");
    page.style.setProperty("--face-h", `${face.offsetHeight}px`);
    page.style.setProperty("--rest-h", `${rest.offsetHeight}px`);
  }

  function setUp(on: boolean): void {
    up = on;
    page.classList.toggle("on", on);
    lift.tabIndex = on ? 0 : -1;
  }
  function setUnfolded(on: boolean): void {
    unfolded = on && up;
    page.classList.toggle("unfolded", unfolded);
    lift.setAttribute("aria-expanded", String(unfolded));
  }
  onTap(lift, () => setUnfolded(!unfolded));
  lift.addEventListener("keydown", (e) => {
    if (e.code === "Enter" || e.code === "Space") setUnfolded(!unfolded);
  });

  return {
    show(thing) {
      if (thing !== null && thing.represented.id === shown?.represented.id) return;
      const sinking = up;
      shown = thing;
      setUnfolded(false);
      setUp(false);
      window.clearTimeout(rising);
      if (thing === null) return;
      // A new thing's page rises once the last has sunk, filled while it waits and drawn afresh by the pen as it comes.
      rising = window.setTimeout(
        () => {
          fill(thing);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (shown === thing) setUp(true);
            }),
          );
        },
        sinking ? SINK_MS : 0,
      );
    },
    unfold: (on) => setUnfolded(on),
    state: () => ({
      shown: up ? (shown?.represented.name ?? null) : null,
      notes: up ? content.notes.slice(0, NOTES).map((n) => n.words) : [],
      vitality: up ? (shown?.represented.report.vitality.toFixed(2) ?? null) : null,
      unfolded,
      rest: up ? content.rest : [],
    }),
  };
}
