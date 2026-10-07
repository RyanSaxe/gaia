// What a document patch did to the world, in world terms. The world service
// emits one event per change. Nothing listens yet: notes about changes are a
// later feature, and this stream is where they will attach.

import type { BlueprintId, Path } from "@gaia/schema";

export type WorldChange =
  | { readonly type: "appeared"; readonly item: Path; readonly region: Path }
  | { readonly type: "removed"; readonly item: Path }
  | { readonly type: "new-look"; readonly item: Path; readonly from: BlueprintId; readonly to: BlueprintId }
  | { readonly type: "declined" | "recovered"; readonly item: Path; readonly from: number; readonly to: number }
  | { readonly type: "route"; readonly link: string; readonly change: "added" | "removed" | "moved" }
  | { readonly type: "region-grew"; readonly region: Path };
