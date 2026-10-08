// A local stand-in for OpenRouter's Decisions API, for proving Gaia's path
// to Jev without calling OpenRouter. It answers POST /api/alpha/decisions in
// Jev's wire format (`JevResponse` in packages/schema/src/jev.ts, as
// OpenRouter's API reference shows it): each choice from the options' words
// that appear in the request's facts plus a tie-break seeded by the request,
// each probability seeded the same way. It keeps every request it received,
// so tests can check what went out. The engine sends here only when it runs
// with GAIA_JEV_ENDPOINT set to this server's loopback address.
//
// Usage: pnpm openrouter-stand-in [--port 8787] [--delay 300] [--fail-every 0]
//   then: GAIA_JEV=live GAIA_JEV_ENDPOINT=http://127.0.0.1:8787/api/alpha/decisions pnpm dev

import { type IncomingMessage, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type JevAnswer, type JevQuestion, contentHash, rand, seedOf } from "@gaia/schema";

export const DECISIONS_PATH = "/api/alpha/decisions";

export interface StandInOptions {
  /** 0 picks a free port. */
  readonly port?: number;
  /** Milliseconds each answer takes, so progress can be seen. */
  readonly delayMs?: number;
  /** Refuses a request (HTTP 400, as OpenRouter refuses a bad one) when this returns true. */
  readonly refuse?: (body: { state: unknown; questions: Record<string, JevQuestion> }) => boolean;
}

export interface Received {
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

export interface StandIn {
  /** The URL to set as GAIA_JEV_ENDPOINT. */
  readonly endpoint: string;
  /** Every request received, in order. */
  readonly received: Received[];
  close(): Promise<void>;
}

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

/** One question's answer, from the facts' words and a seed. */
function answer(id: string, q: JevQuestion, state: unknown): JevAnswer {
  const facts = words(JSON.stringify(state));
  const r = rand(seedOf(`${contentHash(state)}:${id}`));
  const softmax = (scores: number[]): number[] => {
    const e = scores.map((s) => Math.exp(3 * s));
    const total = e.reduce((a, b) => a + b, 0);
    return e.map((x) => +(x / total).toFixed(4));
  };
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria);
    const p = softmax(keys.map((k) => [...words(`${k} ${q.criteria[k]}`)].filter((w) => facts.has(w)).length * 0.35 + r.next()));
    const best = p.indexOf(Math.max(...p));
    const choice = keys[best] as string;
    return { type: "choice", choice, probabilities: Object.fromEntries(keys.map((k, i) => [k, p[i] as number])), confidence: +((p[best] as number) * 0.9).toFixed(2) };
  }
  if (q.type === "score") {
    const p = softmax(q.criteria.map(() => r.next()));
    const score = +p.reduce((s, x, i) => s + x * i, 0).toFixed(2);
    return { type: "score", score, probabilities: Object.fromEntries(p.map((x, i) => [String(i), x])), confidence: +Math.max(...p).toFixed(2) };
  }
  return { type: "noul", noul: +(0.08 + r.next() * 0.84).toFixed(2) };
}

const read = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (text += chunk));
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });

export function startOpenRouterStandIn(options: StandInOptions = {}): Promise<StandIn> {
  const received: Received[] = [];
  let served = 0;
  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    void read(req).then(async (text) => {
      if (req.method !== "POST" || req.url !== DECISIONS_PATH) return reply(404, { error: { code: 404, message: "Resource not found" } });
      const authorization = req.headers.authorization;
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return reply(400, { error: { code: 400, message: "Invalid request parameters" } });
      }
      received.push({ authorization, body });
      if (authorization?.startsWith("Bearer ") !== true) return reply(401, { error: { code: 401, message: "Missing Authentication header" } });
      const questions = body.questions as Record<string, JevQuestion> | undefined;
      if (typeof body.model !== "string" || questions === undefined) return reply(400, { error: { code: 400, message: "Invalid request parameters" } });
      if (options.delayMs !== undefined) await new Promise((r) => setTimeout(r, options.delayMs));
      if (options.refuse?.({ state: body.state, questions }) === true) return reply(400, { error: { code: 400, message: "Invalid request parameters (refused by the stand-in)" } });
      const inputTokens = Math.ceil(text.length / 1.8);
      reply(200, {
        answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, answer(id, q, body.state)])),
        id: `gen-dec-local-${++served}`,
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe (local stand-in)",
        usage: { cost: +(inputTokens * 0.042e-6).toFixed(9), input_tokens: inputTokens, output_tokens: 12 * Object.keys(questions).length },
      });
    });
  });
  return new Promise((done) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      done({
        endpoint: `http://127.0.0.1:${port}${DECISIONS_PATH}`,
        received,
        close: () => new Promise<void>((closed) => server.close(() => closed())),
      });
    });
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flag = (name: string, fallback: number): number => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? fallback : Number(process.argv[i + 1]);
  };
  const failEvery = flag("fail-every", 0);
  let n = 0;
  const standIn = await startOpenRouterStandIn({
    port: flag("port", 8787),
    delayMs: flag("delay", 300),
    refuse: () => {
      const refused = failEvery > 0 && ++n % failEvery === 0;
      console.log(`${refused ? "refused" : "answered"} request ${failEvery > 0 ? n : ++n}`);
      return refused;
    },
  });
  console.log(`A stand-in for OpenRouter's Decisions API is answering at ${standIn.endpoint}`);
  console.log(`Start Gaia against it: GAIA_JEV=live GAIA_JEV_ENDPOINT=${standIn.endpoint} pnpm dev`);
}
