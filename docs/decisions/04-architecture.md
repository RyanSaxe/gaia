# Architecture

Plain typed data passes through four stages: the code model, the world document, the realized world, and the screen. Rust analyzes code, stores data and calls Jev. TypeScript holds the schemas, the generator, the realizer and the renderer. Jev writes only into the world document, through questions derived from declared types, and the realizer is a pure function of its inputs. The README carries an architecture diagram like the one on round 1's Architecture page.

## Why

The four stages and the rules on round 1's Architecture page drew no objecting note, and the reviewer sent round 1 with everything else marked as good.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), as it stood on round 4's Agreed page, the plan for slice 1.
