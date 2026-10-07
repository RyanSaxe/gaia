# Electron, four processes, a Rust engine binary

Gaia v3 ships on Electron, so WebGPU works on macOS 13 and later, including the reviewer's macOS 14.4. Four processes run: Electron's main process, the Rust engine, the world service (a TypeScript utility process that owns the world document), and the renderer with its realizer workers. The Rust engine is a separate binary that also runs from the command line, speaks newline-delimited JSON-RPC over stdio, and holds the OpenRouter key in the macOS Keychain.

## Why

The process layout on round 2's Repository and processes page drew no objecting note, and the reviewer sent round 2 with everything else marked as good.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), as it stood on round 4's Agreed page, the plan for slice 1.
