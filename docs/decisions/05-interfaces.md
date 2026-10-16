# Core interfaces

The interfaces in the mock repository (round 2's Core interfaces page) are the base for v3: the type builder, ports with vitality channels, the primitive and kind contracts, the world document, the two-request planner, Jev choosing which kind represents a file, the answer rules and the engine protocol. The flora lab added three changes: `Part` gains a `tint` channel for hue variety, the crown is required for flora, and a slot fed by an absent slot is dropped and rejected.

## Why

The reviewer called the design "a really nice composable design". The tint channel and the required crown were recommendations on round 2's Component mocks page that drew no objecting note.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), as it stood on round 4's Agreed page, the plan for slice 1.

Replaced in part: [61](61-every-tree-is-a-definition-jev-chose.md) and [64](64-anything-can-stand-as-anything.md). Jev chooses what each entity, file and definition stands as, not which kind represents a file, and the app's world document is the world service's `WorldDocument` (`app/world-service/protocol.ts`). The legacy sweep deletes `planRepresentation` and the first model in `packages/schema/src/document.ts`.
