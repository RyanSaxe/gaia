# World design system

Every component uses the design system's tokens: painterly cel light with tinted shadows, one material family, v1's components as the visual bar, subtle effects, height bands per kind, and composition budgets that keep routes from dominating. Color works at three levels: the world's art direction, each region's biome with its native palette families, and each component's family. Ground colors blend across region edges, and components never blend. Every codebase's world must look unique, wondrous and fun, not like one of a few preset worlds. The whole world shares light, sky, season and wind. Each region's biome owns its relief, ground cover, wildflowers, drifting accents, local air and native palette families. Jev keeps a world coherent through two requests: light and season first, then the rest with those answers in the state. Night is part of the world: a carried lantern, moonlight as a floor, and the world's own glow. Mackerel-dapple clouds are dropped, and cirrus streaks appear only where they suit a world.

## Why

The reviewer chose "Jev picks a season" and in the same note asked for more: every codebase should look unique. The rest of round 2's design system page drew no objecting note.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), as it stood on round 4's Agreed page, the plan for slice 1.

Replaced in part by the legacy sweep: it stops asking Jev for a season, which the walked world never showed, so Jev answers the light first, then the sky and wind. Each land's native palette families now choose the colors of the buildings and landmarks standing on it.
