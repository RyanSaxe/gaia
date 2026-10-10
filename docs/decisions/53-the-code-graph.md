# The engine reads code into one graph, and Jev judges every node of it

The engine is rebuilt from scratch rather than repaired. It parses every
language the same way, through tree-sitter grammars and their query files,
into one code graph: a node for every directory, file, definition and block,
an edge for every link between them, the engine's measures of each node, and
Jev's judgments. Jev is an API the engine calls, many requests at once, to
fill what parsing cannot know. Jev screens every node, the engine ranks them,
the world chooses what stands, and only those get the deep questions. Every
node keeps a lineage through renames and moves, so the world stays
recognizable as the code changes.

The graph's types are `CodeGraph` and its parts in
`packages/schema/src/graph.ts`, and `project.graph` returns it. The store
gains three tables for Jev's side: `calls`, `held` and `lineage`. The graph
is built in six steps beside today's `project.open`, which stays untouched
until the world moves onto the graph in step 5; step 6 removes the code
model.

## Why

The reviewer set round 1's plan aside: "I think we need to genuinely iterate
here. I dont think you are ready for a plan yet." Rounds 2 to 5 measured
what today's engine misses on seven repositories (no symbols or imports in
Go and Python, Rust imports never followed, path rules that call public
files unused) and what Jev does with real source: it found 76 of 77 tests
across five ecosystems, resolved 885 of 889 imports the rules left, and
screened all 1,294 definitions of 74 files for $0.023. The reviewer chose
Build it on round 6's plan.

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round 6
(the plan: overview, graph, parse, scores, questions, runner, calibration,
continuity and steps), with the round's notes and the thread on cyclomatic
complexity. It supersedes the reading of code in
[decision 31](31-what-jev-reads.md) once step 6 removes the code model.
