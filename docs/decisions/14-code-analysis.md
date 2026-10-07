# Background code analysis

An engine built with Rust and tree-sitter processes the codebase in the background. Gaia may send Jev facts and doc comments, and the state can hold more than entities. Context starts at the smallest tier and grows by a mix of escalation on low confidence and Jev choosing what to read. The reviewer wants richer code representations considered before slice 2 settles what Jev reads: tree-sitter structures below the symbol level, code blocks, LSP data, and tools such as graphify.

## Why

Rust and tree-sitter carried over from the Jev session, round 1.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), as it stood on round 4's Agreed page, the plan for slice 1.
