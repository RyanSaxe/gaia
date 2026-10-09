# A trunk meets the ground in root lobes

Trunks looked torn: stepped where their segments met, dark on the sunny
side, and ending in sharp points at the ground. Most of it was bark drawn
inside out: every bark tube was wound with its front faces inward, and bark
draws front faces only, so the renderer showed the inside of each trunk's
far wall. Now:

- Bark is wound with its faces outward, and the contract test holds bark and
  stone to it.
- Each chain of limb segments that continue one another (a trunk's three, a
  bough's two or three) is one tube with one frame carried from ring to
  ring, so the bark's ridges run unbroken past the joins.
- A trunk's flare has rings close to the ground, so it curves, and it splits
  into three to five broad root lobes that sink into the ground, each sized
  and turned a little differently. A flared trunk has 24 sides so its lobes
  stay round.
- The terrain measures a tree's base from every bark vertex at the ground,
  not from the primitive's vertex order.

## Why

The reviewer, after round 16: "see in foreground and background the way tree
trunk connects to the ground doesnt look right? hopefully we can polish
that?" On round 2's board of four ways for a trunk to meet the ground, they
chose root lobes over a smooth flare, surface roots, and lobes running on as
roots.

## Settled

Pair session `components` (`3a663ec8-e6c3-4286-b8b7-6b76dd6adffb`), round 2.
