// Chooses which far forms get the card set's `FAR_SLOTS` slots. A world can
// show more builds than there are slots, so each form's weight is the number
// of its copies a view from the person would draw far, and the heaviest forms
// get the slots. A form without a slot keeps its full form on every copy.
//
// A form entering a slot is read from the far-form store, or baked a few views
// a frame and then stored. After the world opens, a form fades in or out by
// moving its `swapPx` between 0 and its own size over `FAR_TURN.seconds`, so
// each copy crosses the band as it would if the person walked away from it.

import type * as THREE from "three";
import { type FarForm, type FarFormData, farFormData, farFormFrom, startFarBake } from "@gaia/render";
import { contentHash, type FarStore } from "./far-store.ts";
import { FAR, type FarForms, GONE } from "./woods.ts";

/**
 * Timing for far form fades after the world opens. A fade takes `seconds` and
 * scales `swapPx` by the same ratio each frame (`swapAt`). Half a second of
 * fade changes `swapPx` by about 0.7%, which is less than the swap test's
 * smallest step, 5% farther from halfway through the full form's dissolve,
 * and less than the wind changes a crown in that time. The stream reweighs
 * the forms every `weighEvery` seconds or `weighAfter` meters walked. A form
 * with a slot keeps it until a form without one weighs `outweigh` times as
 * much, so a few copies crossing the band never trade slots.
 */
export const FAR_TURN = { seconds: 280, weighEvery: 0.5, weighAfter: 8, outweigh: 2 } as const;

/** A bake's budget per frame: at most `views` views of a form, within `ms` milliseconds. */
export interface BakePace {
  readonly views: number;
  readonly ms: number;
}

export interface FarStream {
  /**
   * Weighs the forms from `eye` and loads a form into every slot at full size
   * before the world shows. The loading screen waits on the returned promise.
   * `focal` is the view's device pixels per radian. Until it resolves,
   * `follow` only advances fades.
   */
  open(eye: THREE.Vector3, focal: number): Promise<void>;
  /** Runs every frame the world draws, with the frame's `dt` in seconds. It reweighs on `FAR_TURN`'s schedule, loads the heaviest forms and advances every fade. */
  follow(eye: THREE.Vector3, focal: number, dt: number): void;
  /** Keeps `form` in a slot at full size until the returned function releases it. The swap test uses it to show one copy alone. */
  hold(form: number): Promise<() => void>;
  /** Resolves once no form is loading or fading. */
  settled(): Promise<void>;
  /** Slot usage, for reports. */
  stats(): FarStreamStats;
}

export interface FarStreamStats {
  readonly slots: number;
  /** Forms with a slot, and how many of those are fully faded in. */
  readonly held: number;
  readonly turnedIn: number;
  /** Forms with copies a view would draw far, the count of those copies, and how many of them draw as cards now. */
  readonly wanted: number;
  readonly farCopies: number;
  readonly carded: number;
  /** Forms read from the store and forms baked since the stream opened, and milliseconds spent loading them. */
  readonly read: number;
  readonly baked: number;
  readonly ms: number;
  /** GPU memory the slots use, in bytes. */
  readonly bytes: number;
}

interface Form {
  slot: number;
  /** Fade progress from 0, no card, to 1, its own swap size, and the direction it is moving. */
  turn: number;
  target: 0 | 1;
  weight: number;
  key: string | null;
  held: number;
  /** Whether loading it failed. A failed form keeps its full form and is not loaded again. */
  failed: boolean;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Streams `forms`' far forms into the cards' slots, reading and storing them
 * in `store`. Bakes run at `pace.opening` until the world opens and at
 * `pace.walking` after.
 */
export function createFarStream(renderer: THREE.WebGLRenderer, forms: FarForms, store: Promise<FarStore | null>, pace: { readonly opening: BakePace; readonly walking: BakePace }): FarStream {
  let slots = 0;
  const state: Form[] = [];
  /** The form in each slot, or -1. `open` creates it after `fit` sizes the slots, with no more slots than forms. */
  let owner: number[] = [];
  let opened = false;
  let bringing: Promise<void> | null = null;
  let sinceWeighed = Number.POSITIVE_INFINITY;
  const weighedAt = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  let read = 0;
  let baked = 0;
  let ms = 0;
  const waiting: (() => void)[] = [];
  /** Whether a reweigh, a finished load or a freed slot may have changed which forms should have slots since `decide` last ran. */
  let undecided = true;

  const formOf = (k: number): Form => {
    while (state.length <= k) state.push({ slot: -1, turn: 0, target: 0, weight: 0, key: null, held: 0, failed: false });
    return state[k] as Form;
  };
  /**
   * The `swapPx` of form `k` at fade progress `t`. It rises geometrically from `GONE.end / FAR.band`, where the band's
   * top is too small to see and no card draws, to the form's own `px`.
   */
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

  /** Loads form `k`'s far form into `slot`, reading it from the store or else baking and storing it. */
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
      // After the world opens, a stored form uploads one atlas layer a frame, so no single frame uploads them all.
      for (const layer of form.atlas.layers.keys()) {
        forms.cards.fill(renderer, slot, form, layer);
        await nextFrame();
      }
    } else forms.cards.fill(renderer, slot, form);
    if (stored === null && kept !== null) {
      // A failed write only means the form bakes again on the next visit.
      const key = f.key;
      void farFormData(renderer, form)
        .then((d) => kept.put(key, d))
        .catch(() => undefined)
        .finally(() => form.dispose());
    } else form.dispose();
    // Drop the realized plant once its form is made. A later bake realizes it again with `again`.
    entry.plant = null;
    ms += performance.now() - t0;
  }

  /** Starts loading form `k` into the free `slot`. Once loaded it fades in from 0, or shows at full size when `instant`. */
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

  /**
   * Forms by weight, heaviest first. A held form ranks first, and a form with a slot counts `outweigh` times its
   * weight, so only a much heavier form takes the slot.
   */
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
   * Fades out the lightest forms that have a slot but no longer rank in the
   * top `slots`, one for each wanted form that no free slot can take, and
   * fades the rest back in. Then starts loading the heaviest wanted form that
   * has no slot into a free slot.
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

  /** Advances every slotted form's fade by `dt` seconds and frees the slot of a form fully faded out. Returns whether any fade still moves. */
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
    // Idle when no wanted form can still get a slot: all have one, or no slot is free.
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
      // Drop every realized plant. A form loaded later realizes its plant again.
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
        // Free the lightest form's slot at once without a fade, since the swap test hides every other copy while it runs.
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
      // A held form ranks first, so `decide` loads it into the next free slot.
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
