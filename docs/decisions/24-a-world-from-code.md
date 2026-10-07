# A world from real code

Gaia's own repository is the first real world. The engine reports its facts
(`project.open`); the world service lays them out: the repository is the
world, each directory an area nested in its parent's, each file a patch of
ground in its directory's area sized by its lines, each entity a building or
a landmark on a lot in its root directory's area, and each dependency Jev
would walk a trail. A bigger codebase makes a bigger world, laid out around
the code. Vitality is per file and per entity: every tree on a file's patch
takes that file's vitality, and each building or landmark its entity's.

Jev judges every look from facts and doc comments only. Until the reviewer
approves the spend, a deterministic stand-in judge answers the same
requests behind the same `JevClient` interface, so swapping in Jev is one
line. The live connector sits in the engine, off unless `GAIA_JEV=live`, with
the key in the macOS Keychain. Judging Gaia's world takes 248 requests,
about 173,000 input tokens, about $0.007 at Jev 1.13's price.

## Why

The reviewer, on this round: "Let's get to the final areas of polish and
proper integration points so we can hopefully get the engine and Jev
connectors and see what this looks like for real." They chose that a bigger
codebase makes a bigger world, baked around the person, and that vitality
exists per file and per entity. "Areas are directories and files; what you
run into are entities." No live Jev calls until the reviewer approves them.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 11.
