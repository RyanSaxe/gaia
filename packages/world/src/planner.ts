// Turns a kind into Jev questions and Jev's answers into a blueprint. The
// structure request picks each slot's primitive first. Detail requests then
// cover the chosen primitives' params, so the details match the structure.

import {
  type AnyPrimitive,
  type Blueprint,
  blueprintOf,
  type Field,
  type FilledSlot,
  type JevAnswer,
  type JevQuestion,
  type JevRequest,
  type AnyKind,
  type Library,
  isStoredValue,
  rand,
  seedOf,
  slotOrder,
  stagesOf,
} from "@gaia/schema";

export const MODEL = "typesafe/jev-1.13";

/** The thing a blueprint is for, and the state Jev sees while answering. */
export interface Target {
  /** Stable ID that seeds option order, such as a region path. */
  readonly id: string;
  readonly state: Readonly<Record<string, unknown>>;
  /** Features the thing's place provides that a primitive may need, such as running water. */
  readonly has?: readonly string[];
  /** The thing's importance rank among the world's things, 0 to 1, for primitives whose needs include a rank range. */
  readonly rank?: number;
  /** The part already chosen for each slot, such as the frame a thing's form sets. It is the only candidate, so Jev is never asked. */
  readonly uses?: Readonly<Record<string, string>>;
}

type Ref =
  | { readonly is: "use"; readonly slot: string }
  | { readonly is: "present"; readonly slot: string }
  | { readonly is: "param"; readonly slot: string; readonly param: string; readonly field: Field }
  | { readonly is: "member"; readonly slot: string; readonly param: string; readonly member: string }
  | { readonly is: "fixed"; readonly slot: string; readonly param: string; readonly value: string | boolean };

export interface Wave {
  readonly request: JevRequest;
  readonly refs: Readonly<Record<string, Ref>>;
  /** For a structure wave, the primitive ids offered for each slot. A slot with none is left out. */
  readonly offered?: Readonly<Record<string, readonly string[]>>;
}

/** Which primitive fills each slot, after the structure request. Absent optional slots are left out. */
export type Structure = Readonly<Record<string, string>>;

/**
 * Jev picks the first option of a choice more often. A shuffle seeded by the
 * target spreads that bias evenly across the world.
 */
