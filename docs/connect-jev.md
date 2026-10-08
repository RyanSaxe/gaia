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

The app opens on this repository's world. Before anything is sent, the veil
says how many places Jev has not judged yet and what asking will cost, then
offers **Ask Jev** or **Use the stand-in**. It asks once per project and
remembers your answer. While Jev answers, the veil counts them ("Asking Jev
about 267 places… 96 answered"). Eight requests go at a time, so a first
run takes about half a minute to a minute.

The world appears once every answer is in, never half-judged: changing a
judgment after the world stands would swap trees, buildings and land in
front of you. Walk up to anything and its card says **Judged by Jev**, or
**Judged by the stand-in** if Jev refused or failed that request (a failed
request is asked again on the next live start).

To see another codebase, choose **File > Open Folder…** (⌘O), or start with
`GAIA_PROJECT=/path/to/repo GAIA_JEV=live pnpm dev`.

## What it costs

Each place is one request of facts and doc comments. Source code is never
sent. On 2026-10-07 this repository took 267 requests: about 380,000 input
tokens, about $0.016 at Jev 1.13's $0.042 per million input tokens (output is
free). The app shows the exact figure from the engine's `jev.estimate` before
asking. `pnpm print-world-requests` prints every request without sending it.

## Comparing what Jev reads

`pnpm compare-jev` judges this repository under each way of building Jev's
requests (`first`, `revised`, `outline`, `escalate`; see "What a request
carries" in `docs/architecture.md`) and reports how often their judgments
differ, question by question, against Jev's own noise and its lean toward
the first option. With your key it asks Jev itself, all four designs twice
and once reordered, for about $0.45 at most, and refuses to start unless you
allow that:

```sh
GAIA_JEV=live pnpm compare-jev --judge jev --spend-up-to 0.50 --out /tmp/jev-designs.json
```

`--judge local` runs the same flow through the engine against the local
stand-in, and `--judge stand-in` in process; neither reaches OpenRouter.

Answers are kept, so reopening sends nothing. When code changes, only the
places whose facts changed are asked again, usually a handful of requests.

## Where answers are kept, and starting over

Each project's answers and your cost answer live in
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

Forgetting a project also forgets your cost answer, so the next live start
asks again.

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
