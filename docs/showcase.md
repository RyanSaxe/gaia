# The showcase

The showcase is a synthetic static-site generator used to demonstrate Gaia.
It contains a central kernel, an engine, extensions and an older `v1` module
with deliberately poor code. A second variant repairs `v1` while keeping its
file paths and definition spans, so code health changes without changing the
layout. Both worlds open from bundled Jev answers, the only ones the repository
keeps. The standalone lab, `pnpm probe` and CI's rendering probe open the
showcase.

## Open it

Choose the showcase on Gaia's start page, or set `GAIA_PROJECT` to `showcase`
or `showcase-fixed` before `pnpm dev`. The standalone lab opens the showcase
with no query, or with `?world=showcase`; use `?world=showcase-fixed` for the
repaired one.

| Bundle in `app/renderer/terrain/fixtures/` | Purpose |
| --- | --- |
| `showcase-code.txt` | Source files for the original project |
| `showcase-code-v1-fixed.txt` | Replacement source for `v1` |
| `showcase-graph.json`, `showcase-fixed-graph.json` | Judged code graphs |
| `showcase-judged.json`, `showcase-fixed-judged.json` | Code judgments for the journal |
| `showcase-jev.json`, `showcase-fixed-jev.json` | Saved world design answers |

The source bundles encode a file tree. They are test data, including deliberate
faults and misleading comments in the broken variant.

## Write the source

`pnpm showcase --code DIR` writes the project to a directory outside Gaia's
checkout, or under `node_modules`. Add `--v1 fixed` for the repaired variant.
Keep it out of Gaia's analyzed source tree.

## Update the bundled worlds

Change the source bundle, then regenerate the matching graph, code judgments
and design answers together. Live regeneration sends code to OpenRouter and
requires approval. Use a separate `GAIA_DATA_DIR` outside any Git checkout for
each variant; held judgments in a shared store can preserve part of the other
variant's verdict.

With `GAIA_JEV=live` set in the environment:

```sh
pnpm showcase --judge jev --spend-up-to 0.4
pnpm showcase --judge jev --v1 fixed --spend-up-to 0.4
```

Set the appropriate `GAIA_DATA_DIR` before each command. `--spend-up-to` caps
that run. `--judge local` exercises the pipeline against the local stand-in;
it is useful for development, but its answers are not suitable replacements
for the showcase's live judgments.

[`tools/showcase.test.ts`](../tools/showcase.test.ts) checks that each graph
matches its bundled source, that the fixed variant changes only `v1`, that
both layouts match, and that the quality contrast remains visible. It also
checks parsing and expected visual features. Run it after editing either
source bundle.
