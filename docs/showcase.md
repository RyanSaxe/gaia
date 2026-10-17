# The showcase

The showcase is the world Gaia's film is walked through. Its codebase is
gaia, a made-up static site generator, named so that the journal's title
page reads GAIA when the film opens it. Its code and comments are written so
that Jev, reading them as it reads any codebase, makes the places the film
needs: a wood, a village by the water, a tower on the hub, a meadow, and an
old renderer gone to ruin. Nothing is set by hand: every look is Jev's
answer about its real source.

The proving ground holds every feature a world can show, laid out from
choices fixed by hand. The showcase is a codebase like any other.

## The showcase's source

The showcase's source is real TypeScript, Markdown, JSON and shell, kept in
one text file, `app/renderer/terrain/fixtures/showcase-code.txt`, each file
under its own `=== path ===` line. Gaia's own world reads that one file, not
a codebase of its own. `pnpm showcase --code DIR` writes the files out,
outside Gaia's repository or under `node_modules`.

| Folder | What it is | Written to read as |
| --- | --- | --- |
| (root) | README, changelog, contributing guide, decisions, the example site's config | Quiet ground: the meadow |
| `packages/kernel` | The site, pages and node tree every package imports | The center of everything: the tower |
| `packages/engine` | The build: about 180 short steps, each documented as old and patient | The oldest, deepest part: the wood |
| `extensions` | The registry and nine extensions, each a package that registers itself and hands the page on | Busy, lively, flowing file to file: the village by the brook |
| `v1` | The old renderer, with its renderer, importer, templates and cache as packages | Still on the path of most sites, and broken: the ruin |
| `apps/cli`, `apps/dev-server`, `search`, `tooling`, `e2e`, `docs` | The command, the dev server, the search index, scripts, tests and guides | Kept |

How the code guides Jev:

- **The project's own words.** Every request Jev answers carries the opening
  of the root's README, so it says what each part is to the project: the
  kernel is the center everything is built around, the engine's steps are
  old and each small, the extensions are where the daily work happens, and most
  sites still build through v1.
- **Docs.** A form, a land's ground and its accents are chosen from the docs
  of the definitions that matter most in each place, so those docs carry
  each place's character: age in the engine, liveliness in the extensions.
- **Structure.** Whether a land holds a brook or a still pond follows how its
  files import each other. The extensions import along chains of their own
  files (`index.ts` registers every extension, each extension imports its
  helpers), so their land flows.
- **Real faults.** `v1/` is badly written in fact, not in name: state shared
  through module globals, swallowed errors, mode numbers, unescaped output,
  `eval`, failing tests, and honest comments (`DEPRECATED`, `broken since
  v2`, `HACK`, `TODO`) that say so.

## v1, as it is and fixed

The film shows that improving bad code makes its land healthy, so the
showcase carries `v1/` twice. `showcase-code.txt` holds it as it is;
`fixtures/showcase-code-v1-fixed.txt` holds the same fifteen files rewritten
well: clear names, handled errors, no shared state but the settings, tests
that pass and honest docs. The fixed `v1/` type-checks under the
showcase's own `tsconfig.json` settings. `--v1 fixed` lays the fixed files
over the same paths.

The two are written to the same shape: every file has the same number of
lines, and every function, class and method the same name and the same span.
The land is laid out from that shape alone, so both lay out the same land to
the cell, and only Jev's judgment differs. `pnpm showcase` checks it after
every judging run, and `tools/showcase.test.ts` checks it against both
snapshots.

## Opening it

- The lab: `?world=showcase`, or `?world=showcase-fixed` for v1 fixed
  (`pnpm lab:html out.html`, then open `out.html?world=showcase`).
- The app: `GAIA_PROJECT=showcase pnpm dev` (or `showcase-fixed`). The page
  lays the showcase out itself, so no folder is opened; File > Open Folder
  leaves it.

Either way the page lays the showcase out from the engine's judged graph of it
(`fixtures/showcase-graph.json`, or `showcase-fixed-graph.json`) and the
answers Jev gave about it (`showcase-jev.json`, `showcase-fixed-jev.json`),
asking Jev nothing. A request with no kept answer fails the page and names
it. The journal reads the showcase's code from the bundle the page carries,
with the fixed `v1/` laid over it for `showcase-fixed`.

## Jev's judgment

```sh
GAIA_JEV=live GAIA_DATA_DIR=dir pnpm showcase --judge jev --spend-up-to 0.4
GAIA_JEV=live GAIA_DATA_DIR=other-dir pnpm showcase --judge jev --v1 fixed --spend-up-to 0.4
```

Each writes the showcase's source into the folder `gaia` in its store and
opens it as the app opens any folder (`openWorld`): the engine reads it,
Jev's understanding pass judges how much each part matters and how well it
is made, and Jev judges and composes its world. It then writes the variant's
three fixtures and prints the requests, tokens and dollars OpenRouter
billed. `--judge local` asks the OpenRouter stand-in on this machine instead
and sends nothing.

The engine names a folder outside any git checkout after the folder itself,
so the graph, the world and the journal's title page carry the name gaia.
Keep the store outside a git checkout, or the showcase takes that
repository's name.

Judge each variant in a store of its own. The engine holds an answer for a
file through its changes and replaces it only when a fresh one clearly
differs, so judging the fixed `v1/` in the store that judged the broken one
would keep part of the broken verdict. A fresh store costs about $0.10 a run;
a later run in the same store asks only what changed.

What Jev made of the showcase on 2026-10-17:

| | v1 as it is | v1 fixed |
| --- | --- | --- |
| `v1/` | quality 0.53 | quality 0.76 |
| `v1/index.ts` | 0.40 | 0.69 |
| `compat.ts`, `shims.ts`, `migrate.ts` | 0.41, 0.47, 0.48 | 0.78, 0.81, 0.69 |
| `renderer`, `importer`, `templates`, `cache` | 0.57, 0.57, 0.60, 0.58 | 0.73, 0.80, 0.79, 0.77 |
| v1's houses | 3, the most worn at vitality 0.53 | 8, the most worn at vitality 0.60 |

In both, v1 is a basin holding a still pond: in morning mist on moss as it
is, clear over clover once fixed. The rest is the same in both: the engine
a mossy basin with a still pond; the kernel a valley with a trickle, with
`Site` and `createSite` as lookout towers; the extensions a brook valley;
the root a brook valley of lush grass, with the project as a great tree.

The engine's water is a close call. Jev weighs a still pond against a brook
at 0.48 to 0.39 from the folder's structure and names alone; named
`@folio/engine`, the same folder had a brook at 0.45 to 0.41. As a brook
valley its houses stand along the water with waterwheels; as a basin they
have none.

The wood does not come out yet: Jev stands 7 trees in the engine's land.
Asked as #263 asks (no line counts, narrower form words, trees from rank
0.30), it stood 64 of the engine's 195 things as trees, but the engine's
most important steps also became 16 buildings inside the wood.

## Changing it

Edit `showcase-code.txt` or `showcase-code-v1-fixed.txt`, then judge both
again: `tools/showcase.test.ts` fails until each snapshot is the showcase's
current code. It also checks that every TypeScript file parses, that the
fixed `v1/` changes only `v1/` and lays out the same land, and that `v1/`
stays in ruin until it is fixed while the rest stays kept.
