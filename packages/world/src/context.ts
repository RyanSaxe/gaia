// How much Jev sees. Every request starts with the code facts. Confidence
// decides whether to read more, and Jev decides what to read: each request
// also asks, one yes-or-no per reading, which readings would help. Unrelated
// state lowers Jev's accuracy, so nothing is added without a reason.

import type { JevAnswer, JevClient, JevQuestion } from "@gaia/schema";
import { MODEL } from "./planner.ts";

/** One piece of extra context Gaia can add to the state. */
export interface Reading {
  /** What Jev reads when it decides whether this would help. */
  readonly describe: string;
  readonly state: () => Readonly<Record<string, unknown>>;
}

export interface ContextSource {
  /** Always sent: the facts every question starts from. */
  readonly facts: Readonly<Record<string, unknown>>;
  /** Readings in escalation order: Gaia adds the first unread one when Jev asks for none. */
  readonly readings: Readonly<Record<string, Reading>>;
  /**
   * What the questions decide, in words, such as "what grows on this file's
   * patch". Jev answers each question on its own, never seeing the others, so
   * a question about readings must name the decision it would help.
   */
  readonly decides?: string;
}

/** Confidence for choices and scores; distance from an even split for a noul, which has none. */
export function certainty(a: JevAnswer): number {
  return a.type === "noul" ? Math.abs(a.noul - 0.5) * 2 : a.confidence;
}

export interface Gathered {
  readonly answers: Readonly<Record<string, JevAnswer>>;
  /** The readings in the state when each answer was accepted, shown in the inspector. */
  readonly read: Readonly<Record<string, readonly string[]>>;
  readonly requests: number;
}

export interface GatherOptions {
  readonly threshold?: number;
  readonly maxRequests?: number;
  /** False gives plain escalation: Gaia adds readings in order and never asks Jev. */
  readonly letJevChoose?: boolean;
}

const READ_PREFIX = "read:";

export async function gather(
  client: JevClient,
  questions: Readonly<Record<string, JevQuestion>>,
  source: ContextSource,
  { threshold = 0.5, maxRequests = 3, letJevChoose = true }: GatherOptions = {},
): Promise<Gathered> {
  const answers: Record<string, JevAnswer> = {};
  const read: Record<string, readonly string[]> = {};
  const done: string[] = [];
  let pending = Object.keys(questions);
  let requests = 0;

  while (pending.length > 0 && requests < maxRequests) {
    const unread = Object.keys(source.readings).filter((id) => !done.includes(id));
    const asked: Record<string, JevQuestion> = Object.fromEntries(pending.map((id) => [id, questions[id] as JevQuestion]));
    if (letJevChoose) {
      for (const id of unread) {
        asked[`${READ_PREFIX}${id}`] = {
          type: "noul",
          instructions:
            source.decides === undefined
              ? `Would this help you answer the other questions? ${source.readings[id]?.describe ?? id}`
              : `Gaia is deciding ${source.decides}. Would also reading ${source.readings[id]?.describe ?? id} make that decision clearer?`,
          criteria: { true: "It would help.", false: "It would not help." },
        };
      }
    }
    const state = { ...source.facts, ...Object.assign({}, ...done.map((id) => source.readings[id]?.state() ?? {})) };
    const response = await client.ask({ model: MODEL, state, questions: asked });
    requests++;

    const unsure: string[] = [];
    for (const id of pending) {
      const answer = response.answers[id];
      if (answer === undefined) throw new Error(`Jev returned no answer for ${id}.`);
      answers[id] = answer;
      read[id] = [...done];
      if (certainty(answer) < threshold) unsure.push(id);
    }
    if (unsure.length === 0 || unread.length === 0) break;

    // Jev picks what to read; when it asks for nothing, Gaia escalates in order.
    const wanted = unread.filter((id) => {
      const a = response.answers[`${READ_PREFIX}${id}`];
      return a?.type === "noul" && a.noul > 0.5;
    });
    done.push(...(wanted.length > 0 ? wanted : unread.slice(0, 1)));
    pending = unsure;
  }
  return { answers, read, requests };
}
