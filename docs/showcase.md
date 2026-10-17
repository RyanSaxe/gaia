# The showcase

The showcase is the world Gaia's film is walked through. Its codebase is
folio, a made-up static site generator. Its code and comments are written so
that Jev, reading them as it reads any codebase, makes the places the film
needs: a wood, a village by the water, a tower on the hub, a meadow, and an
old renderer gone to ruin. Nothing is set by hand: every look is Jev's
answer about folio's real source.

The proving ground holds every feature a world can show, laid out from
choices fixed by hand. The showcase is a codebase like any other.

## folio's source

folio's source is real TypeScript, Markdown, JSON and shell, kept in one text
file, `app/renderer/terrain/fixtures/showcase-code.txt`, each file under its
own `=== path ===` line. Gaia's own world reads that one file, not a codebase
of its own. `pnpm showcase --code DIR` writes the files out, outside Gaia's
repository or under `node_modules`.

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
  of the root's README, so it says what each part is to folio: the kernel is
  the center everything is built around, the engine's steps are old and
  each small, the extensions are where the daily work happens, and most
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

The film shows that improving bad code makes its land healthy, so folio
carries `v1/` twice. `showcase-code.txt` holds it as it is;
`fixtures/showcase-code-v1-fixed.txt` holds the same fifteen files rewritten
well: clear names, handled errors, no shared state but the settings, tests
that pass and honest docs. The fixed `v1/` type-checks under folio's own
`tsconfig.json` settings. `--v1 fixed` lays the fixed files over the same
paths.

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
  lays folio out itself, so no folder is opened; File > Open Folder leaves it.

Either way the page lays folio out from the engine's judged graph of it
(`fixtures/showcase-graph.json`, or `showcase-fixed-graph.json`) and the
answers Jev gave about it (`showcase-jev.json`, `showcase-fixed-jev.json`),
asking Jev nothing. A request with no kept answer fails the page and names
it. The journal reads folio's code from the bundle the page carries, with the
fixed `v1/` laid over it for `showcase-fixed`.

## Jev's judgment

```sh
GAIA_JEV=live GAIA_DATA_DIR=dir pnpm showcase --judge jev --spend-up-to 0.4
GAIA_JEV=live GAIA_DATA_DIR=other-dir pnpm showcase --judge jev --v1 fixed --spend-up-to 0.4
```

Each writes folio's source into its store's folder and opens it as the app
opens any folder (`openWorld`): the engine reads it, Jev's understanding pass
judges how much each part matters and how well it is made, and Jev judges and
composes its world. It then writes the variant's three fixtures and prints
the requests, tokens and dollars OpenRouter billed. `--judge local` asks the
OpenRouter stand-in on this machine instead and sends nothing.

Judge each variant in a store of its own. The engine holds an answer for a
file through its changes and replaces it only when a fresh one clearly
differs, so judging the fixed `v1/` in the store that judged the broken one
would keep part of the broken verdict. A fresh store costs about $0.10 a run;
a later run in the same store asks only what changed.

What Jev made of folio on 2026-10-16, on `main`:

| | v1 as it is | v1 fixed |
| --- | --- | --- |
| `v1/` | quality 0.54, a still pond in morning mist | quality 0.76, a brook |
| `v1/index.ts` | 0.40 | 0.70 |
| `compat.ts`, `shims.ts`, `migrate.ts` | 0.42, 0.47, 0.47 | 0.78, 0.82, 0.68 |
| `renderer`, `importer`, `templates`, `cache` | 0.50, 0.49, 0.51, 0.45 | 0.71, 0.79, 0.76, 0.73 |

The rest is the same in both: the kernel a trickling valley holding nine
buildings, with the kernel and `createSite` as landmarks; the engine a mossy
basin with a still pond; the extensions a brook valley; the root a brook
valley of lush grass. No land chose drifting accents.

Two places the film needs do not come out yet:

- **v1 has no houses.** A building is offered only to the top tenth of
  things by importance. Jev rates v1's most important definitions about
  0.6, just under that line (0.67), while the engine's steps and the
  kernel fill it.
- **The wood.** On `main` Jev stands 16 of the engine's 203 things as
  trees. Asked as #263 asks (no line counts, narrower form words, trees from
  rank 0.30), it stands 64 of 195, but the engine's most important steps
  also become 16 buildings inside the wood.

## Changing it

Edit `showcase-code.txt` or `showcase-code-v1-fixed.txt`, then judge both
again: `tools/showcase.test.ts` fails until each snapshot is folio's current
code. It also checks that every TypeScript file parses, that the fixed `v1/`
changes only `v1/` and lays out the same land, and that `v1/` stays in ruin
until it is fixed while the rest stays kept.
