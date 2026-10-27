# gaia

## Wander your codebase.

Gaia turns a codebase into a world you walk through. Folders become lands,
and files and functions stand on them as generated entities based on their
determined quality and importance.

https://github.com/user-attachments/assets/55116856-4b34-4a41-861d-c1e5e2b5b237

## Get started

You need Node 26, pnpm 10, Git, curl, stable Rust from rustup, and an
[OpenRouter key](docs/connect-jev.md) for Jev, which judges your code.

Install dependencies, set `OPENROUTER_API_KEY` to your key and `GAIA_JEV` to
`live` in your environment, then start Gaia:

```sh
pnpm install
pnpm dev
```

Choose a folder on your computer or a public repository on GitHub, and walk in!
It takes a minute or two to generate your world.

Judging a 100k LOC codebase and composing every thing in its world costs
roughly seventy cents to a dollar; composing Gaia's own 2,700 things, from
68k lines, cost about thirty-five cents of that. Updating a 10–20k LOC personal
project should cost under ten cents.

Gaia estimates the cost before sending live requests and reuses saved answers
on later runs.

No key yet? Choose the showcase world from Gaia's start page to get a feel for it.

## Walk around

Tap a code object to open its journal page: its code, how healthy it is,
and a painting of it. Press M for the journal's map of the whole land.
Choose a spot on the map, then tap its mark to travel there.

<p>
  <img src="docs/images/journal.jpg" width="49%" alt="The journal open at a function's page: a painting of its rotted maple beside its code and scores">
  <img src="docs/images/map.jpg" width="49%" alt="The journal open at the map of the whole world, a pencilled route leading to the ruin">
</p>

## How it works

![Gaia's data flow from repository through code analysis and world design to the renderer](docs/images/architecture-data-flow.svg)

Jev handles two separate tasks: analyzing code for scores and links, and
answering typed design questions that choose the world's parts and
appearance. The [architecture guide](docs/architecture.md) explains the data
and package boundaries.

After a commit, Gaia updates vitality for things that still stand. If the
layout changes, the current world keeps its shape until you reopen it.

![A village of timber houses by a brook in late afternoon light](docs/images/world.jpg)

## Documentation

- [Connecting Jev](docs/connect-jev.md) covers the key, the cost and spend limits.
- [Architecture](docs/architecture.md) shows how the engine, the world service and the renderer fit together.
- [World design](docs/design-system.md) describes shared visual and interaction rules.
- [Development](docs/development.md) covers commands, test worlds and verification.
- [The showcase](docs/showcase.md) and [the proving ground](docs/proving-ground.md) are the two made-up codebases Gaia is filmed and tested in.
