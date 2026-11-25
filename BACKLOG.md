# Backlog

- [x] Rewrite the core docs in plain language, with clear diagrams and less
      text.
- [ ] Improve the realism of existing components, add more components, and make
  them compose in more ways.
- [x] Add the video's music and environmental sounds to the game.
- [ ] Polish interactions, including removing journal hover visuals other than
      the pointer.
- [ ] Make world changes follow code changes. A small graph change should cause
      a small, local change to the existing world.
- [ ] Reduce memory use and improve speed so Gaia runs well on less powerful
  machines.
- [ ] Enable remaining strict TypeScript `oxlint` rules (`suspicious` category,
      `complexity <= 10`, `max-depth <= 4`, `max-nested-callbacks <= 3`,
      `max-params <= 3`, `consistent-type-assertions`,
      `explicit-function-return-type`, `no-non-null-assertion`,
      `no-nested-ternary`, `unicorn/no-negated-condition`, `import/no-cycle`,
      `switch-exhaustiveness-check`, `no-misused-promises`) and split source
      files over the 1,000-line `max-file-lines` cap.
