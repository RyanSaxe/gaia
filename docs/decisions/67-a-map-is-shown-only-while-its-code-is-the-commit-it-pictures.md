# A map is shown only while its code is the commit it pictures

The start and the wait show a world's map only while the world's code is
still the commit the map was drawn from. The world service keeps each
picture of a world's field map with the commit that world was read from,
and offers it on the start only while the folder's checked-out commit is
the same one (`project.commit`). The land the wait divides says which
commit it was read from, so the wait folds away a picture of another
commit. A place on GitHub can have one once its fetch has moved it on. A
world read from disk keeps no picture, because nothing tells when its code
changed.

A world whose code has changed lies on the start as a card of the wait's
bare sheet, in the sheet's shape, and rises into the sheet without
changing. The wait then draws the new map on bare paper at its usual pace,
so a person watches their world drawn as it now is. A map that is still
current stays as the sheet's paint. The washes go under it unseen, never
as paper over it, until the relief comes in over it once the world stands.

## Why

When a world was chosen on the start, its last picture became the wait's
sheet, even after its code had moved on. On develop's first opening of
Gaia, the reviewer watched main's map of Gaia while develop's was drawn
beneath it. Each wash showed for a moment as a pale square of new paper
over the old picture, then went under it. The reviewer asked for
"redrawing the map. The start screen, for example, should not have a map
if it needs to be redrawn. This way I dont have a super stale map of gaia.
I would like to actually be able to watch gaia get drawn actually and have
that be proper."

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round
24, as the proposal `stale-map-never-shown`, built and shown in round 25
on "Watching Gaia drawn fresh". It refines
[decision 51](51-the-start-is-the-map-table-in-3d.md): a world's card shows
its picture only while that picture is its map.

World polish round 2 replaced the current map that stays as the sheet's paint: it fades to bare paper once the land is divided and is drawn again, and the land stage carries no commit.

World polish round 5 replaced the map on the card: a world's card is a painting of where the person last stood still, offered whatever the commit, with a tally of the commits since they last opened it.
