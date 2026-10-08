# What Jev reads, and how its context grows

Jev reads a thing's outline, not its source: a file's symbols (kind, name, exported or not, size in words, doc comment), its imports and importers, its tests and its health; an area's files and subdirectories; an entity's files and dependencies. Sizes are words and line numbers stay out of the state, so a small edit does not make Jev judge a thing again. Each request also asks, one yes-or-no per reading, whether reading more would help, and a request Jev was unsure about is asked again with the readings it chose. A request carries what was judged above it, so an area's character informs its files. The ways of building requests are designs (`first`, `revised`, `outline`, `escalate`), and `pnpm compare-jev` compares them; the app keeps `revised` until real answers show a better one. Source is not sent until the reviewer approves it directly in Claude Code; reading chosen symbols' spans is designed as the step after escalation.

## Why

On round 12's connect-jev page the reviewer asked: "What if we give like the treesitter summary for the file and Jev can ask for lines? Is that possible? Next round, now that the world is mostly ready, can we logically iterate on how we choose state and questions?" In round 13 the reviewer added: "I really want to architecturally dive deep into how we give state and context to Jev." Round 1 had agreed that context starts small and grows by escalation and by Jev choosing what to read.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 13 (the jev-state page). Which design becomes the default waits for the comparison on Jev's real answers.
