# Buildings stand for entities, and fall to ruin

A building stands for an entity, not a file: a package, crate, service, app
or module with a name, a boundary, a public surface, things that depend on
it and a health of its own. Plants stay files. The engine will find
entities from manifests, binary and server entry points, and directories
with an index file, and report each with its files' facts summed
(`EntityFacts`). Jev decides which entities become buildings and which
building suits each, by its judgment; the kind binds only numbers from the
facts.

A building may carry a feature that perturbs the usual cottage and says
what the entity does: a mill's waterwheel that turns while the code is
healthy and stops as it fails, or an archive's tower that rises taller the
more depends on it, with lamplit windows at night.

A failing building does not just fade. It falls to ruin through vitality
channels on the pieces it already has: roofs rot through over bare
rafters, walls hole and timbers topple at one weak corner, the chimney
falls, the door hangs ajar, windows break or are boarded, rubble gathers,
ivy climbs and rank grass grows tall. Each step reads from 40 m.

## Why

The reviewer, on the cottage: "I like the idea of having particular
structures that can perturb and feel very unique. And they need to
represent entities (not files)." On decline: "a structure will usually
represent something important. Getting it to be broken down. Covered in
moss. Dead looking. I mean this is a big opportunity. Vitality is not just
about 'barren'."

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 9's
review of the cottage, built in round 10.

## Superseded

Partly superseded by [64](64-anything-can-stand-as-anything.md): a building stands for any entity, file or definition whose importance is offered one, never only an entity, and plants stand for definitions, files and entities alike. The rest stands: a building's feature, and its ruin through its channels.

Replaced in part: only a manifest makes an entity (`docs/architecture.md`, "The schema"), and Jev composes each building part by part instead of choosing a whole one.
