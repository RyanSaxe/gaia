// Which far forms the GPU holds. A set of far cards holds a fixed number of
// forms at once (`FAR_SLOTS`), whatever the world's size, and a world may
// stand many more distinct builds than that in sight: Gaia's own stands all
// of its 115 trees' builds within reach of every spot. So the forms are
// weighed by how many of their copies a view from the person would draw far,
// in any direction, and the heaviest hold the slots: most far copies then draw
// as cards, and every copy of a form that holds none keeps its full form,
// never anything less. A form brought into a slot is read from the far-form
// store when an earlier visit baked it, and is baked a few views a frame
// otherwise, then stored. Once the world shows, a form comes in, or goes out,
// by turning the crown span its copies turn far at between nothing and its
// own over `FAR_TURN.seconds` of frames: each copy passes through the band as
// it does when a person walks away from it, never changing form at once.

import type * as THREE from "three";
import { type FarForm, type FarFormData, farFormData, farFormFrom, startFarBake } from "@gaia/render";
import { contentHash, type FarStore } from "./far-store.ts";
import { FAR, type FarForms, GONE } from "./woods.ts";

/**
 * How a form turns in or out once the world shows: over `seconds` of frames
 * from no card to its own swap size, moving its crown span by the same share
 * each frame. Each half second then moves a copy through its band no further
 * than the swap test's smallest step (from halfway through the full form's
 * dissolve to 5% farther, 0.7% of the crown's span), which stays under the
 * wind's change over half a second. The forms are weighed again every
 * `weighEvery` seconds or `weighAfter` meters walked; a form holding a slot
 * keeps it until one without outweighs it `outweigh` times over, so a few
 * copies crossing the band never trade slots.
 */
export const FAR_TURN = { seconds: 280, weighEvery: 0.5, weighAfter: 8, outweigh: 2 } as const;

/** How a bake paces itself: at most `views` views of a form a frame, within `ms` milliseconds. */
export interface BakePace {
  readonly views: number;
  readonly ms: number;
}

export interface FarStream {
  /**
   * Weighs the forms from `eye` and brings every form the slots hold there,
   * each turned in at once, before anything shows: the wait lifts on it.
   * `focal` is the view's device pixels a radian. Until it settles, `follow`
   * only turns.
   */
  open(eye: THREE.Vector3, focal: number): Promise<void>;
  /** Called every frame the world draws, with the frame's seconds: weighs the forms now and then, brings the heaviest and turns each in or out. */
  follow(eye: THREE.Vector3, focal: number, dt: number): void;
  /** Holds form `form` in a slot, turned in, until the returned release: the swap test stands one copy of it alone. */
  hold(form: number): Promise<() => void>;
  /** Resolves once nothing is being brought or turned. */
  settled(): Promise<void>;
  /** What the slots hold, for reports. */
  stats(): FarStreamStats;
}

export interface FarStreamStats {
  readonly slots: number;
  /** Forms holding a slot, and those of them turned all the way in. */
  readonly held: number;
  readonly turnedIn: number;
  /** Forms with copies a view would draw far, and how many of those copies draw as cards now. */
  readonly wanted: number;
  readonly farCopies: number;
  readonly carded: number;
  /** Forms brought from the store and baked since the world opened, and milliseconds spent bringing them. */
  readonly read: number;
  readonly baked: number;
  readonly ms: number;
  /** GPU memory the slots take, bytes. */
  readonly bytes: number;
}