function shuffled<T>(items: readonly T[], label: string, target: Target): T[] {
  const r = rand(seedOf(target.id)).fork(label);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function questionFor(field: Field, context: string, label: string, target: Target): JevQuestion {
  const instructions = `${context} ${field.ask}`;
  switch (field.type) {
    case "choice": {
      const keys = shuffled(Object.keys(field.options), label, target);
      return {
        type: "choice",
        instructions,
        criteria: Object.fromEntries(keys.map((k) => [k, (field.options as Record<string, string>)[k] ?? k])),
      };
    }
    case "scale":
      return { type: "score", instructions, criteria: field.levels.map((l) => l.words) };
    case "flag":
      return { type: "noul", instructions, criteria: { true: field.yes, false: field.no } };
    case "set":
      throw new Error("A set becomes one noul per member; use memberQuestions.");
  }
}

export function planStructure(k: AnyKind, lib: Library, target: Target): Wave {
  const questions: Record<string, JevQuestion> = {};
  const refs: Record<string, Ref> = {};
  const offered: Record<string, readonly string[]> = {};
  for (const [name, s] of Object.entries(k.slots)) {
    // Offer only primitives whose needs the place meets, or the part already chosen. An optional slot nothing fits is skipped.
    const settled = target.uses?.[name];
    const fitting = settled !== undefined ? [lib.get(settled)] : lib.forRole(s.role, { has: target.has ?? [], ...(target.rank === undefined ? {} : { rank: target.rank }) });
    if (fitting.length === 0) {
      if (s.optional) continue;
      throw new Error(`No ${s.role} primitive fits ${target.id || "the repository's root"}'s place.`);
    }
    offered[name] = fitting.map((p) => p.id);
    // A slot's own `ask` text, which says what the part means about the code, goes into its questions.
    const context = s.ask === undefined ? `${k.doc} This is about its ${name}.` : `${k.doc} Its ${name}: ${s.ask}`;
    if (s.optional) {
      questions[`${name}.present`] = {
        type: "noul",
        instructions: s.ask === undefined ? `${context} Should it have a ${name} (${s.role.toLowerCase()})?` : `${context} Should it have one?`,
        criteria: { true: `It has a ${name}.`, false: `It has no ${name}.` },
      };
      refs[`${name}.present`] = { is: "present", slot: name };
    }
    const candidates = shuffled(fitting, `${name}.use`, target);
    if (candidates.length === 1) continue;
    questions[`${name}.use`] = {
      type: "choice",
      instructions: s.ask === undefined ? `${context} Which form fits it best?` : `${context} Which suits it?`,
      criteria: Object.fromEntries(candidates.map((p) => [p.id, p.doc])),
    };
    refs[`${name}.use`] = { is: "use", slot: name };
  }
  return { request: { model: MODEL, state: target.state, questions }, refs, offered };
}

export function readStructure(k: AnyKind, lib: Library, wave: Wave, answers: Readonly<Record<string, JevAnswer>>): Structure {
  const out: Record<string, string> = {};
  const offered = wave.offered;
  if (offered === undefined) throw new Error("readStructure reads the wave planStructure made.");
  for (const name of slotOrder(k)) {
    const s = k.slots[name] as AnyKind["slots"][string];
    const candidates = offered[name] ?? [];
    if (candidates.length === 0) continue;
    if (s.optional && !yes(answers[`${name}.present`])) continue;
    // Skip a slot whose `on` slot is absent, whatever Jev answered.
    if (s.on !== undefined && !(s.on in out)) continue;
    const chosen = candidates.length === 1 ? candidates[0] : pick(answers[`${name}.use`]);
    if (chosen === undefined || !candidates.includes(chosen)) {
      throw new Error(`Jev's answer for ${name}.use is not a ${s.role} primitive it was offered.`);
    }
    out[name] = chosen;
  }
  return out;
}

export interface DetailOptions {
  /** Which of the kind's stages to ask. 0 when the kind has one stage. */
  readonly stage?: number;
  /**
   * Allowed keys per field path, such as a region's native families for "palette.family". A choice left with one
   * key is filled with it, not asked.
   */
  readonly narrow?: Readonly<Record<string, readonly string[]>>;
  /** Values already set per field path, such as `relief.stream`. These are filled in, not asked. */
  readonly fixed?: Readonly<Record<string, string | boolean>>;
  /** Values settled in earlier stages. They go into this stage's request state. */
  readonly earlier?: Readonly<Record<string, unknown>>;
}

export function planDetails(k: AnyKind, lib: Library, structure: Structure, target: Target, options: DetailOptions = {}): Wave {
  const { stage = 0, narrow = {}, fixed = {}, earlier } = options;
  const inStage = new Set(stagesOf(k)[stage] ?? []);
  const questions: Record<string, JevQuestion> = {};
  const refs: Record<string, Ref> = {};
  const chosen = Object.fromEntries(Object.entries(structure).map(([slot, id]) => [slot, lib.get(id)]));
  const state = { ...target.state, decided: describe(chosen), ...(earlier === undefined ? {} : { earlier }) };
  for (const [slotName, p] of Object.entries(chosen)) {
    if (!inStage.has(slotName)) continue;
    const ask = k.slots[slotName]?.ask;
    const context = `${k.doc} Its ${slotName} is ${p.doc.replace(/\.$/, "").toLowerCase()}.${ask === undefined ? "" : ` ${ask}`}`;
    for (const [param, raw] of Object.entries(p.params)) {
      const id = `${slotName}.${param}`;
      const value = fixed[id] ?? onlyKey(raw, narrow[id]);
      if (value !== undefined) {
        refs[id] = { is: "fixed", slot: slotName, param, value };
        continue;
      }
      const field = narrowed(raw, narrow[id]);
      if (field.type === "set") {
        for (const [member, desc] of Object.entries(field.members as Record<string, string>)) {
          questions[`${id}:${member}`] = {
            type: "noul",
            instructions: `${context} ${field.ask} Include this? ${desc}`,
            criteria: { true: `Include ${member}.`, false: `Leave out ${member}.` },
          };
          refs[`${id}:${member}`] = { is: "member", slot: slotName, param, member };
        }
        continue;
      }
      questions[id] = questionFor(field, context, id, target);
      refs[id] = { is: "param", slot: slotName, param, field };
    }
  }
  return { request: { model: MODEL, state, questions }, refs };
}

/** The single allowed key of a choice, if `allowed` leaves exactly one. */
function onlyKey(field: Field, allowed: readonly string[] | undefined): string | undefined {
  if (field.type !== "choice" || allowed === undefined) return undefined;
  const keys = Object.keys(field.options).filter((key) => allowed.includes(key));
  return keys.length === 1 ? keys[0] : undefined;
}

/** A choice or set limited to the allowed keys. An empty or missing list, or a choice left with under two keys, keeps the field whole. */
function narrowed(field: Field, allowed: readonly string[] | undefined): Field {
  if (allowed === undefined || allowed.length === 0) return field;
  const keep = <V>(entries: Readonly<Record<string, V>>): Record<string, V> =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => allowed.includes(key)));
  if (field.type === "choice") {
    const options = keep(field.options);
    return Object.keys(options).length >= 2 ? { ...field, options } : field;
  }
  if (field.type === "set") return { ...field, members: keep(field.members) };
  return field;
}

