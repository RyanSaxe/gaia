# A proving ground with everything in it

Every session tests its work in a second world as well as in Gaia's own: the
proving ground (`?world=proving`, `GAIA_PROJECT=proving`), built from a
made-up codebase whose plan puts every feature somewhere in it. It has every
building and landmark the judge can choose, each thriving, tired and in
ruin; a whole area in ruin beside thriving ones; streams crossed on
footbridges and stepping stones; cairns, ponds, a tiny area and nesting six
deep; and every land, water, character, tree, form and trail look.

- The world is made the way any codebase's is: a code model in the engine's
  shape and the choices Jev would make about it, both fixtures written by
  `pnpm proving`, laid out with `layoutWorld`, stood with `standWorld` and
  baked. Health comes from the facts (failing tests, errors, nesting, lint,
  TODOs, unused code), never from a number set by hand.
- Its choices are fixed rather than judged, so a change to how Jev is asked
  never takes a feature away. A test fails when a new option is not in the
  plan, or when the world loses its crossings or cairns.
- A tour (`__lab.terrain.tour(name)`) walks to each feature in any world, so
  every session can take the same shots.

## Why

The reviewer, after round 16: "one thing thats really hard to test right now
are things the current world doesnt contain. Like three is no building or
real area with super low vitality. I dont see any bridges. Stuff like that."

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 17.