interface Form {
  slot: number;
  /** How far it has turned in, 0 none to 1 its own swap size, and which way it is turning. */
  turn: number;
  target: 0 | 1;
  weight: number;
  key: string | null;
  held: number;
  /** Whether bringing it failed: it keeps its full form and is not asked for again. */
  failed: boolean;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Streams `forms`' far forms into their cards' slots, reading and storing
 * them in `store`, baking at `pace` until the world shows and at `walking`
 * after.
 */
export function createFarStream(renderer: THREE.WebGLRenderer, forms: FarForms, store: Promise<FarStore | null>, pace: { readonly opening: BakePace; readonly walking: BakePace }): FarStream {
  let slots = 0;
  const state: Form[] = [];
  /** Which form each slot holds, -1 for none; made when the stream opens, with no more slots than forms. */
  let owner: number[] = [];
  let opened = false;
  let bringing: Promise<void> | null = null;
  let sinceWeighed = Number.POSITIVE_INFINITY;
  const weighedAt = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  let read = 0;
  let baked = 0;
  let ms = 0;
  const waiting: (() => void)[] = [];
  /** Whether what the slots should hold may have changed since it was last decided: a weighing, a form brought, a slot freed. */
  let undecided = true;

  const formOf = (k: number): Form => {
    while (state.length <= k) state.push({ slot: -1, turn: 0, target: 0, weight: 0, key: null, held: 0, failed: false });
    return state[k] as Form;
  };
  /** The crown span form `k`'s copies turn far at, turned `t` of the way in: from where no card draws (the band's top at a crown too small to see) to its own. */
  const swapAt = (k: number, t: number): number => {
    const px = (forms.plants[k] as (typeof forms.plants)[number]).px;
    if (t <= 0) return 0;
    if (t >= 1) return px;
    const least = GONE.end / FAR.band;
    return least * (px / least) ** t;
  };
  const show = (k: number): void => {
    const f = formOf(k);
    forms.set(k, f.slot, swapAt(k, f.turn));
  };

  /** Brings form `k`'s far form into `slot`: read from the store, else baked and stored. */
  async function bring(k: number, slot: number): Promise<void> {
    const t0 = performance.now();
    const f = formOf(k);
    const entry = forms.plants[k];
    if (entry === undefined) throw new Error(`No far form ${k}; there are ${forms.count}.`);
    const kept = await store;
    let plant = entry.plant;
    if (f.key === null) {
      plant ??= await entry.again();
      f.key = contentHash(plant.parts, plant.motion, plant.palette, entry.px);
    }
    const data = (await kept?.get(f.key).catch(() => undefined)) as FarFormData | undefined;
    const stored = data === undefined ? null : farFormFrom(data);
    let form: FarForm;
    if (stored !== null) {
      form = stored;
      read++;
    } else {
      plant ??= await entry.again();
      const bake = startFarBake(renderer, plant, entry.px);
      await bake.ready;
      for (;;) {
        const p = opened ? pace.walking : pace.opening;
        const done = bake.step(p.ms, p.views);
        if (done !== null) {
          form = done;
          break;
        }
        await nextFrame();
      }
      baked++;
    }
    if (stored !== null && opened) {
      // Read while the world shows, its atlases upload one a frame, so no frame takes them all.
      for (const layer of form.atlas.layers.keys()) {
        forms.cards.fill(renderer, slot, form, layer);
        await nextFrame();
      }
    } else forms.cards.fill(renderer, slot, form);
    if (stored === null && kept !== null) {
      // A failed write only means the build bakes again next time.
      const key = f.key;
      void farFormData(renderer, form)
        .then((d) => kept.put(key, d))
        .catch(() => undefined)
        .finally(() => form.dispose());
    } else form.dispose();
    // Its build goes once its form is made; a later bake makes it again.
    entry.plant = null;
    ms += performance.now() - t0;
  }

  /** Starts bringing form `k` into a free slot, turning in from nothing once it is there (or at once, before the world shows). */
  const start = (k: number, slot: number, instant: boolean): Promise<void> => {
    const f = formOf(k);
    owner[slot] = k;
    f.slot = -2;
    const run = bring(k, slot).then(
      () => {
        f.slot = slot;
        f.turn = instant ? 1 : 0;
        f.target = 1;
        show(k);
        undecided = true;
      },
      (error: unknown) => {
        owner[slot] = -1;
        f.slot = -1;
        f.failed = true;
        undecided = true;
        console.warn(`far forms: form ${k} could not be brought and draws its full form`, error);
      },
    );
    bringing = run.finally(() => {
      bringing = null;
    });
    return run;
  };

  /** Every form by weight, heaviest first: a form already holding a slot counts `outweigh` times, so only a much heavier one takes it. */
  const ranked = (): number[] => {
    const score = (k: number): number => {
      const f = formOf(k);
      return f.held > 0 ? Number.POSITIVE_INFINITY : f.slot !== -1 && f.target === 1 ? f.weight * FAR_TURN.outweigh + 1 : f.weight;
    };
    return Array.from({ length: forms.count }, (_, k) => k)
      .filter((k) => !formOf(k).failed && (formOf(k).weight > 0 || formOf(k).held > 0))
      .sort((a, b) => score(b) - score(a) || a - b);
  };

  const weigh = (eye: THREE.Vector3, focal: number): void => {
    const weights = forms.weigh(eye, focal);
    weights.forEach((w, k) => (formOf(k).weight = w));
    sinceWeighed = 0;
    undecided = true;
    weighedAt.x = eye.x;
    weighedAt.y = eye.y;
    weighedAt.z = eye.z;
  };

  /**
   * Turns out, lightest first, as many forms the slots no longer hold for as
   * wanted forms wait for a slot, keeping the rest turned in; and starts
   * bringing the heaviest wanted form into a free slot.
   */
  const decide = (): void => {
    const want = new Set(ranked().slice(0, slots));
    const lacking = [...want].filter((k) => formOf(k).slot === -1).length;
    let freeing = Math.max(0, lacking - owner.filter((o) => o === -1).length);
    const unwanted = state.flatMap((f, k) => (f.slot >= 0 && !want.has(k) ? [k] : [])).sort((a, b) => formOf(a).weight - formOf(b).weight || a - b);
    for (const k of unwanted) {
      formOf(k).target = freeing > 0 ? 0 : 1;
      freeing--;
    }
    for (const k of want) if (formOf(k).slot >= 0) formOf(k).target = 1;
    if (bringing !== null) return;
    const free = owner.indexOf(-1);
    if (free < 0) return;
    for (const k of want) {
      if (formOf(k).slot === -1) {
        void start(k, free, false);
        return;
      }
    }
  };

  /** Moves every form in a slot `dt` seconds along its turn, and frees the slot of one turned all the way out. */
  const turn = (dt: number): boolean => {
    let moving = false;
    const step = dt / FAR_TURN.seconds;
    for (const [k, f] of state.entries()) {
      if (f.slot < 0) continue;
      const was = f.turn;
      f.turn = f.target === 1 ? Math.min(1, f.turn + step) : Math.max(0, f.turn - step);
      if (f.turn !== f.target) moving = true;
      if (f.turn === 0 && f.target === 0) {
        owner[f.slot] = -1;
        f.slot = -1;
        forms.set(k, -1, 0);
        undecided = true;
      } else if (f.turn !== was) show(k);
    }
    return moving;
  };

  const idle = (moving: boolean): boolean => {
    if (moving || bringing !== null) return false;
    const want = ranked().slice(0, slots);
    // Nothing waits for a slot it would take: all wanted hold one, or none is free for them.
    return want.every((k) => formOf(k).slot >= 0) || !owner.includes(-1);
  };

  return {
    async open(eye, focal) {
      forms.cards.fit(forms.count);
      slots = forms.cards.slots;
      owner = Array.from({ length: slots }, () => -1);
      weigh(eye, focal);
      const want = ranked().slice(0, slots);
      for (const k of want) {
        const free = owner.indexOf(-1);
        if (free < 0) break;
        await start(k, free, true);
      }
      // Builds no slot holds are let go of; one wanted later is made again.
      for (const p of forms.plants) p.plant = null;
      opened = true;
    },
    follow(eye, focal, dt) {
      const moving = turn(dt);
      if (opened) {
        sinceWeighed += dt;
        if (sinceWeighed >= FAR_TURN.weighEvery || Math.hypot(eye.x - weighedAt.x, eye.y - weighedAt.y, eye.z - weighedAt.z) >= FAR_TURN.weighAfter) weigh(eye, focal);
        if (undecided && bringing === null) {
          undecided = false;
          decide();
        }
      }
      if (opened && waiting.length > 0 && idle(moving)) for (const wake of waiting.splice(0)) wake();
    },
    async hold(k) {
      const f = formOf(k);
      f.held++;
      if (f.slot === -1 && !owner.includes(-1)) {
        // The lightest form gives its slot up at once: the swap test hides every other copy while it runs.
        const lightest = ranked()
          .reverse()
          .find((j) => formOf(j).slot >= 0 && formOf(j).held === 0);
        if (lightest !== undefined) {
          const l = formOf(lightest);
          owner[l.slot] = -1;
          l.slot = -1;
          l.turn = 0;
          forms.set(lightest, -1, 0);
        }
      }
      // A held form outranks every other, so the next free slot brings it.
      undecided = true;
      while (f.slot < 0) {
        if (f.failed) throw new Error(`Far form ${k} could not be brought.`);
        if (bringing === null) decide();
        await (bringing ?? nextFrame());
      }
      f.turn = 1;
      f.target = 1;
      show(k);
      return () => {
        f.held = Math.max(0, f.held - 1);
      };
    },
    settled: () => new Promise((wake) => waiting.push(wake)),
    stats() {
      const inSlots = state.filter((f) => f.slot >= 0);
      const far = state.reduce((n, f) => n + f.weight, 0);
      return {
        slots,
        held: inSlots.length,
        turnedIn: inSlots.filter((f) => f.turn >= 1).length,
        wanted: state.filter((f) => f.weight > 0).length,
        farCopies: far,
        carded: inSlots.reduce((n, f) => n + f.weight, 0),
        read,
        baked,
        ms: Math.round(ms),
        bytes: forms.cards.bytes,
      };
    },
  };
}
