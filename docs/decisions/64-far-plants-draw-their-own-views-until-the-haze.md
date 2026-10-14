# Far plants draw their own views until the haze, then a shared look

A plant that stands for something of the code (a tree, or a bush, stone or
drift of flowers standing for a definition) draws its far card from its own
views: the four nearest the eye, baked from its own build at the size its
crown covers on screen, into one atlas every card reads.
Past the haze, once its crown is under a quarter of the size its plant turns
far at and it stands more than 550 m away, it draws its build's shared card
instead, baked once per install at that quarter size. Copies that stand for
nothing (the scatter between things, the wild past the land) keep their
builds' shared cards. Baked views are kept in the browser's far store, so a
later visit reads them back instead of baking.

## Why

Round 20 chose to stream every far plant's own views, so every one of Jev's
answers shows however far away a plant stands, with memory fixed per device.
Round 23 measured that design on a prototype: 687 MB against today's 470 MB
on Gaia, 108 s of baking on every open, and 243 to 408 copies a second
needing new views while walking. The same round measured where the
difference stops showing: at a crown of 32 px, 548 m and more away, even a
fir's card in place of a willow's changed no 64-pixel block by more than 0.1
of a level of 255. Drawing own views only until there costs about a third of
today's memory on Gaia.

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round
23, on the plants page: the reviewer chose "Own, then shared" for far
plants. It narrows round 20's choice of "Views streamed".
