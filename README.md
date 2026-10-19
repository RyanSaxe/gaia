# gaia

## Wander your codebase.

Gaia turns a codebase into a world you walk through. Folders become lands,
and files and functions stand on them as trees, houses and towers, the
biggest for the code that matters most. Healthy code grows lush and whole;
tangled, failing code withers into ruin. Fix it and commit, and you watch the
land around it come back to life.

**[The film goes here]**

![A village of timber houses by a brook in late afternoon light](docs/images/world.jpg)

## Get started

You need Node 26, pnpm 10, Rust from rustup, and an
[OpenRouter key](docs/connect-jev.md) for Jev, the AI model that judges your
code. Gaia reads the key from the macOS Keychain, so judging your own code
needs a Mac for now.

```sh
pnpm install
security add-generic-password -s gaia-openrouter -a openrouter -w   # paste your OpenRouter key
GAIA_JEV=live pnpm dev
```

Gaia opens on a map table. Choose a folder on your computer or a public
repository on GitHub, and walk in: click the ground to walk there, and drag
to look around. The first visit takes about a minute while Jev judges it.

No key yet? Walk a world that comes already judged:

```sh
GAIA_PROJECT=showcase pnpm dev
```

## Walk around

Tap anything to open the journal at its page: its code, how healthy it is,
and a painting of it. Press M for the journal's map of the whole land, and
tap anywhere on it to travel there.

<p>
  <img src="docs/images/journal.jpg" width="49%" alt="The journal open at a function's page: a painting of its rotted maple beside its code and scores">
  <img src="docs/images/map.jpg" width="49%" alt="The journal open at the map of the whole world, a pencilled route leading to the ruin">
</p>

## How it works

<img src="docs/images/how-it-works.svg" alt="Your code goes to Gaia's engine, which reads every folder, file, function and link. Jev, through OpenRouter, judges how much each part matters, its health and what it becomes, and every answer is kept. The world is laid out from the code with health in every leaf, and you walk it, read it and fix it. Committing a fix goes back to the engine, and the open world heals in place.">

Gaia's engine reads your code into a graph of folders, files, functions and
the links between them. Jev judges each part, and Gaia lays out the land from
the code and stands every part on it. Jev's answers are kept, so reopening a
world only asks about what changed, and a commit heals an open world in place.

## Documentation

- [Connecting Jev](docs/connect-jev.md) covers the key, the cost and spend limits.
- [Architecture](docs/architecture.md) shows how the engine, the world service and the renderer fit together.
- [Design system](docs/design-system.md) describes how the world looks and why.
- [The showcase](docs/showcase.md) and [the proving ground](docs/proving-ground.md) are the two made-up codebases Gaia is filmed and tested in.
