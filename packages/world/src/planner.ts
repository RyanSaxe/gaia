// Turns a kind into Jev questions and Jev answers into a blueprint.
// One request per nesting level: structure first, then the details of
// whatever the structure chose, so the details can agree with it.

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
  type Kind,
  type Library,
  isStoredValue,
  rand,
  seedOf,
  slotOrder,
  stagesOf,
} from "@gaia/schema";

export const MODEL = "typesafe/jev-1.13";

/** Who the blueprint is for and what Jev may know while deciding. */
export interface Target {
  /** Stable ID that seeds option order, such as a region path. */
  readonly id: string;
  readonly state: Readonly<Record<string, unknown>>;
}

type Ref =
  | { readonly is: "use"; readonly slot: string }
  | { readonly is: "present"; readonly slot: string }
  | { readonly is: "param"; readonly slot: string; readonly param: string; readonly field: Field }
  | { readonly is: "member"; readonly slot: string; readonly param: string; readonly member: string };

export interface Wave {
  readonly request: JevRequest;
  readonly refs: Readonly<Record<string, Ref>>;
}

/** Which primitive fills each slot, after the structure request. Absent optional slots are left out. */
export type Structure = Readonly<Record<string, string>>;

/**
 * Jev leans toward the first option of a choice. Shuffling in an order seeded
 * by the target spreads that lean evenly across the world.
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
  for (const [name, s] of Object.entries(k.slots)) {
    const context = `${k.doc} This is about its ${name}.`;
    if (s.optional) {
      questions[`${name}.present`] = {
        type: "noul",
        instructions: `${context} Should it have a ${name} (${s.role.toLowerCase()})?`,
        criteria: { true: `It has a ${name}.`, false: `It has no ${name}.` },
      };
      refs[`${name}.present`] = { is: "present", slot: name };
    }
    const candidates = shuffled(lib.forRole(s.role), `${name}.use`, target);
    if (candidates.length === 1) continue;
    questions[`${name}.use`] = {
      type: "choice",
      instructions: `${context} Which form fits it best?`,
      criteria: Object.fromEntries(candidates.map((p) => [p.id, p.doc])),
    };
    refs[`${name}.use`] = { is: "use", slot: name };
  }
  return { request: { model: MODEL, state: target.state, questions }, refs };
}

export function readStructure(k: AnyKind, lib: Library, wave: Wave, answers: Readonly<Record<string, JevAnswer>>): Structure {
  const out: Record<string, string> = {};
  for (const name of slotOrder(k)) {
    const s = k.slots[name] as AnyKind["slots"][string];
    if (s.optional && !yes(answers[`${name}.present`])) continue;
    // A slot fed by an absent slot has nothing to grow on, whatever Jev said.
    if (s.on !== undefined && !(s.on in out)) continue;
    const candidates = lib.forRole(s.role);
    const only = candidates.length === 1 ? candidates[0] : undefined;
    const chosen = only?.id ?? pick(answers[`${name}.use`]);
    if (chosen === undefined || !candidates.some((p) => p.id === chosen)) {
      throw new Error(`Jev's answer for ${name}.use is not a ${s.role} primitive.`);
    }
    out[name] = chosen;
  }
  void wave;
  return out;
}

export interface DetailOptions {
  /** Which of the kind's stages to ask; 0 when the kind has one stage. */
  readonly stage?: number;
  /** Allowed keys per field path, such as a region's native families for "palette.family". */
  readonly narrow?: Readonly<Record<string, readonly string[]>>;
  /** Values settled in earlier stages, which this stage's questions see in the state. */
  readonly earlier?: Readonly<Record<string, unknown>>;
}

export function planDetails(k: AnyKind, lib: Library, structure: Structure, target: Target, options: DetailOptions = {}): Wave {
  const { stage = 0, narrow = {}, earlier } = options;
  const inStage = new Set(stagesOf(k)[stage] ?? []);
  const questions: Record<string, JevQuestion> = {};
  const refs: Record<string, Ref> = {};
  const chosen = Object.fromEntries(Object.entries(structure).map(([slot, id]) => [slot, lib.get(id)]));
  const state = { ...target.state, decided: describe(chosen), ...(earlier === undefined ? {} : { earlier }) };
  for (const [slotName, p] of Object.entries(chosen)) {
    if (!inStage.has(slotName)) continue;
    const context = `${k.doc} Its ${slotName} is ${p.doc.replace(/\.$/, "").toLowerCase()}.`;
    for (const [param, raw] of Object.entries(p.params)) {
      const id = `${slotName}.${param}`;
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

/** A choice or set limited to the allowed keys; an empty or missing list leaves it whole. */
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
    }
  }
  const slots: Record<string, FilledSlot> = {};
  for (const [name, id] of Object.entries(structure)) {
    const p = lib.get(id);
    slots[name] = { use: p.id, params: params[name] ?? {} };
  }
  return blueprintOf(k.id, slots);
}

/** Every problem with a blueprint, so a bad answer never reaches the document. */
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

/** The option for a file that no component stands for; it enriches the region's ground instead. */
export const GROUND = "ground";

/**
 * Jev decides which kind stands for a file, so the mapping from code to world
 * is a judgment, not a rule table. Kinds describe themselves in `represents`.
 */
export function planRepresentation(kinds: readonly Kind<"file">[], target: Target): Wave {
  const options = shuffled(
    [
      ...kinds.map((k) => [k.id, `${k.doc} Suits: ${k.represents}`] as const),
      [GROUND, "No single thing stands for it; it enriches the ground of its region."] as const,
    ],
    "represent",
    target,
  );
  return {
    request: {
      model: MODEL,
      state: target.state,
      questions: {
        represent: {
          type: "choice",
          instructions: "Which part of the world should stand for this file?",
          criteria: Object.fromEntries(options),
        },
      },
    },
    refs: {},
  };
}
