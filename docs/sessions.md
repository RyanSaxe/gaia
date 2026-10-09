# Working as four sessions

Four sessions build Gaia at once. Each is its own pair session with the
reviewer, works in its own worktree and branch, and merges into `main` in
small pieces. This page says who owns what, how work reaches `main`, and how
each worktree keeps the current world to iterate on.

| Session | Worktree | Branch | Lab port |
| --- | --- | --- | --- |
| Components | `~/worktrees/gaia-v3/components` | `components` | 5181 |
| Paper and wayfinding | `~/worktrees/gaia-v3/paper` | `paper` | 5182 |
| Engine and Jev | `~/worktrees/gaia-v3/engine-jev` | `engine-jev` | 5183 |
| World | `~/worktrees/gaia-v3/world` | `world` | 5184 |

Port 5180 is the reviewer's phone link. It serves `main` from
`~/Projects/gaia-v3`, and the World session restarts it after merges. A
session can serve its own branch on its own port with
`pnpm lab:serve --port N`, so the reviewer can see work before it merges.

## Who owns what

A session changes only what it owns, plus whatever a contract change forces.
When work needs a change in another session's area, it says so on its page
and leaves the change to that session.

- **Components:** what stands in the world and how it looks and behaves.
  - Flora, bushes, flowers, rocks, buildings, landmarks and their vitality.
  - `packages/primitives`, `packages/kinds` and `packages/realize`, except the wind field (below).
  - The plant, bark and building shaders in `packages/render` (`plant.ts`, `instances.ts`, `smoke.ts`, `sway.ts`).
  - The Components tab (`app/renderer/flora`, `app/renderer/world`).
- **Paper and wayfinding:** everything the person reads.
  - The field map, the minimap, selection and the sketch page.
  - The waiting screen, the start page and the mark.
  - `app/renderer/immersive`, `wait`, `start` and `brand`, and their styles in `app/renderer/lab.css`.
- **Engine and Jev:** reading code and asking Jev.
  - `engine/` and the facts in `packages/schema/src/facts.ts`.
  - Request planning and judging in `packages/world` (`planWorldRequests`, `judgeWorld`, the stand-in, the designs, `outline.ts`, `judging.ts`, `context.ts`, `planner.ts`).
  - The options' wording in `app/renderer/terrain/looks.ts`.
  - `app/world-service/{open-world,jev}.ts`, the Jev tools, and the fixtures `gaia.json` and `gaia-jev.json`.
- **World:** the land and everything that holds the rest together.
  - Layout (`land.ts`, `layoutWorld`, `landOf`, `graph.ts`) and vitality's pooling in `packages/world`.
  - `packages/terrain`, water, trails and walking.
  - The terrain lab and stand (`app/renderer/terrain`, except `looks.ts`'s wording).
  - Light, sky and the wind field (`light.ts`, `shadow.ts`, `clearings.ts`, `wind-field.ts` in `packages/render`; `day.ts`, `sky.ts`, `world.ts`, `wind-field.ts` in `packages/realize`).
  - The app shell (`app/main`, `app/preload`, `app/world-service/index.ts`).
  - Smoothness, the proving ground, CI, `AGENTS.md`, the README and merging to `main`.

**Wind is split by what it is.**
- The field is World's: where and when it blows, its direction, gust bands and overall strength (`wind-field.ts` in `packages/realize` and `packages/render`: `WIND_FIELD`, `gustAt` and `WIND_FIELD_GLSL`).
- How each plant answers it is Components': its stiffness, its levels and their lean, swing and flutter, per kind of plant (`sway.ts` in `packages/realize` and `packages/render`: `WIND`'s levels, `swayAt`, `jointPhase`, `WindState` and `SWAY_GLSL`, and the plant shader's `applyWind`).
- So round 16's overreacting flowers and willows are a Components fix. A world that is too windy everywhere would be a World fix.
- `WIND` (the field's numbers with the levels) and `WIND_GLSL` (both chunks) put the two together for the plant shader, so each session edits only its own file.

**Where a trunk meets the ground** is Components' (the tree's root flare). Seating a tree on a slope is World's (the stand).

## Shared contracts

These belong to no single session:
- `packages/schema` (ports, cuts, facts, the engine protocol)
- the world service's messages (`app/world-service/protocol.ts`)
- the world document
- the design system's shared rules (`docs/design-system.md`'s opening sections)

A session that needs to change one does it in its own pull request, titled `contract: …`. The PR says what changed and why, and records a decision. The other sessions take the change when they next pull `main`.

## A round, start to finish

1. **Start from `main`.** At the start of every round, `git fetch` and rebase the session's branch on `origin/main`, then `pnpm install`. Every worktree then iterates on the current world, including the other sessions' merged work.
2. **Work in small pieces.** Streams within a session branch from the session's branch and merge back into it.
3. **Merge atomically.** When a piece is done, its checks pass, and its page is published:
   - rebase on `origin/main` again;
   - push the branch;
   - open a pull request with `gh pr create`;
   - once CI passes, merge it with `gh pr merge --rebase --delete-branch=false`.

   Each pull request is one coherent change, never a whole round of mixed work, so any piece can be reverted alone.
4. **Resolve conflicts on your side.** In a rebase, keep the other session's version of their files and adapt yours. If two sessions both need a file, the owner changes it and the other waits for the merge.
5. **Tell the World session.** It restarts the phone link on the new `main`, re-measures smoothness on a quiet machine, and reports regressions to the session that merged.

## Decisions

Decision records are numbered when they reach `main`: give a new record the next free number when you rebase before merging. Never reuse a number. Supersede an old record with a line at its end.

## The proving ground

The World session is building a proving ground: a world built from a synthetic codebase, opened with `?world=proving` in the lab. It contains what Gaia's own world doesn't:
- areas and entities at every vitality, down to ruin
- bridges and stepping stones over streams
- every building and landmark kind
- large and tiny areas

Every session tests its work there as well as in Gaia's own world.
