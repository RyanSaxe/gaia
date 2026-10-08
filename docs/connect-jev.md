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

The app opens on this repository's world. Gaia asks Jev with no question
when judging costs no more than your spend limit: $0.10 a project unless you
set another (`DEFAULT_SPEND_LIMIT_USD` in `app/world-service/open-world.ts`).
Only when a project's estimate is over the limit does a small paper slip
appear at the foot of the waiting screen, with the cost and your limit, and
two answers: **Go ahead** or **Use the stand-in**. Choosing the stand-in is
remembered for that project until the limit changes. Eight requests go at a
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

To see another codebase, choose **File > Open Folder…** (⌘O), or start with
`GAIA_PROJECT=/path/to/repo GAIA_JEV=live pnpm dev`.

## What it costs

Each place is one request of facts and doc comments. Source code is never
sent. On 2026-10-08 Jev judged this repository's snapshot in 267 requests:
316,000 input tokens billed, $0.013 at Jev 1.13's $0.042 per million input
tokens (output is free), a quarter to half a second per request, none
failed or answered outside its options. The engine's `jev.estimate` gives the figure before anything is sent, and
the app compares it with your limit; it runs about a quarter above what
OpenRouter bills. `pnpm print-world-requests` prints every request without sending it.

The lab's standalone page shows that world: `pnpm jev-world` judged the
snapshot and kept the answers in `app/renderer/terrain/fixtures/gaia-jev.json`.
Add `?judge=stand-in` to the page's address to see the stand-in's world
instead. After questions or options change, the page judges what the kept
answers no longer cover with the stand-in until someone runs, with the key:

```sh
GAIA_JEV=live pnpm jev-world --judge jev --spend-up-to 0.04
```

It asks only what is not kept yet; `--limit 5` sends at most five, and
`--judge local` proves the path against the local stand-in.

## Comparing what Jev reads

`pnpm compare-jev` judges this repository under each way of building Jev's
requests (`first`, `revised`, `outline`, `escalate`, `shared`,
`shared-outline`; see "What a request carries" in `docs/architecture.md`)
and reports how often their judgments differ, question by question, against
Jev's own noise and its lean toward the first option. With your key it asks
Jev itself, every design twice and once reordered. It refuses to start
unless you allow twice the estimate, about $0.69; the run on 2026-10-08
cost $0.31:

```sh
GAIA_JEV=live pnpm compare-jev --judge jev --spend-up-to 0.70 --out /tmp/jev-designs.json
```

`--designs revised,shared` compares fewer, `--keep-runs yes` writes every
answer into the report, and `--ledger spend.jsonl` appends what each run
cost.

`--judge local` runs the same flow through the engine against the local
stand-in, and `--judge stand-in` in process; neither reaches OpenRouter.

Answers are kept, so reopening sends nothing. When code changes, only the
places whose facts changed are asked again, usually a handful of requests.

## Where answers are kept, and starting over

Each project's answers, and a stand-in choice made over the limit, live in
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

Forgetting a project also forgets a stand-in choice, so the next live start
over the limit asks again.

## When Jev is not asked

Without `GAIA_JEV=live`, or without a key, the stand-in judges everything Jev
has not judged before; answers already kept are still used. The terminal
running `pnpm dev` prints how each world was judged, for example
`gaia: opened …/gaia-v3: 273 things judged by Jev`, or why Jev was not asked.

## Trying it without OpenRouter

A local stand-in for OpenRouter's Decisions API answers in Jev's format on
this Mac, and the engine sends it a placeholder key, never yours:

```sh
pnpm openrouter-stand-in --port 8787
GAIA_JEV=live GAIA_JEV_ENDPOINT=http://127.0.0.1:8787/api/alpha/decisions GAIA_DATA_DIR=/tmp/gaia-trial pnpm dev
```

`GAIA_JEV_ENDPOINT` accepts only a loopback address. `GAIA_DATA_DIR` keeps
the trial's answers apart from your real ones.
