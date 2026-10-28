# Working on Gaia

Gaia turns a codebase into a world you can walk through. The Rust engine
analyzes code, and Jev answers typed questions. Pure packages turn the answers
into terrain and geometry, and Electron renders the result.

Read [architecture](docs/architecture.md) before changing boundaries or data
flow, and [design](docs/design-system.md) before changing visuals or interaction.
[Development](docs/development.md) covers commands, fixtures and verification.

## Contracts

- `packages/schema/src/engine.ts` and `engine/src/rpc.rs` define the engine's
  newline-delimited JSON-RPC protocol.
- `app/world-service/protocol.ts` defines messages between the app, world
  service and renderer. Update its documentation with a protocol change.
- A package's `src/index.ts` is its public interface. Use package entry points,
  including in tests. `eslint.config.js` enforces imports and purity.
- Kinds declare roles, and primitives implement them. Jev chooses from closed,
  instructed fields. Numeric scales use word levels, and code supplies
  free numbers, coordinates and measurements.
- Primitives, kinds, world, realize and terrain are pure: no unseeded
  randomness, clock, DOM, filesystem or Three.js. Pass time and seeds as data.
- Primitives write all vitality channels and choose palette swatches. Shared
  rendering code owns shaders. A vitality change must not rebuild geometry.
- Keep primitives at `@1` and edit them in place while complete world documents
  are not persisted.

## Visual requirements

- Keep silhouettes and detail stable as the person moves. Verify changes to
  culling, streaming, shadows or detail transitions with the walking probes.
- Preserve immersion: no floating labels, click rings or status overlays in
  the world. Reading and navigation belong to the journal, map and paper UI.
- Build foliage density from overlapping leaves and branches. Never add a
  dark inner ball or body to a crown, bush or fir frond.
- Match the painterly light and natural forms described in the design guide.
  Check components both healthy and ruined, by day and at night.

## Development

- Work in an isolated branch and worktree. Run `pnpm install` in that worktree.
  Keep unrelated changes intact and stop only processes you started.
- Obtain explicit user approval before sending requests to OpenRouter. Verify
  the live connector against the local stand-in in the development guide.
- Extend shared contract tests when adding a primitive or kind. Tests should
  exercise public behavior. Do not use snapshot assertions.
- Bake expensive fixtures once per test file and clone them for mutations.
  Give slow cases explicit timeouts with a reason.
- Run `pnpm check`, `cargo test` and `cargo clippy --all-targets -- -D warnings`
  for a broad change. Use rustup's toolchain. Commit through the pre-commit
  hook and fix failures instead of skipping checks.
- For visual changes, use Gaia's world and the proving ground. Inspect the real
  app, capture useful evidence, and compare performance under similar load.

## Documentation

Describe current behavior and useful design rationale. Update affected guides
with the implementation. Keep constants, exhaustive options and schemas in
code, and link to their definitions.

Keep temporary task state, session rosters, conversation quotes, round numbers,
and agent handoffs outside the repository. Comments should explain an invariant,
constraint or reason a reader needs to maintain the code.
