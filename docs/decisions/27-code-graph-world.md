# Code becomes a graph, and the graph becomes land

A world is laid out from one explicit graph of the code: directories hold
directories and files, files hold their functions, classes and exported
symbols, entities are rooted at directories, and imports and dependencies
join them. Directories are regions of land built of their subdirectories and
files, sized by their code, nested the way the tree nests, with organic
borders and no empty common ground between them. A file is a patch of
ground, and its finer entities, down to its functions, stand on it as things
a person can walk up to and read. The terrain's regions follow the same
cells, so an area's land, its cover and its name always agree.

The engine gives structure and sizes; Jev gives meaning. Wherever a
reasonable person could choose differently, Jev chooses: what a function or
a class stands as, whether an area holds water and why (the option's words
are the reason, stored with the choice), each area's land, what grows on a
patch, and which dependencies become trails. A fixed table of meanings is
not the engine.

## Why

The reviewer chose "a file is a patch of ground", and: "Think of it like
directories are regions, built of subdirectories and files. The engine can
create a deterministic (and noisy so it's not so blocky) layout on that
basis. And it can use file size and such to figure it all out. Then inside
those areas of land, we have entities. These can be even like functions!!!!!
We can get quite low here. The main problem to solve is code -> graph ->
representing that graph as a world!!" On round 11's meaning map: "Overall
this is just a bit too prescriptive. Good start but I think this will lead
to a worse engine." On water: "I think it's flexible. Water isn't a flow.
It's also not definitively land. My gut says it's part of the land but it
exists for a reason. The question is when and how."

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 12.
