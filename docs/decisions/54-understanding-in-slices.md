# The engine understands a codebase in slices, and the world asks for each

The engine asks Jev about the code graph through four methods:
`understand.plan` builds every request and says what is already answered,
`understand.next` sends what is ready and returns the nodes that settled,
`understand.deepen` queues deep questions for the nodes the world chooses
to stand, and `understand.ask` answers one follow-up at once.
`project.graph` with `judged: true` returns the graph with every held
answer. The world service drives the slices, so the engine's single request
loop stays free between them and the waiting screen keeps drawing.

## Why

Round 6's plan (runner page) put Jev's calls in the engine, sending every
request as soon as its waits are met, many at once. The reviewer asked that
answers arrive progressively, "so that we can continually draw the map",
and that the world decide how many things stand rather than a fixed cap.

## Settled

Pair session `engine-jev` (`d7b14fc0-f746-4268-a67b-ca7056c75499`), round 6
(the runner and questions pages), approved with Build it; the alignment
*Answers arrive progressively, so the map keeps drawing*.
