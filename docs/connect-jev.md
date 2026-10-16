# Connecting Jev

Gaia judges every look in a codebase's world with Jev, through OpenRouter,
using your key. Until you connect it, a world opens only from answers Jev
gave before, and one that needs anything new fails to open and says why.

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
**Go ahead** or **Not now**, which leaves the world unopened until the next
opening asks again. Eight requests go at a
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
front of you.

With no project named, Gaia opens on the start: the worlds you opened
before, a folder on this computer, or the address of a public repository on
GitHub (`github.com/owner/name`), which Gaia clones into
`~/Library/Application Support/Gaia/clones/` and judges like any other
codebase the same way. **File > Choose a World…** (⇧⌘O)
returns to it, **File > Open Folder…** (⌘O) opens a folder directly, and
`GAIA_PROJECT=/path/to/repo GAIA_JEV=live pnpm dev` skips the start.

## What it costs

Each look is one request of facts and doc comments; the understanding pass
sends each file's source with its neighbours' signatures (see "The
understanding pass" in `docs/architecture.md`). On 2026-10-08 Jev judged
this repository's snapshot (292 files) in 322 requests: 572,000 input tokens billed, $0.024
at Jev 1.13's $0.042 per million input tokens (output is free), about 0.3
seconds per request, none failed or answered outside its options. The engine's `jev.estimate` gives the figure before anything is sent, and
the app compares it with your limit; it runs about a quarter above what
OpenRouter bills. `pnpm print-world-requests` prints every request without sending it.

The lab's standalone page shows that world: `pnpm jev-world` judged the
snapshot and kept the answers in `app/renderer/terrain/fixtures/gaia-jev.json`.
After questions or options change, the page fails on the first request its
kept answers no longer cover, naming it, until someone runs, with the key:

```sh
GAIA_JEV=live pnpm jev-world --judge jev --spend-up-to 0.07
```

It asks only what is not kept yet; `--limit 5` sends at most five, and
`--judge local` proves the path against the local stand-in.

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

## Trying it without OpenRouter

A local stand-in for OpenRouter's Decisions API answers in Jev's format on
this Mac, and the engine sends it a placeholder key, never yours:

```sh
pnpm openrouter-stand-in --port 8787
GAIA_JEV=live GAIA_JEV_ENDPOINT=http://127.0.0.1:8787/api/alpha/decisions GAIA_DATA_DIR=/tmp/gaia-trial pnpm dev
```

`GAIA_JEV_ENDPOINT` accepts only a loopback address. `GAIA_DATA_DIR` keeps
the trial's answers apart from your real ones.
