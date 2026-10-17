# The world follows the code, and only the code

Reopening a world never regenerates it, and Jev's small variations never reach the screen on their own. When the code changes, the world changes in that place: a path re-routes, a structure moves, trees lose their leaves. A world item's identity is its project-relative path, so a rename is a removal plus an addition, and generated state lives in a per-project app-data store. When the facts behind a stored Jev answer change, the answer is sticky with a margin, tuned gently, so the world keeps feeling like the person's codebase. Reopening loads the stored world and asks Jev only about stale answers, and slice 5 tunes the margin by replaying this repository's history. The first version shows no notes about changes: the world simply changes. The world service emits a typed change event for every document patch, so notes can be added later as one more listener.

## Why

Path identity and app-data storage carried over from the Jev session, round 2.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), as it stood on round 4's Agreed page, the plan for slice 1.

Replaced in part: reopening lays the world out again from the code and Jev's kept answers instead of loading a stored world, no margin keeps a stored answer, and nothing emits a change event (`docs/architecture.md`, "Continuity"). A world item is still known by its path, though the code graph gives each node a lineage through renames ([53](53-the-code-graph.md)). The legacy sweep deletes the unused margin (`reconcile`) and `WorldChange`.

A world that stands now follows a new commit in its folder as vitality alone, sent as `world.vitality`, and its shape follows at the next open (`docs/architecture.md`, "A world from code").
