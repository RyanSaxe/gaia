# Gaia

Gaia turns a codebase into a world a person wanders through. Jev fills typed
schemas from code facts; primitives turn the filled schemas into geometry;
vitality shows code health everywhere. Read `docs/architecture.md` before
changing structure and `docs/design-system.md` before changing how anything
looks.

## Rules

- Primitives, kinds, the world package, the realizer and terrain are pure: no
  `Math.random`, no clock, no DOM, no files, no Three.js. Lint enforces it.
- Every field Jev answers is a closed set with an instruction. Scale levels are
  words. Free text, free numbers and coordinates come from code, never Jev.
- Primitives write vitality channels and pick a swatch. They never ship GLSL.
- Kinds name roles, never primitives, so Jev can choose any primitive that fits.
- Until Gaia stores worlds for real people, change primitives in place and
  keep them at `@1`: look and feel will change a lot first. Once worlds are
  stored, a change to a primitive's look or parameters becomes a new version
  (`branching@2`), and stored worlds keep the old one until a person migrates.
- The visual bar is v1's components and Breath of the Wild. Effects stay subtle.

## Adding a primitive

1. Declare it in the file for its kind (`flora.ts`, `relief.ts`, `biome.ts` or
   `world.ts` in `packages/primitives/src/`), with its geometry in `geometry/`.
   `build` is pure and writes every vitality channel.
2. Add it to `PRIMITIVES` in `packages/primitives/src/library.ts`. The contract
   tests then check its doc, determinism, channel ranges, triangle budget and
   vitality response.
3. Open the lab with `pnpm dev`, use the primitive at vitality 1, 0.5 and 0.1,
   and watch it move in the wind. Run `pnpm shots` and attach the images to the
   pull request.

## Tests

- Test behavior through a package's entry point (`@gaia/<name>`), never its
  internals. Lint enforces this.
- Prefer extending a contract test, which covers every primitive or kind at
  once, over writing a test for one of them.
- Name each test for the behavior it protects. Delete a test that only
  restates the implementation.
- Never use snapshot assertions. Lint enforces this.

## Checks

`pnpm check` runs the type checker, the lint rules and the tests. `cargo test`
and `cargo clippy -- -D warnings` cover the engine. The pre-commit hook and CI
run all of them. Fix a failing check; never silence it.

## Docs

Update `docs/architecture.md` or `docs/design-system.md` in the same commit as
a change that alters them. Record each decision settled in a pair session in
`docs/decisions/`, with a link to its round.
