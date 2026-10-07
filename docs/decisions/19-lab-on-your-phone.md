# The lab on your phone

`pnpm lab:serve` serves the lab, without the engine, on this Mac's Tailscale
address only (port 5180), so the reviewer can use it from a phone. The lab has
touch controls (a walk pad, one-finger look, pinch and drag) and, below 700 px
wide, an inspector that pulls up from the bottom. Round 8 replaced the walk pad
with [tapping the ground to walk](20-click-to-walk.md).

## Why

The reviewer: "Make sure the app is setup so you can launch it where I can
access from TailScale ... I often am on my phone when we are working so that
would be easier." The Electron app cannot run on a phone, but the lab is a web
page and explores worlds without the engine. Binding only to the Tailscale
address keeps it off the local network and the internet.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 7, in
the thread on the "How we know slice 2 is done" page.
