# Rivers follow the land, as one network

An area Jev gives a brook or a trickle no longer holds its own short stream
along a compass line. Its water rises where it runs longest through the
area, reaches back across the area the way it sets off, and runs downhill
over the whole land, through other areas too. It ends at the land's edge,
at a pond, or at the bottom of a basin, where it sinks away, or it joins
another river, which widens below the join. The valley is carved along the
whole course with the cross-section and winding Jev chose for the area. A
valley's run and fall, which come with the land Jev picks, no longer decide
where its water goes. A dry valley keeps its land's run. On the map, a
river that joins another runs into it as one water.

## Why

The reviewer, on round 22's rivers page (thread `7f1a1b23`): "Right now it
looks like you can only draw vertical and horizontal lines on the map, it's
one of the few things that doesnt feel realistic about the world." A
valley's run came with its land: a Brook valley always ran north–south and
a Meandering vale east–west, and each stream stopped where its area ended.
Round 23's rivers page put three designs side by side: each valley tilted
up to 45° by a seeded draw, a hybrid that kept each land's valley inside
its area and followed the land past it, and a drainage network. The
reviewer picked the drainage network. In the page's thread (`67b6a23b`)
they asked how joining works and how the map keeps a join from showing as
overlapping rivers, which the map now draws as one water.

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round
23, on the rivers page and in its threads (`7f1a1b23`, `67b6a23b`).

Round 7 of the world-polish session replaced the one cross-section along a whole course: each valley wall now changes in grade and width along its river, and the floor ends at the spring (`wallsAlong` in `packages/terrain/src/rivers.ts`).

Replaced in part: Jev composes each land through the biome kind, choosing its relief and that relief's parameters, instead of picking a whole land (`docs/architecture.md`, "A world from code").
