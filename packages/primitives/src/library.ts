// The primitive manifest. Adding a primitive is one file plus one line here;
// the contract tests then cover it automatically.

import type { AnyPrimitive } from "@gaia/schema";
import { FLORA_PRIMITIVES } from "./flora.ts";
import { RELIEF_PRIMITIVES } from "./relief.ts";
import { WORLD_PRIMITIVES } from "./world.ts";
import { BIOME_PRIMITIVES } from "./biome.ts";
import { STRUCTURE_PRIMITIVES } from "./structure.ts";
import { ROCK_PRIMITIVES } from "./rock.ts";
import { WILDFLOWER_PRIMITIVES } from "./wildflowers.ts";
import { ROUTE_PRIMITIVES } from "./route.ts";
import { LANDMARK_PRIMITIVES } from "./landmark.ts";

export const PRIMITIVES: readonly AnyPrimitive[] = [...FLORA_PRIMITIVES, ...RELIEF_PRIMITIVES, ...WORLD_PRIMITIVES, ...BIOME_PRIMITIVES, ...STRUCTURE_PRIMITIVES, ...ROCK_PRIMITIVES, ...WILDFLOWER_PRIMITIVES, ...ROUTE_PRIMITIVES, ...LANDMARK_PRIMITIVES];
