// Jev's wire format on OpenRouter's Decisions API, and the client contract.
// The real client lives in the Rust engine, which holds the key.

export type JevQuestion =
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] }
  | {
      readonly type: "noul";
      readonly instructions: string;
      readonly criteria?: { readonly true: string; readonly false: string };
    };

export interface JevRequest {
  readonly model: string;
  readonly state: unknown;
  readonly questions: Readonly<Record<string, JevQuestion>>;
}

export type JevAnswer =
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | {
      readonly type: "score";
      readonly score: number;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | { readonly type: "noul"; readonly noul: number };

export interface JevResponse {
  readonly answers: Readonly<Record<string, JevAnswer>>;
  /** The exact build that answered, such as "typesafe/jev-1.13-20260917". */
  readonly model: string;
  readonly costUsd: number;
  readonly ms: number;
}

export interface JevClient {
  ask(request: JevRequest): Promise<JevResponse>;
}
