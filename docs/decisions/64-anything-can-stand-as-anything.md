# Anything can stand as anything, by its importance

Every entity, file and definition stands in the world as one thing, and Jev
chooses what from every form: flowers, a stone, a bush, a tree, a building or
a landmark. Importance decides what is offered. Each size of thing has a
range of rank by importance among the world's own entities, files and
definitions together, from 0 for the least important to 1 for the most, and
a thing is offered every form whose range holds its rank. The ranges are wide
and overlap, smallest first: flowers 0 to 0.55, stones 0 to 0.75, bushes 0.15
to 0.92, trees 0.35 to 1, buildings 0.97 to 1 and landmarks 0.98 to 1
(`SIZES` in `app/renderer/terrain/looks.ts`). On Gaia's own world 95% of
things are offered two to four sizes, those ranked 0.92 to 0.97 the trees
alone, and the most important 2% a tree, a building or a landmark. Jev picks
a building 81% of the times it is offered one, so the building range's width
sets how many there are: from 0.90 it raised 217 of Gaia's 2,702 things to
buildings (8%), and the range starts at 0.97 to keep them to about 3%. A rank
is a share of the world's own things, so each
form is offered to the same share in a world of any size. The ranges are
code, read through the same rule that offers a waterwheel only beside running
water (`meets`); Jev's importance places each thing, and nothing else limits
or overrides its pick.

Each form's words are its character, its size and how rare it is, never a
kind of code. Importance decides what is offered, and character decides
Jev's pick among it. What a thing stands as is asked once the understanding
pass has judged how much each matters, with its importance in the request.

A building or a landmark for a file or a definition is composed part by part
as an entity's is. It stands on its file's patch: a file's at the patch's
heart, a definition's on its own plot. The land does not change for it; the
file's other definitions keep off it. A code block never stands as a
building.

This supersedes decision 22's "a building stands for an entity, not a file;
plants stay files", decision 25's "a landmark stands for an entity, as a
building does", and the entity's building-or-landmark question.

## Why

The reviewer, on finding that only packages could be buildings or landmarks:
"I want to be insanely clear. ANYTHING CAN BE ANYTHING on the basis of
importance. Now, a block should probably never be a building, fine. But the
most important definition in the whole repo ... why would we not want that
to be able to be a landmark?????? Sounds like we made a design where all the
nuggets of a codebase are like rocks. Gaia was supposed to be able to show
things at a lower level and be fun to explore. I am SO DISAPPOINTED." Of 2,400
definitions, 391 stood as stones and none as a building or a landmark, and the
files stood as nothing but ground.

On scarcity: "Now the whole world shouldnt become buildings. they should be
scarcer ... so Jev should either understand that or they become available at
certain levels of importance and jev understands that." On the ranges: "Make
components have like a range. Like flowers -> rocks -> trees -> buildings ->
landmarks or something. But the ranges should be wide and overlap so very
often jev can select between like [tree, building, landmark] ... This way it
never makes something super important or big a flower lol. But we dont end
up with all trees or like no landmarks", and on their order, "you can think
about this really in terms of size". On the words: "Please aim for vibes and
vibes only."

## Settled

Pair session `8f779d65-51f4-4637-9ddf-1af6c08cfa7a`, in the thread
`6b17d0ad`. It supersedes part of [decision 22](22-structures-stand-for-entities.md)
and of [decision 25](25-entities-throughout.md), and extends
[decision 61](61-every-tree-is-a-definition-jev-chose.md) to every level.
