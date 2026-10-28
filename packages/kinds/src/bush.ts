import { type AnyKind, type Slot, kind, slot } from "@gaia/schema";

/**
 * A bush that stands for one thing in the code, as a tree does, composed from
 * a bush's parts alone (its `Composing` library): a shrub's, a bramble's or a
 * sapling's frame, its bark, a crown on the frame and anything hanging in it.
 */
export const bush = kind({
  id: "bush",
  subject: "thing",
  doc: "A bush that grows knee to head high, standing for one thing in the code: how it grows, what it wears and how it moves say how that code feels.",
  slots: {
    form: slot("Skeleton", { ask: "its frame is how the bush holds itself, low or reaching, tidy or tangled: choose the frame whose feel suits the code it stands for." }),
    bark: slot("Surface", { on: "form", ask: "its bark is how weathered the code it stands for feels to the touch." }),
    crown: slot("Foliage", { on: "form", ask: "its leaves are the first thing a person feels about it from the path: choose the leaves whose feel suits the code it stands for." }),
    bloom: slot("Ornament", {
      on: "crown",
      optional: true,
      ask: "flowers, pods, berries or fruit among its leaves say the code it stands for feels generous or in its season; a bush whose code feels plain and workmanlike bears none.",
    }),
    motion: slot("Motion", { ask: "how it moves in the wind says how restless or settled the code it stands for feels." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it sits on its land." }),
  },
  facts: {},
});

/** `k`'s slots, each asked in `asks`' words instead of its own: every slot needs words of its own. */
function askedAs(k: AnyKind, asks: Readonly<Record<string, string>>): Record<string, Slot> {
  const names = Object.keys(k.slots);
  const missing = names.filter((n) => asks[n] === undefined);
  const extra = Object.keys(asks).filter((n) => !names.includes(n));
  if (missing.length > 0 || extra.length > 0) throw new Error(`Every slot of ${k.id} is asked anew or none is: missing ${missing.join(", ") || "none"}, unknown ${extra.join(", ") || "none"}.`);
  return Object.fromEntries(Object.entries(k.slots).map(([name, s]) => [name, { ...s, ask: asks[name] as string }]));
}

/**
 * A bush of the wild past the world's land, which stands for no code: the
 * bush kind itself, its slots and parts, so it builds and draws as any bush
 * does, asked in words of the wild land it grows on instead of the code a
 * bush on the land stands for.
 */
export const wildBush = kind({
  ...bush,
  doc: "A bush that grows knee to head high in the wild past the world's edge, which stands for no code: how it grows, what it wears and how it moves say how the wild land around it feels under the world's sky.",
  slots: askedAs(bush, {
    form: "its frame is how the bush holds itself, low or reaching, tidy or tangled: choose the frame whose feel suits the wild land it grows on.",
    bark: "its bark is how weathered the wild land around it feels to the touch.",
    crown: "its leaves are the first thing a person feels about the wild, looking out from the land's edge: choose the leaves whose feel suits the wild land around it.",
    bloom: "flowers, pods, berries or fruit among its leaves say the wild land around it feels generous or in its season; a bush of a plain, wind-worn wild bears none.",
    motion: "how it moves in the wind says how restless or settled the wild land around it feels under the world's wind.",
    palette: "its colors say the mood of the wild land around it, and how it sits beside the world's lands.",
  }),
});
