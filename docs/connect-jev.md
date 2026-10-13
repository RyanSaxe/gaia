# Connecting Jev

Gaia judges every look in a codebase's world with Jev, through OpenRouter,
using your key. Until you connect it, a deterministic stand-in judges instead.

## 1. Put your key in the Keychain

```sh
security add-generic-password -s gaia-openrouter -a openrouter -w
```

`security` prompts for the key, so it never lands in your shell history. Only
the engine reads it, and it passes the key to curl on stdin: the key is never
on a command line, in a log, in the page, or sent anywhere but OpenRouter.

## 2. Start Gaia live

```sh
pnpm install
GAIA_JEV=live pnpm dev
```

The app opens on the start; choose a world there. While Gaia is being built,
it asks Jev with no spend limit (`DEFAULT_SPEND_LIMIT_USD` in
`app/world-service/open-world.ts`), so a run never stops to ask; the terminal
prints each run's requests, tokens and estimated cost. If you set a limit
(below), a project whose estimate is over it shows a small paper slip at the
foot of the waiting screen, with the cost and your limit, and two answers:
**Go ahead** or **Use the stand-in**. Choosing the stand-in is remembered for
that project until the limit changes. Eight requests go at a
time, so a first run takes about half a minute to a minute, while the
waiting screen paints the world's map: each area's border as soon as the
code is read, each area's watercolor as Jev's answers about it come in.

The limit is kept with the app's own settings in
`~/Library/Application Support/Gaia/projects/app/store.json`. To set it,
write that file while Gaia is closed:

```sh
mkdir -p ~/Library/Application\ Support/Gaia/projects/app
echo '{"settings":{"jev-spend-limit":{"usd":0.25}}}' > ~/Library/Application\ Support/Gaia/projects/app/store.json
```

The world appears once every answer is in, never half-judged: changing a
judgment after the world stands would swap trees, buildings and land in
front of you. Walk up to anything and its card says **Judged by Jev**, or
**Judged by the stand-in** if Jev refused or failed that request (a failed
request is asked again on the next live start).

With no project named, Gaia opens on the start: the worlds you opened
before, a folder on this computer, or the address of a public repository on
GitHub (`github.com/owner/name`), which Gaia clones into
`~/Library/Application Support/Gaia/clones/` and judges like any other
codebase the same way. **File > Choose a World…** (⇧⌘O)
returns to it, **File > Open Folder…** (⌘O) opens a folder directly, and
`GAIA_PROJECT=/path/to/repo GAIA_JEV=live pnpm dev` skips the start.

## What it costs

Each place is one request of facts and doc comments. Source code is never
sent. On 2026-10-08 Jev judged this repository's snapshot (292 files) in 322
requests with the app's `judged` design: 572,000 input tokens billed, $0.024
at Jev 1.13's $0.042 per million input tokens (output is free), about 0.3
seconds per request, none failed or answered outside its options. The engine's `jev.estimate` gives the figure before anything is sent, and
the app compares it with your limit; it runs about a quarter above what
OpenRouter bills. `pnpm print-world-requests` prints every request without sending it.

The lab's standalone page shows that world: `pnpm jev-world` judged the
snapshot and kept the answers in `app/renderer/terrain/fixtures/gaia-jev.json`.
Add `?judge=stand-in` to the page's address to see the stand-in's world
instead. After questions or options change, the page judges what the kept
answers no longer cover with the stand-in until someone runs, with the key:

```sh
GAIA_JEV=live pnpm jev-world --judge jev --spend-up-to 0.07
```

It asks only what is not kept yet; `--limit 5` sends at most five, and
`--judge local` proves the path against the local stand-in.

## Comparing what Jev reads

`pnpm compare-jev` judges this repository under each way of building Jev's
requests (`first`, `revised`, `outline`, `escalate`, `shared`,
`shared-outline`, `judged`; see "What a request carries" in `docs/architecture.md`)
and reports how often their judgments differ, question by question, against
Jev's own noise and its lean toward the first option. With your key it asks
Jev itself, every design twice and once reordered. It refuses to start
unless you allow twice the estimate, about $1.10 for all seven designs; the
six-design run on 2026-10-08 cost $0.31:

```sh
GAIA_JEV=live pnpm compare-jev --judge jev --spend-up-to 1.10 --out /tmp/jev-designs.json
```

`--designs revised,shared` compares fewer, `--keep-runs yes` writes every
answer into the report, and `--ledger spend.jsonl` appends what each run
cost.

`--judge local` runs the same flow through the engine against the local
stand-in, and `--judge stand-in` in process; neither reaches OpenRouter.

Answers are kept, so reopening sends nothing. When code changes, only the
places whose facts changed are asked again, usually a handful of requests.

## Where answers are kept, and starting over

Each project's answers live in
`~/Library/Application Support/Gaia/projects/<project>/store.json`, where
`<project>` is the first 12 characters of the repository's root commit.

```sh
# Forget one project (run inside its repository):
rm -r ~/Library/Application\ Support/Gaia/projects/$(git rev-list --max-parents=0 HEAD | tail -1 | cut -c1-12)
# Forget every project:
rm -r ~/Library/Application\ Support/Gaia/projects
# Remove the key:
security delete-generic-password -s gaia-openrouter -a openrouter
```

## When Jev is not asked, or cannot answer

A world is always Jev's. Without `GAIA_JEV=live`, or without a key, a world
that needs an answer Jev hasn't given before fails to open, and the wait says
why and how to turn Jev on; a world whose every answer is kept still opens
from the store. A request Jev cannot answer once the engine has retried it (a
timeout, a 429 or a 5xx, twice), or answers outside its options, fails the
opening the same way, naming the request and the reason. Declining a cost
past your limit leaves the world unopened, and the next opening asks again.
The terminal running `pnpm dev` prints how each world was judged, for example
`gaia: opened …/gaia-v3: 273 things judged by Jev`, or why it could not open.

### For development only: the stand-in

To open a world quickly without Jev, on purpose, start Gaia with
`GAIA_JEV=stand-in pnpm dev`: a deterministic stand-in judges every look and
composes the world, the understanding pass is not run, and nothing is sent
to Jev. The standalone lab's `?judge=stand-in` does the same for Gaia's
snapshot. Its answers are crude guesses, not judgments: it is never on by
default, never offered to a person, and nothing is tuned to look good with
it.

## Trying it without OpenRouter

A local stand-in for OpenRouter's Decisions API answers in Jev's format on
this Mac, and the engine sends it a placeholder key, never yours:

```sh
pnpm openrouter-stand-in --port 8787
GAIA_JEV=live GAIA_JEV_ENDPOINT=http://127.0.0.1:8787/api/alpha/decisions GAIA_DATA_DIR=/tmp/gaia-trial pnpm dev
```

`GAIA_JEV_ENDPOINT` accepts only a loopback address. `GAIA_DATA_DIR` keeps
the trial's answers apart from your real ones.
