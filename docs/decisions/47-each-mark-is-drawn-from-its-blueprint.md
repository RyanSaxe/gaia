# Each mark on the map is drawn from its blueprint

A building's or landmark's mark on the field map and the minimap is drawn
from its own composition, never chosen by its name. The shape comes from
the plan its footprint realized: every mass, back to front, so any massing,
storeys or attachment draws with no new code. Each slot's primitive is inked
by its entry in a table keyed by primitive id (`INKS` in `marks.ts`), the
palette gives the washes, and features are drawn by their own entries where
their primitives stand them. One wear rule runs on every mass, the same as
the building's ruin in the world. A landmark is drawn from its primitive's
words: a tower's plan, profile, galleries and crown, the stones'
arrangement, a great tree's form and age. A contract test fails when a
structure or landmark primitive has no entry in the table.

The stood world hands the map each building's realized plan, blueprint and
palette, and each landmark's blueprint and palette, so buildings Jev
composes later draw the same way.

## Why

The first marks were five hand drawings picked by searching a kind's name
for "storybook", "mill", "archive", "croft" or "thatch"; any other building
fell back to a generic cottage. The reviewer asked whether buildings were
composable blocks and wanted the map "fully extensible and not going to end
up with large issues as we add components". He agreed to draw from the
blueprint, with a contract test so a new primitive cannot be forgotten, and
asked to see a sampler of every massing, roof form, covering and feature at
three healths before it goes in.

## Settled

Pair session `paper` (`18bde2d6-ccdd-49fd-a23a-d1663f7c6c3e`), round 4's
thread on drawing from blueprints and round 5's Agreed (Lettering, marks
and water). The sampler is round 5's marks page. It refines the marks of
[decision 42](42-the-field-map-shows-health.md).
