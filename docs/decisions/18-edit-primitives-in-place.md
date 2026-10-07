# Edit primitives in place until release

Until Gaia stores worlds for real people, a change to a primitive's look or
parameters edits it in place and keeps its version at `@1`. Primitive IDs
still carry a version, so the rule can switch on without changing any
interface: once worlds are stored, each such change becomes a new version, and
stored worlds keep the old one until a person migrates.

## Why

The reviewer: "we fundamentally are not releasing this for a while. We will
iterate on look and vibe A LOT … feels like versioning is preemptive and maybe
we should assume that is how we WILL behave, but for now that's not needed."
No world is stored before slice 4, so a version bump protects nothing yet and
only adds noise to every look change.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 7, in
the thread on the Grass, water and clouds page.
