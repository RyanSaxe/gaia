# The showcase

The showcase is the world Gaia's film is walked through. Its codebase is
folio, a made-up static site generator written so that its world holds what
the film needs: a wood, a meadow, a village of houses on a brook, a hub's
tower on a hill, and past it an old renderer gone to ruin.

The proving ground holds every feature a world can show, laid out from
choices fixed by hand. The showcase is a codebase like any other: its world
is what Gaia makes of its real source.

## folio's source

folio's source is real TypeScript, Markdown, JSON and shell, kept in one text
file, `app/renderer/terrain/fixtures/showcase-code.txt`, each file under its
own `=== path ===` line. Gaia's own world reads that one file, not a codebase
of its own. `pnpm showcase --code DIR` writes the files out, outside Gaia's
repository or under `node_modules`.

| Folder | What it is | How it is written |
| --- | --- | --- |
| (root) | The workspace: README, changelog, contributing guide, licence, the example site's config | Kept |
| `e2e` | End-to-end tests that build and serve the example site | Kept |
| `site` (`@folio/site`) | The document model every package imports: sites, pages, node trees, frontmatter, events | Kept |
| `engine` (`@folio/engine`) | The build: parse Markdown, transform, lay out, render, write, in 132 short functions | Kept |
| `schema` (`@folio/schema`) | The types every package agrees on | Kept |
| `extensions` (`@folio/extensions`) | The extension registry, and seven extensions as packages of their own: markdown, syntax, images, embeds, feeds, sitemap and i18n | Kept; feeds and i18n each carry a TODO or FIXME |
| `apps/cli` | The `folio` command | Kept |
| `apps/dev-server` | `folio serve`: the local server, file watching and live reload | Kept |
| `find` (`@folio/find`) | The search index folio writes beside a site | Tired: `any`, long functions, an emptied handler, `rank.ts` with a known bug |
| `handbook` | The guide, the extension guide, the API and the decisions | Kept |
| `tooling` | Benchmarks, their history and the release script | Kept |
| `v1` (`@folio/v1` and four packages) | The old renderer, frozen since 0.6: renderer, importer, templates and cache | In ruin: one-letter names, `var` and `any`, emptied error handlers, state at module level, docs about something else, HACK and TODO comments, failing tests |

Packages import each other by name (`@folio/site`), which the engine resolves
through each package's manifest, so a folder can be renamed without touching
the code.

A folder's place on the land is seeded by its path. folio's folder names were
chosen among names a real project might use (`site`, `model` or `core` for
the hub; `engine`, `build` or `compiler` for the build) for where they put
the places the film walks: the meadow between the wood and the village, and
the old renderer far from both.

## Opening it

- The lab: `?world=showcase` (`pnpm lab:html out.html`, then open
  `out.html?world=showcase`).
- The app: `GAIA_PROJECT=showcase pnpm dev`. The page lays folio out itself,
  so no folder is opened; File > Open Folder leaves it.

Either way the page lays folio out as it lays out Gaia's own snapshot: from
the engine's judged graph of folio (`fixtures/showcase-graph.json`) and the
answers Jev gave about it (`fixtures/showcase-jev.json`), asking Jev nothing.
A request with no kept answer fails the page and names it. The journal reads
folio's code from `showcase-code.txt`, which the page carries.

## Jev's judgment

```sh
GAIA_JEV=live GAIA_DATA_DIR=dir pnpm showcase --judge jev --spend-up-to 0.3
```

writes folio's source into `dir/folio` and opens it as the app opens any
folder (`openWorld`): the engine reads it, Jev's understanding pass judges
how much each part matters and how well it is made, and Jev judges and
composes its world. The answers are kept in the store under `dir`, so a later
run asks only what changed. It then writes the three fixtures and prints the
requests, tokens and dollars OpenRouter billed. `--judge local` asks the
OpenRouter stand-in on this machine instead and sends nothing.

On 2026-10-16 the first run sent 510 requests, 1,902,881 input tokens, for
$0.080. Rewriting `v1/` asked 81 requests again, 261,874 tokens, for $0.011.

What Jev made of folio:

| Place | In Jev's world |
| --- | --- |
| `engine` | A brook valley holding 8 buildings and a landmark: the engine's package, `blocks.ts`, `render.ts`, `parseBlocks`, `readBlock`, `parseInline`, `readAt` and `build`, and `renderNode` as the landmark |
| The root | A brook valley of old meadow, the package a building |
| `schema` | `index.ts` and its `Page` type, each a building |
| `extensions` | A mossy basin with a still pond; no buildings |
| `site` | A brook valley; no buildings |
| `v1` | Rolling hills with no water, its quality 0.44 to 0.65; `bld` a building at vitality 0.36 |
| Plants and stones | 137 box mounds, 122 drifts of bluebells, 99 bench stones and 16 trees, of the 321 definitions and 96 files |

## Changing it

Edit `showcase-code.txt`, then judge it again: `tools/showcase.test.ts`
fails until the snapshot is folio's current code. It also checks that every
TypeScript file parses, that `v1/` stays in ruin and that `site`, `engine`
and `schema` stay kept.