export function assemble(
  k: AnyKind,
  lib: Library,
  structure: Structure,
  details: Wave | readonly Wave[],
  answers: Readonly<Record<string, JevAnswer>>,
): Blueprint {
  const params: Record<string, Record<string, string | boolean | string[]>> = {};
  const waves: readonly Wave[] = Array.isArray(details) ? details : [details as Wave];
  for (const [qid, ref] of waves.flatMap((w) => Object.entries(w.refs))) {
    const bucket = (params[ref.slot] ??= {});
    const answer = answers[qid];
    if (ref.is === "member") {
      const list = (bucket[ref.param] ??= []) as string[];
      if (yes(answer)) list.push(ref.member);
    } else if (ref.is === "param") {
      bucket[ref.param] = valueOf(ref.field, answer, qid);
    } else if (ref.is === "fixed") {
      bucket[ref.param] = ref.value;
    }
  }
  const slots: Record<string, FilledSlot> = {};
  for (const [name, id] of Object.entries(structure)) {
    const p = lib.get(id);
    slots[name] = { use: p.id, params: params[name] ?? {} };
  }
  return blueprintOf(k.id, slots);
}

/** Lists every problem with a blueprint, so a bad answer never reaches the world document. */
export function validate(bp: Blueprint, k: AnyKind, lib: Library): string[] {
  const problems: string[] = [];
  for (const [name, s] of Object.entries(k.slots)) {
    const filled = bp.slots[name];
    if (filled === undefined) {
      if (!s.optional) problems.push(`${name} is required.`);
      continue;
    }
    let p: AnyPrimitive;
    try {
      p = lib.get(filled.use);
    } catch {
      problems.push(`${name} uses unknown primitive ${filled.use}.`);
      continue;
    }
    if (p.role !== s.role) problems.push(`${name} needs a ${s.role}, not ${p.id}.`);
    if (s.on !== undefined && bp.slots[s.on] === undefined) problems.push(`${name} is on ${s.on}, which is absent.`);
    for (const [param, field] of Object.entries(p.params)) {
      if (!isStoredValue(field, filled.params[param])) problems.push(`${name}.${param} is not a valid value.`);
    }
  }
  for (const name of Object.keys(bp.slots)) {
    if (!(name in k.slots)) problems.push(`${name} is not a slot of ${k.id}.`);
  }
  return problems;
}

function describe(chosen: Readonly<Record<string, AnyPrimitive>>): Record<string, string> {
  return Object.fromEntries(Object.entries(chosen).map(([slot, p]) => [slot, p.doc]));
}

function yes(answer: JevAnswer | undefined): boolean {
  return answer?.type === "noul" && answer.noul > 0.5;
}

function pick(answer: JevAnswer | undefined): string | undefined {
  return answer?.type === "choice" ? answer.choice : undefined;
}

/** The most probable level of a score, as Jev's docs advise, never the weighted mean. */
function topLevel(probabilities: Readonly<Record<string, number>>): number {
  let best = 0;
  let bestP = -1;
  for (const [index, p] of Object.entries(probabilities)) {
    if (p > bestP) [best, bestP] = [Number(index), p];
  }
  return best;
}

function valueOf(field: Field, answer: JevAnswer | undefined, qid: string): string | boolean {
  if (answer === undefined) throw new Error(`No answer for ${qid}.`);
  switch (field.type) {
    case "choice":
      if (answer.type === "choice") return answer.choice;
      break;
    case "scale":
      if (answer.type === "score") {
        const level = field.levels[topLevel(answer.probabilities)];
        if (level !== undefined) return level.words;
      }
      break;
    case "flag":
      if (answer.type === "noul") return answer.noul > 0.5;
      break;
    case "set":
      break;
  }
  throw new Error(`Answer for ${qid} does not fit a ${field.type}.`);
}
