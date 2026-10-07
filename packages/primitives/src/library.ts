// The primitive manifest. Adding a primitive is one file plus one line here;
// the contract tests then cover it automatically.

import type { AnyPrimitive } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "./flora.ts";
import { RELIEF_PRIMITIVES } from "./relief.ts";
import { WORLD_PRIMITIVES } from "./world.ts";

export const PRIMITIVES: readonly AnyPrimitive[] = [...FLORA_PRIMITIVES, ...RELIEF_PRIMITIVES, ...WORLD_PRIMITIVES];
