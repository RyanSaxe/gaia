# A big file is cut so each piece holds what fits, and nothing Jev reads is trimmed

A file too long for one request is cut at its top-level definitions, each
piece holding as much source and as many questions as fit. Only the first
piece makes room for the questions about the whole file, since only it
asks them. The engine never trims what Jev reads to save cost.

## Why

Every piece used to reserve room for the whole-file questions, so a big
file's pieces held about one definition each and sent the outline and the
shared context again every time: marks.ts went out as 189 requests. Fixing
the cut took Gaia's file requests from 1,405 to 798. Trimming context on
top of that saved only 2 to 5% more, and would have removed something Jev
reads. The reviewer had asked to trim "we need to be careful about it,
but I think we can do it well", and chose "Fix the cut only".

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round 14, on the trim page, with the
thread on how a file is cut (`986daf99`).
