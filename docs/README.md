# Gaia documentation

Documentation is organized by task across setup, design concepts, development guides, and test-world references.

## Getting started

- [Connecting Jev](getting-started/connect-jev.md): configure `OPENROUTER_API_KEY`, set spend limits, locate saved answers, or run against the local OpenRouter stand-in.

## Concepts

- [Architecture](concepts/architecture.md): data flow from repository to renderer, Jev's two question paths, process and package boundaries, land division, and live commit refreshes.
- [World design](concepts/design-system.md): shared visual rules, palettes, vitality decline, terrain and travel, sound mix, journal and field sheet, and distance detail.

## Guides

- [Development](guides/development.md): running the Electron app and standalone lab, visual verification (`pnpm shots`, `pnpm probe`), adding primitives, rebuilding [sound assets](../tools/sound/README.md), and running CI checks.

## Reference

- [The showcase](reference/showcase.md): bundled synthetic codebase, fixture files, and live regeneration workflow.
- [The proving ground](reference/proving-ground.md): synthetic coverage sweep across every primitive, option, vitality level, and sky.
