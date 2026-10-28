import { type AnyKind, type Slot, kind, slot } from "@gaia/schema";

/**
 * A bush that represents one thing in the code, as a tree does. Jev composes it
 * from a bush's parts alone (its `Composing` library): a shrub's, a bramble's
 * or a sapling's frame, its bark, a crown on the frame and anything hanging in it.
 */
export const bush = kind({
  id: "bush",
  subject: "thing",
  doc: "A bush, knee to head high, that represents one thing in the code. Its shape, bark, leaves and movement show how that code feels.",
  slots: {
    form: slot("Skeleton", { ask: "its frame sets the bush's shape, low or tall, tidy or tangled. Choose the frame whose feel suits the code it represents." }),
    bark: slot("Surface", { on: "form", ask: "its bark shows how weathered the code it represents feels." }),
    crown: slot("Foliage", { on: "form", ask: "its leaves are the first thing a person notices about it from the path. Choose the leaves whose feel suits the code it represents." }),
    bloom: slot("Ornament", {
      on: "crown",
      optional: true,
      ask: "flowers, pods, berries or fruit among its leaves show that the code it represents feels generous or in its prime. A bush whose code feels plain and workmanlike has none.",
    }),
    motion: slot("Motion", { ask: "how it moves in the wind shows how restless or settled the code it represents feels." }),
    palette: slot("Palette", { ask: "its colors show the mood of the code it represents and how it fits with its land." }),
  },
  facts: {},
});

/** `k`'s slots, each with its `ask` replaced by the words in `asks`. It throws unless `asks` names every slot and no other. */
function askedAs(k: AnyKind, asks: Readonly<Record<string, string>>): Record<string, Slot> {
  const names = Object.keys(k.slots);
  const missing = names.filter((n) => asks[n] === undefined);
  const extra = Object.keys(asks).filter((n) => !names.includes(n));
  if (missing.length > 0 || extra.length > 0) throw new Error(`Every slot of ${k.id} is asked anew or none is: missing ${missing.join(", ") || "none"}, unknown ${extra.join(", ") || "none"}.`);
  return Object.fromEntries(Object.entries(k.slots).map(([name, s]) => [name, { ...s, ask: asks[name] as string }]));
}

/**
 * A bush of the wild past the world's land, which represents no code. It is
 * the bush kind with the same slots and parts, so it builds and draws as any
 * bush does, but its slots' words describe the wild land it grows on instead
 * of code.
 */
export const wildBush = kind({
  ...bush,
  doc: "A bush, knee to head high, in the wild land past the world's edge. It represents no code. Its shape, bark, leaves and movement show how the wild land around it feels under the world's sky.",
  slots: askedAs(bush, {
    form: "its frame sets the bush's shape, low or tall, tidy or tangled. Choose the frame whose feel suits the wild land it grows on.",
    bark: "its bark shows how weathered the wild land around it feels.",
    crown: "its leaves are the first thing a person notices about the wild when looking out from the land's edge. Choose the leaves whose feel suits the wild land around it.",
    bloom: "flowers, pods, berries or fruit among its leaves show that the wild land around it feels generous or in its prime. A bush in a plain, wind-worn wild has none.",
    motion: "how it moves in the wind shows how restless or settled the wild land around it feels under the world's wind.",
    palette: "its colors show the mood of the wild land around it and how it fits beside the world's lands.",
  }),
});
