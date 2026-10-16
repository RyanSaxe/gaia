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

## Changing it

Edit `showcase-code.txt`. `tools/showcase.test.ts` checks that every
TypeScript file parses, that `v1/` stays in ruin and that `site`, `engine`
and `schema` stay kept.
