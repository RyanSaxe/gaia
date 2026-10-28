// The `window.__lab.terrain` hooks that scripted checks use to inspect and
// drive the world: what is placed and where the person is, walking and travel,
// live vitality, and what a frame draws or a step of walking changes. `pnpm
// probe`, `pnpm shots` and the proving ground's tour and capture scripts call
// them. They read the world's internals through `WorldInside`, and no
// user-facing code calls them.

import * as THREE from "three";
import { AIR, type Realized } from "@gaia/realize";
import type { Blueprint } from "@gaia/schema";
import { settleVitality } from "@gaia/render";
import { clearanceAt, fordBeside, footingAt, frameOf, groundHeightAt, heightAt, junctionVitality, placeAt, planTrip, stanceAt, standAt, lastSpotAt, type LastSpot, type Stride, TRAVEL, trailWay, travelFrom, travelStep, wadingAt, WALK_TO, walkStep, type Walker, waterDepthAt, wayVitalityAt, wayWear } from "@gaia/terrain";
import { groundVitality, sweep } from "@gaia/world";
import { contentHash } from "./far-store.ts";
import { CLIP } from "./land.ts";
import { COMPOSING } from "./looks.ts";
import { type Change, pictureChange, tallyFrame } from "./measure.ts";
import { type TourStop, tourStops } from "./tour.ts";
import { groundVitalityAt } from "./vitality.ts";
import { type Copies, type DetailMode, FAR, type FarOf, GONE, createCopies } from "./woods.ts";
import { composedName } from "./settlement.ts";
import { type FarSet, PAINTING, type Subject, type TreeVariant, type ViewPin, type WorldInside } from "./world.ts";

/** Meters in a step of walking, half a second at walking pace. The walk test uses the same step. */
const WALK_STEP = 0.7;
/** One step of the swap test: its change to the plant's part of the screen, the wind's change there, and the plant's distance. */
interface SwapStep {
  readonly change: Change;
  readonly wind: Change;
  readonly distance: number;
}
/**
 * Likeness test thresholds. A form covers a pixel when it changes one of the pixel's channels from the empty view by
 * more than `covered` 8-bit levels. The test compares the two forms in square cells `cells` times smaller than the
 * crown's span and at least `least` pixels across.
 */
const LIKENESS = { covered: 6, cells: 8, least: 2 } as const;
/** How one form draws over the crown's part of the screen. `area` is the share covered, and `ink` is the mean change from the empty view in 8-bit levels. */
interface FormDrawn {
  readonly area: number;
  readonly ink: number;
}
/** One size of the likeness test: the crown's span and distance, how each form draws, and how much the card differs from the full form. */
interface LikenessSize {
  readonly px: number;
  readonly distance: number;
  readonly card: FormDrawn;
  readonly full: FormDrawn;
  readonly unlike: number;
  readonly pictures?: { readonly empty: string; readonly card: string; readonly full: string };
}

/** Returns every hook of `window.__lab.terrain`, which read and drive `world`. */
export function worldHooks(world: WorldInside): Readonly<Record<string, unknown>> {
  /** The single copy the swap and likeness tests show for each preset, keyed by `FarOf` because tree and bush forms are numbered separately. */
  const swapCopies = new Map<FarOf, Copies>();

  /** The region of the lattice sample nearest (x, z). */
  function regionAt(x: number, z: number): number {
    const l = world.terrain.lattice;
    const ix = Math.round((x - l.origin) / l.spacing);
    const iz = Math.round((z - l.origin) / l.spacing);
    return world.terrain.region[Math.max(0, Math.min(l.n - 1, iz)) * l.n + Math.max(0, Math.min(l.n - 1, ix))] ?? 0;
  }

  /** The tour stops of the current world, each with where to stand and which way to look (`tourStops`). */
  function tour(): TourStop[] {
    // A file's grove is the trees of its definitions.
    const groves = new Map<string, { x: number; z: number; trees: number }>();
    for (const t of world.trees) {
      const file = world.treeFile(t);
      if (file === undefined) continue;
      const g = groves.get(file) ?? { x: 0, z: 0, trees: 0 };
      groves.set(file, { x: g.x + t.x, z: g.z + t.z, trees: g.trees + 1 });
    }
    const patches = world.code?.world.patches ?? [];
    const patchOf = new Map(patches.map((p) => [p.path, p]));
    const own = groundVitality(patches.map((p) => ({ area: p.area, vitality: p.vitality, size: p.radius * p.radius })));
    return tourStops({
      things: [
        ...world.settlement.buildings.map((b) => {
          const front = world.settlement.readingSpotOf(b);
          const d = Math.hypot(front.x - b.site.x, front.z - b.site.z) || 1;
          return { as: "building" as const, kind: b.kindName, name: b.represented.id || b.represented.name, x: b.site.x, z: b.site.z, vitality: world.thingVitality.get(b.represented.id) ?? 1, reach: Math.hypot(b.plan.width, b.plan.depth) / 2, front: { x: (front.x - b.site.x) / d, z: (front.z - b.site.z) / d } };
        }),
        ...world.ways.sites.map((s, i) => {
          const turn = world.landmarkViews[i]?.object.rotation.y ?? 0;
          const entity = world.landmarkEntity(i);
          return { as: "landmark" as const, kind: world.landmarks[s.landmark]?.name ?? "Landmark", name: entity.id || entity.name, x: s.site.x, z: s.site.z, vitality: world.thingVitality.get(entity.id) ?? 1, reach: world.landmarks[s.landmark]?.base ?? 4, front: { x: Math.sin(turn), z: Math.cos(turn) } };
        }),
      ],
      network: world.ways.network,
      wayVitality: (way, along) => wayVitalityAt(world.ways.network, way, along, world.vitalityOfPlace),
      junctionVitality: (j) => junctionVitality(world.ways.network, j, world.vitalityOfPlace),
      areas: (world.code?.world.areas ?? []).map((a) => ({ path: a.path, x: a.x, z: a.z, ground: a.ground, depth: a.depth, vitality: own.get(a.path) ?? 1 })),
      groves: [...groves].map(([path, g]) => ({ path, x: g.x / g.trees, z: g.z / g.trees, trees: g.trees, vitality: patchOf.get(path)?.vitality ?? 1 })),
      ponds: world.terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
      standable: world.standable,
    });
  }

  // ---------- measuring: what a step of walking changes, and walking as a person would ----------

  /** Draws `settle` frames at this instant, without time passing, and returns the last one's pixels. */
  function grabFrame(settle = 2): Uint8Array {
    const now = performance.now();
    for (let k = 0; k < settle; k++) world.frame(0, now, world.hour);
    const gl = world.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  function frameChange(a: Uint8Array, b: Uint8Array): Change {
    const gl = world.renderer.getContext();
    return pictureChange(a, b, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  /**
   * The walk test. From the person's spot, walks `meters` along the view in
   * steps of `step` meters with the wind's clock frozen at `at` seconds. At
   * each step the view stays fixed and only the detail center (`detailPin`)
   * moves one step on, so the measured change is exactly what the step does
   * to the detail drawn: levels, thinning, the grass and the ground's rings.
   * The reference is the wind's change over half a second, which people see
   * all the time. The test samples it every `windEvery` steps, each sample
   * 1.7 s later on the wind's clock, so the samples cover lulls and gusts.
   * Returns each step's [meters walked, mean, worst block] and the wind's
   * worst blocks.
   */
  function walkSteps(meters: number, step: number, at = world.light.uTime.value, windEvery = 10): { steps: [number, number, number][]; wind: number[] } {
    const start = { x: world.walker.x, z: world.walker.z, yaw: world.walker.yaw, pitch: world.walker.pitch };
    const was = world.frozen;
    const t = at;
    const dx = -Math.sin(start.yaw);
    const dz = -Math.cos(start.yaw);
    const steps: [number, number, number][] = [];
    const wind: number[] = [];
    try {
      for (let k = 0; (k + 1) * step <= meters; k++) {
        world.walkTo(start.x + dx * k * step, start.z + dz * k * step, start.yaw, start.pitch);
        world.frozen = t;
        world.detailPin = { x: world.walker.x, z: world.walker.z };
        const here = grabFrame();
        if (k % windEvery === 0) {
          const moment = t + (k / windEvery) * 1.7;
          world.frozen = moment;
          const before = grabFrame();
          world.frozen = moment + 0.5;
          wind.push(frameChange(before, grabFrame()).worst);
          world.frozen = t;
        }
        world.detailPin = { x: world.walker.x + dx * step, z: world.walker.z + dz * step };
        const on = frameChange(here, grabFrame());
        steps.push([k * step, on.mean, on.worst]);
      }
    } finally {
      world.detailPin = null;
      world.frozen = was;
      world.walkTo(start.x, start.z, start.yaw, start.pitch);
    }
    return { steps, wind };
  }

  /**
   * The ramp test. With the wind's clock frozen, ramps vitality from `from` to
   * `to` over `seconds`, calling `set` once a frame at `fps`. Each frame
   * advances time so the change eases in. It then keeps `to` for `hold` more
   * seconds while the easing settles, and measures what each frame changes.
   * The reference is the wind's change over half a second at the same view,
   * measured at rest at the start, middle and end vitality, at three moments
   * 1.7 s apart each. Returns each frame's [vitality, mean, worst block], the
   * wind's worst blocks, and the frames listed in `snaps` as JPEG data URLs.
   * Frame 0 is the rest frame before the ramp, and later numbers count
   * through the ramp and the hold.
   */
  function vitalityRamp(set: (v: number) => void, seconds = 6, from = 0.05, to = 0.95, fps = 60, snaps: readonly number[] = [], hold = 0): { steps: [number, number, number][]; wind: number[]; snaps: Record<number, string> } {
    const was = world.frozen;
    const t = world.light.uTime.value;
    const steps: [number, number, number][] = [];
    const wind: number[] = [];
    const shots: Record<number, string> = {};
    try {
      for (const v of [from, (from + to) / 2, to]) {
        set(v);
        settleVitality();
        for (let j = 0; j < 3; j++) {
          world.frozen = t + j * 1.7;
          const before = grabFrame();
          world.frozen = t + j * 1.7 + 0.5;
          wind.push(frameChange(before, grabFrame()).worst);
        }
      }
      world.frozen = t;
      set(from);
      settleVitality();
      let before = grabFrame();
      if (snaps.includes(0)) shots[0] = world.renderer.domElement.toDataURL("image/jpeg", 0.92);
      const frames = Math.round(seconds * fps);
      for (let k = 1; k <= frames + Math.round(hold * fps); k++) {
        const v = from + ((to - from) * Math.min(k, frames)) / frames;
        if (k <= frames) set(v);
        // Advance one frame of time so the change eases in. The wind's clock stays frozen.
        world.frame(1 / fps, performance.now(), world.hour);
        const now = grabFrame(1);
        if (snaps.includes(k)) shots[k] = world.renderer.domElement.toDataURL("image/jpeg", 0.92);
        const change = frameChange(before, now);
        steps.push([+v.toFixed(4), change.mean, change.worst]);
        before = now;
      }
    } finally {
      world.frozen = was;
    }
    return { steps, wind, snaps: shots };
  }

  /** Draws the view fixed at `pin`, with detail chosen from there and streaming paused, and returns its pixels. */
  function heldView(pin: ViewPin): Uint8Array {
    world.viewPin = pin;
    world.detailPin = { x: pin.x, z: pin.z };
    world.streamPaused = true;
    try {
      return grabFrame(1);
    } finally {
      world.viewPin = null;
      world.detailPin = null;
      world.streamPaused = false;
    }
  }

  /**
   * The travel test. Places the person at (x0, z0) once the land and
   * everything on it has loaded, then sends them to the landing nearest
   * (x1, z1) at `pace` meters a second along the tread. It drives the frames
   * itself in real time with the wind's clock frozen. Every `every` frames it
   * redraws the earlier view from the same pin and detail center, so the
   * measured change is only what streaming did in between: land windows
   * moving and tiles appearing. Each frame's work is timed to the GPU's
   * finish. Returns the trip's length and seconds, the time to set off and
   * the time spent waiting on the way ahead, each check's [meters along,
   * pace, mean change, worst block, moved land levels as bits, water depth
   * under the person, how far the mirror plane moved, pinned x, pinned z],
   * the frames' work in milliseconds, the land's smallest lead, every tile
   * placed within sight of the person, and the largest gap between
   * `waterDepthAt` and the land's water level (`ghosts`).
   */
  async function travelTest(x0: number, z0: number, x1: number, z1: number, pace: number, every = 3, cap = 400, pitch = -0.05) {
    // Start at a landing, since the given point may be inside a thing.
    const start = world.landingNear(x0, z0) ?? { x: x0, z: z0 };
    x0 = start.x;
    z0 = start.z;
    world.walkTo(x0, z0, 0, pitch);
    await Promise.all([world.land.around(x0, z0), world.thingTiles.ready(x0, z0)]);
    const at = world.landingNear(x1, z1);
    world.travelPace = pace;
    const started = at !== null && world.travelTo(at, false);
    world.travelPace = TRAVEL.pace;
    const t = world.trip;
    if (!started || t === null) return null;
    const gl = world.renderer.getContext();
    const pixel = new Uint8Array(4);
    const was = world.frozen;
    world.frozen = world.light.uTime.value;
    world.driving = true;
    world.thingTiles.late();
    const checks: [number, number, number, number, number, number, number, number, number][] = [];
    /** Each land level's window origin, to find which levels moved since `held`'s view was drawn. */
    const windows = (): string => world.land.origins.map((o) => `${o.x},${o.z}`).join(" ");
    const work: number[] = [];
    let lead = Infinity;
    let ended = Number.NaN;
    let held: { pin: ViewPin; image: Uint8Array; s: number; windows: string; mirror: number } | null = null;
    /** The largest difference in meters between the depth walking reads and the land's water level under the person. */
    let ghosts = 0;
    let last = performance.now();
    try {
      for (let k = 0; world.trip === t && performance.now() - t.began < cap * 1000; k++) {
        // Yield so worker replies arrive between frames, as they do in the app.
        await new Promise((r) => setTimeout(r, 0));
        if (held === null && k % every === 0) {
          const pin = { x: world.walker.x, z: world.walker.z, eye: world.walker.eye, yaw: world.walker.yaw, pitch: world.walker.pitch };
          held = { pin, image: heldView(pin), s: t.at.s, windows: windows(), mirror: world.water.stats().mirrorLevel };
        }
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const w0 = performance.now();
        world.frame(dt, now, world.hour);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        work.push(+(performance.now() - w0).toFixed(2));
        if (world.trip !== t) ended = performance.now();
        if (t.at.s > 60 && t.at.s < t.plan.length - 60) {
          const spacing = frameOf(world.terrain.spec).spacing;
          const o = world.land.origins[0] as { x: number; z: number };
          lead = Math.min(lead, world.walker.x - o.x * spacing, (o.x + CLIP.size) * spacing - world.walker.x, world.walker.z - o.z * spacing, (o.z + CLIP.size) * spacing - world.walker.z);
        }
        if (held !== null && (k % every === every - 1 || world.trip !== t)) {
          const change = frameChange(held.image, heldView(held.pin));
          const before = held.windows.split(" ");
          const moved = windows()
            .split(" ")
            .reduce((bits, w, k) => (w === before[k] ? bits : bits | (1 << k)), 0);
          // The water depth under the person, from the land's own water level. Wading spreads rings.
          const level = heightAt(world.terrain.lattice, world.walker.x, world.walker.z, world.terrain.waterLevel);
          const depth = level > -500 ? Math.max(0, level - heightAt(world.terrain.lattice, world.walker.x, world.walker.z)) : 0;
          // The water's mirror plane follows the person's eye, not the pinned view's, so record how far it moved between the two draws.
          const mirrored = +(world.water.stats().mirrorLevel - held.mirror).toFixed(3);
          // Compare the depth walking reads (`waterDepthAt`) with the depth from the land's water level above.
          const cached = waterDepthAt(world.terrain, world.walker.x, world.walker.z);
          ghosts = Math.max(ghosts, Math.abs(cached - depth));
          checks.push([+held.s.toFixed(1), +t.at.v.toFixed(1), +change.mean.toFixed(3), +change.worst.toFixed(2), moved, +depth.toFixed(2), mirrored, Math.round(held.pin.x), Math.round(held.pin.z)]);
          held = null;
        }
      }
    } finally {
      world.driving = false;
      world.frozen = was;
      // End a trip that the test stopped early where it is.
      if (world.trip === t) world.trip = null;
    }
    return {
      pace,
      length: Math.round(t.plan.length),
      seconds: +(((Number.isNaN(ended) ? performance.now() : ended) - t.began) / 1000).toFixed(1),
      setOff: t.setOff === null ? null : Math.round(t.setOff - t.began),
      waited: +t.waited.toFixed(1),
      lead: Math.round(lead),
      checks,
      work,
      late: world.thingTiles.late(),
      ghosts: +ghosts.toFixed(2),
    };
  }

  /** Every build with a far form, named from its parts: the world's tree builds, then the understory's and the wild's. */
  const farPresets = (): readonly { readonly name: string; readonly plant: () => Realized; readonly far: FarOf }[] => {
    const named = new Map<string, number>();
    const unique = (name: string): string => {
      const n = (named.get(name) ?? 0) + 1;
      named.set(name, n);
      return n === 1 ? name : `${name} ${n}`;
    };
    return [
      ...world.treeBlueprints.map((bp, k) => ({ name: unique(composedName(bp)), plant: () => world.treeBuild(k), far: world.treeFar[k] as FarOf })),
      ...world.understory.farBuilds().map((b) => ({ name: unique(composedName(b.blueprint)), plant: b.plant, far: b.far })),
      ...world.wildGrowth.farBuilds().map((b) => ({ name: unique(composedName(b.blueprint)), plant: b.plant, far: b.far })),
    ];
  };

  /**
   * The swap test: whether a tree's or bush's change of form ever shows. One
   * copy of preset `name` (`farPresets`) at `vitality` is placed alone
   * straight ahead of the eye. With the wind's clock frozen, only the detail
   * center moves back, so the crown's span on screen shrinks. The steps are:
   * - `middle`: from halfway into the band to 5% farther, as the far form
   *   fades in over the full one;
   * - `whole`: across `swapPx`, where the far form starts to draw whole over
   *   the full one;
   * - `leaving`: from halfway through the full form's dissolve below the band
   *   (`FAR.leave`) to 5% farther;
   * - `end`: across the dissolve's end, the frame where the full form stops
   *   drawing and the far form draws alone;
   * - `dissolving`: from halfway through the `GONE` dissolve to one step of
   *   walking farther;
   * - `gone`: the step of walking across `GONE.end`, where the copy stops
   *   drawing.
   * The last two measure at least a 64-pixel block around the copy, as the
   * walk test does, since the crown spans only a few pixels. Each step is
   * compared with the wind's half-second change at the same spot, over the
   * plant's part of the screen. The grass and every other plant with a far
   * form are hidden while the test runs. A plant still too large to dissolve
   * where the air already hides it stays drawn and changes nothing. Returns
   * null when there is no such preset.
   */
  async function swapTest(name: string, vitality: number): Promise<{ middle: SwapStep; whole: SwapStep; leaving: SwapStep; end: SwapStep; dissolving: SwapStep; gone: SwapStep } | null> {
    const preset = farPresets().find((f) => f.name === name);
    if (preset === undefined) return null;
    // Keep its far form in a slot at full size while the test runs.
    const set = [world.treeSet, world.bushSet].find((s) => s.forms === preset.far.forms);
    if (set === undefined) throw new Error(`The swap test's ${name} belongs to no set of far forms.`);
    const release = await set.stream.hold(preset.far.form);
    const gl = world.renderer.getContext();
    const focal = gl.drawingBufferHeight / 2 / Math.tan(THREE.MathUtils.degToRad(world.camera.fov) / 2);
    let copy = swapCopies.get(preset.far);
    if (copy === undefined) {
      copy = createCopies(preset.plant(), world.light, [], preset.far);
      world.scene.add(copy.object);
      swapCopies.set(preset.far, copy);
    }
    const crown = copy.crown;
    const dx = -Math.sin(world.walker.yaw);
    const dz = -Math.cos(world.walker.yaw);
    const eye = world.camera.position.clone();
    const swapPx = FAR.swapPx * (preset.far.share ?? 1);
    const span = (f: number): number => swapPx * FAR.band - f * swapPx * (FAR.band - 1);
    const leavePx = swapPx / FAR.leave;
    const leaving = (g: number): number => swapPx - g * (swapPx - leavePx);
    const going = (g: number): number => GONE.start - g * (GONE.start - GONE.end);
    const others = world.instanced().filter((o) => o.far !== undefined);
    const hidden = others.map((o) => o.object.visible);
    const grassShown = world.grass.mesh.visible;
    for (const o of others) o.object.visible = false;
    world.grass.mesh.visible = false;
    world.swapping = copy;
    const was = world.frozen;
    const t = world.light.uTime.value;
    /** The distance at which the crown spans `px` device pixels. */
    const at = (px: number): number => (2 * crown.radius * focal) / px;
    /** Places the copy where its crown spans `from` pixels and measures moving the detail center back until it spans `to`. */
    const step = (stood: Copies, from: number, to: number): SwapStep => walk(stood, from, at(to) - at(from), 0);
    /**
     * Places the copy where its crown spans `from` pixels and measures moving the detail center back `back` meters,
     * over the crown's part of the screen and at least a `block`-pixel square around it.
     */
    const walk = (stood: Copies, from: number, back: number, block: number): SwapStep => {
      const distance = at(from);
      // Put the crown's center at eye height, straight ahead.
      stood.respot([{ x: eye.x + dx * distance - crown.center.x, y: eye.y - crown.center.y, z: eye.z + dz * distance - crown.center.z, yaw: 0, scale: 1, vitality }]);
      stood.setVitality(vitality);
      const corners = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => new THREE.Vector3(eye.x + dx * distance + sx * crown.radius, eye.y + sy * crown.radius, eye.z + dz * distance + sz * crown.radius).project(world.camera))));
      const px = corners.map((c) => ((c.x + 1) / 2) * gl.drawingBufferWidth);
      const py = corners.map((c) => ((c.y + 1) / 2) * gl.drawingBufferHeight);
      const [mx, my] = [(Math.min(...px) + Math.max(...px)) / 2, (Math.min(...py) + Math.max(...py)) / 2];
      const rect = [Math.floor(Math.min(...px, mx - block / 2)), Math.floor(Math.min(...py, my - block / 2)), Math.ceil(Math.max(...px, mx + block / 2)), Math.ceil(Math.max(...py, my + block / 2))] as const;
      const changeIn = (a: Uint8Array, b: Uint8Array): Change => pictureChange(a, b, gl.drawingBufferWidth, gl.drawingBufferHeight, 64, rect);
      world.frozen = t;
      world.detailPin = { x: eye.x, z: eye.z };
      const before = grabFrame(3);
      world.detailPin = { x: eye.x - dx * back, z: eye.z - dz * back };
      const change = changeIn(before, grabFrame(3));
      world.detailPin = { x: eye.x, z: eye.z };
      world.frozen = t + 0.5;
      const wind = changeIn(before, grabFrame(3));
      world.frozen = t;
      return { change, wind, distance };
    };
    try {
      copy.object.visible = true;
      return {
        middle: step(copy, span(0.5), span(0.55)),
        whole: step(copy, span(0.995), swapPx - 0.1),
        leaving: step(copy, leaving(0.5), leaving(0.55)),
        end: step(copy, leavePx + 0.1, leavePx - 0.1),
        // A crown too small to see dissolves over hundreds of meters, so each of these is one step of walking, measured over a block.
        dissolving: walk(copy, going(0.5), WALK_STEP, 64),
        gone: walk(copy, (2 * crown.radius * focal) / (at(GONE.end) - WALK_STEP / 2), WALK_STEP, 64),
      };
    } finally {
      release();
      world.swapping = null;
      copy.object.visible = false;
      others.forEach((o, i) => (o.object.visible = hidden[i] ?? true));
      world.grass.mesh.visible = grassShown;
      world.detailPin = null;
      world.frozen = was;
    }
  }

  /**
   * The likeness test: whether a far form looks like its full form wherever
   * it draws, not only where they swap. One copy of preset `name` at
   * `vitality` is placed alone straight ahead of the eye, with its form held
   * in a slot, at each crown span in `sizes`, in device pixels. The default
   * sizes are `swapPx` and a half, a quarter and an eighth of it, keeping
   * those above `GONE.start`. With the wind's clock frozen, each size draws
   * three ways: empty, the card alone and the full form alone. Only the sky
   * is behind the copy, and the air is clear (`uClearAir`), because both
   * forms pass through the same air, which would hide what they share. A size
   * whose crown lies past `AIR.dissolveEnd` draws in neither form and is
   * skipped. Each size reports, over the crown's part of the screen, each
   * form's covered `area` and `ink`, and `unlike`: the mean difference
   * between the two forms in cells of an eighth of the crown, divided by the
   * full form's own difference from the empty view. With `pictures`, it also
   * returns the three views of the crown as PNG data URLs. Returns null when
   * there is no such preset.
   */
  async function likenessTest(name: string, vitality: number, sizes?: readonly number[], pictures = false): Promise<{ name: string; vitality: number; swapPx: number; sizes: LikenessSize[] } | null> {
    const preset = farPresets().find((f) => f.name === name);
    if (preset === undefined) return null;
    const set = [world.treeSet, world.bushSet].find((s) => s.forms === preset.far.forms);
    if (set === undefined) throw new Error(`The likeness test's ${name} belongs to no set of far forms.`);
    const release = await set.stream.hold(preset.far.form);
    const forms = preset.far.forms;
    const form = preset.far.form;
    const slot = forms.slotOf(form);
    const swapPx = FAR.swapPx * (preset.far.share ?? 1);
    const gl = world.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(world.camera.fov) / 2);
    let copy = swapCopies.get(preset.far);
    if (copy === undefined) {
      copy = createCopies(preset.plant(), world.light, [], preset.far);
      world.scene.add(copy.object);
      swapCopies.set(preset.far, copy);
    }
    const stood = copy;
    const crown = stood.crown;
    const dx = -Math.sin(world.walker.yaw);
    const dz = -Math.cos(world.walker.yaw);
    const eye = world.camera.position.clone();
    // Leave only the sky behind the copy, so nothing else hides it at any distance.
    const keep = new Set<THREE.Object3D>([world.sky.mesh, stood.object, world.treeSet.forms.cards.object, world.bushSet.forms.cards.object]);
    const hidden = [...world.scene.children.filter((o) => o.visible && !keep.has(o) && !(o as THREE.Light).isLight), ...world.instanced().flatMap((o) => (o.object.visible && o !== stood ? [o.object] : []))];
    for (const o of hidden) o.visible = false;
    world.swapping = stood;
    const was = world.frozen;
    world.frozen = world.light.uTime.value;
    world.detailPin = { x: eye.x, z: eye.z };
    world.light.uClearAir.value = 1;
    const picture = (pixels: Uint8Array, [x0, y0, x1, y1]: readonly [number, number, number, number]): string => {
      const out = document.createElement("canvas");
      out.width = x1 - x0;
      out.height = y1 - y0;
      const ctx = out.getContext("2d") as CanvasRenderingContext2D;
      const image = ctx.createImageData(out.width, out.height);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const from = (y * width + x) * 4;
          image.data.set([pixels[from] as number, pixels[from + 1] as number, pixels[from + 2] as number, 255], ((y1 - 1 - y) * out.width + (x - x0)) * 4);
        }
      }
      ctx.putImageData(image, 0, 0);
      return out.toDataURL("image/png");
    };
    const measure = (px: number): LikenessSize | null => {
      const distance = (2 * crown.radius * focal) / px;
      if (distance - crown.radius >= AIR.dissolveEnd) return null;
      stood.respot([{ x: eye.x + dx * distance - crown.center.x, y: eye.y - crown.center.y, z: eye.z + dz * distance - crown.center.z, yaw: 0, scale: 1, vitality }]);
      stood.setVitality(vitality);
      settleVitality();
      const corners = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => new THREE.Vector3(eye.x + dx * distance + sx * crown.radius, eye.y + sy * crown.radius, eye.z + dz * distance + sz * crown.radius).project(world.camera))));
      const xs = corners.map((c) => ((c.x + 1) / 2) * width);
      const ys = corners.map((c) => ((c.y + 1) / 2) * height);
      const rect = [Math.max(0, Math.floor(Math.min(...xs)) - 2), Math.max(0, Math.floor(Math.min(...ys)) - 2), Math.min(width, Math.ceil(Math.max(...xs)) + 2), Math.min(height, Math.ceil(Math.max(...ys)) + 2)] as const;
      stood.object.visible = false;
      const empty = grabFrame(3);
      stood.object.visible = true;
      // Draw the card alone by raising the form's swap size well above this span for now, so the full form stops drawing.
      forms.set(form, slot, Math.max(swapPx, px * FAR.leave * 1.25));
      const card = grabFrame(3);
      forms.set(form, slot, swapPx);
      stood.detail = "full";
      const full = grabFrame(3);
      stood.detail = "auto";
      const [x0, y0, x1, y1] = rect;
      const drawn = (pixels: Uint8Array): FormDrawn => {
        let covered = 0;
        let ink = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            const r = Math.abs((pixels[i] as number) - (empty[i] as number));
            const g = Math.abs((pixels[i + 1] as number) - (empty[i + 1] as number));
            const b = Math.abs((pixels[i + 2] as number) - (empty[i + 2] as number));
            if (Math.max(r, g, b) > LIKENESS.covered) covered++;
            ink += (r + g + b) / 3;
          }
        }
        const area = (x1 - x0) * (y1 - y0);
        return { area: +(covered / area).toFixed(4), ink: +(ink / area).toFixed(3) };
      };
      const side = Math.max(LIKENESS.least, Math.round(px / LIKENESS.cells));
      const cols = Math.ceil((x1 - x0) / side);
      /** Each cell's summed red, green and blue, and its pixel count. */
      const cells = (pixels: Uint8Array): Float64Array => {
        const sums = new Float64Array(cols * Math.ceil((y1 - y0) / side) * 4);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const k = (Math.floor((y - y0) / side) * cols + Math.floor((x - x0) / side)) * 4;
            const i = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) sums[k + c] = (sums[k + c] as number) + (pixels[i + c] as number);
            sums[k + 3] = (sums[k + 3] as number) + 1;
          }
        }
        return sums;
      };
      /** The mean difference of two pictures' cells, in 8-bit levels. */
      const apart = (a: Float64Array, b: Float64Array): number => {
        let sum = 0;
        let n = 0;
        for (let k = 0; k < a.length; k += 4) {
          const count = a[k + 3] as number;
          if (count === 0) continue;
          sum += (Math.abs((a[k] as number) - (b[k] as number)) + Math.abs((a[k + 1] as number) - (b[k + 1] as number)) + Math.abs((a[k + 2] as number) - (b[k + 2] as number))) / 3 / count;
          n++;
        }
        return n === 0 ? 0 : sum / n;
      };
      const [e, c, f] = [cells(empty), cells(card), cells(full)];
      const tree = apart(f, e);
      return {
        px,
        distance: +distance.toFixed(1),
        card: drawn(card),
        full: drawn(full),
        unlike: +(tree > 0 ? apart(c, f) / tree : 0).toFixed(3),
        ...(pictures ? { pictures: { empty: picture(empty, rect), card: picture(card, rect), full: picture(full, rect) } } : {}),
      };
    };
    try {
      const spans = sizes ?? [1, 2, 4, 8].map((k) => swapPx / k).filter((px) => px > GONE.start);
      return { name, vitality, swapPx, sizes: spans.flatMap((px) => measure(px) ?? []) };
    } finally {
      release();
      forms.set(form, slot, swapPx);
      stood.detail = "auto";
      world.light.uClearAir.value = 0;
      world.swapping = null;
      stood.object.visible = false;
      for (const o of hidden) o.visible = true;
      world.detailPin = null;
      world.frozen = was;
    }
  }

  /**
   * Walks for `seconds` of real time as a person would: forward throughout,
   * turning the view about 70° left or right over half a second every 2.5 s,
   * as a dragging hand does, and running with Shift a third of the time. The
   * app's smoothness probe (`__lab.smoothness()`) reads the frames.
   */
  function wander(seconds: number): Promise<{ x: number; z: number }> {
    return new Promise((done) => {
      const t0 = performance.now();
      let turned = -1;
      let last = t0;
      const tick = (now: number): void => {
        const t = (now - t0) / 1000;
        const beat = Math.floor(t / 2.5);
        if (t >= seconds) {
          world.release();
          done({ x: world.walker.x, z: world.walker.z });
          return;
        }
        if (beat !== turned) {
          turned = beat;
          world.press("KeyW");
          if (beat % 3 === 0) world.press("ShiftLeft");
          else world.release("ShiftLeft");
        }
        if (beat > 0 && t - beat * 2.5 < 0.5) world.walker.yaw += ((beat % 2 === 1 ? 1.2 : -1.2) * (now - last)) / 1000 / 0.5;
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** A far form set's slot usage as plain numbers, for reports. */
  const farCards = (set: FarSet): Record<string, number> => {
    const st = set.stream.stats();
    return { slots: st.slots, forms: set.forms.count, held: st.held, turnedIn: st.turnedIn, mb: Math.round(st.bytes / 2 ** 20), wanted: st.wanted, farCopies: st.farCopies, carded: st.carded, read: st.read, baked: st.baked };
  };

  return {
    /**
     * Shows sky `k` of the sweep over every light, sky and wind Jev composes skies from (`sweep`), until the next world
     * opens. The proving ground uses sky 0. Returns how many skies the sweep has.
     */
    sky: (k: number): number => {
      const skies = sweep(COMPOSING.world, COMPOSING.lib).blueprints;
      const sky = skies[k];
      if (sky === undefined) throw new Error(`The sweep holds ${skies.length} skies, numbered from 0: there is no sky ${k}.`);
      world.skyWorld = sky;
      return skies.length;
    },
    /** Each placed landmark's name, site, height and triangles. */
    landmarks: () =>
      world.ways.sites.map((s, i) => ({ name: world.landmarks[s.landmark]?.name, ...s.site, height: world.landmarkViews[i]?.height, triangles: world.landmarkViews[i]?.triangles })),
    /** Sets the vitality of every landmark's entity, 0 to 1, which also changes the trails they join. */
    landmarkVitality: (v: number) => {
      world.setVitality(new Map(world.landmarkEntities.map((e) => [e.id, v])));
      for (const view of world.landmarkPool.values()) view.setVitality(v);
    },
    /**
     * Sets vitality live by a thing's path, or for every building or landmark entity with that name. It changes
     * everywhere the thing shows and the wear of every trail it joins.
     */
    entityVitality: (key: string, v: number) => {
      const named = [...world.settlement.buildings.map((b) => b.represented), ...world.landmarkEntities].filter((r) => r.name === key).map((r) => r.id);
      world.setVitality(new Map((world.thingVitality.has(key) ? [key] : named).map((id) => [id, v])));
    },
    /** Each trail, which is a dependency, with its ends, length and the ways it follows. */
    trails: () =>
      world.ways.network.trails.map((t) => ({
        id: t.id,
        from: { place: t.from, entity: world.entityOfPlace.get(t.from), vitality: world.vitalityOfPlace(t.from) },
        to: { place: t.to, entity: world.entityOfPlace.get(t.to), vitality: world.vitalityOfPlace(t.to) },
        length: Math.round(t.length),
        ways: t.ways.map((w) => w.way),
      })),
    /** Each way of tread: its ends, length, width, crossings, the trails that use it, its current wear and a point every 10 m. */
    ways: () =>
      world.ways.network.ways.map((w, i) => ({
        id: w.id,
        from: w.from,
        to: w.to,
        length: Math.round(w.length),
        width: +w.style.width.toFixed(2),
        crossing: w.style.crossing,
        crossings: w.crossings.map((c) => ({ x: Math.round(c.x), z: Math.round(c.z), span: +c.span.toFixed(1), yaw: +c.yaw.toFixed(2) })),
        carries: w.carries.map((c) => world.ways.network.trails[c.trail]?.id),
        wear: wayWear(world.ways.network, i, world.vitalityOfPlace).map((v) => +v.toFixed(2)),
        points: Array.from({ length: Math.ceil(w.points.length / 20) }, (_, k) => [Math.round(w.points[k * 20] ?? 0), Math.round(w.points[k * 20 + 1] ?? 0)]),
      })),
    /** Every building: what it represents, where it is, and its current vitality. */
    buildings: () =>
      world.settlement.buildings.map((b) => ({ name: b.represented.name, building: b.kindName, ...b.site, width: b.plan.width, depth: b.plan.depth, triangles: b.triangles, vitality: b.vitality, sign: world.settlement.signOf(b), readingSpot: world.settlement.readingSpotOf(b) })),
    /** Sets building `i`'s vitality, and its sign's. */
    vitality: (i: number, v: number) => {
      const b = world.settlement.buildings[i];
      if (b !== undefined) world.setVitality(new Map([[b.represented.id, v]]));
    },
    /** Walks up to subject `i` (buildings first, then trees) and shows its card on arrival. */
    inspect: (i: number) => {
      const s = world.subjects[i];
      if (s !== undefined) world.approach(s);
    },
    subjects: () => world.subjects.map((s) => ({ name: s.represented.name, formName: s.formName, ...(s.built === undefined ? {} : { built: s.built }), x: s.x, z: s.z, height: s.height, vitality: s.represented.vitality })),
    card: () => (world.shown === null ? null : { name: world.shown.name, what: world.shown.what }),
    closeCard: () => world.hideCard(),
    walk: (x: number, z: number, yawDeg: number, pitchDeg = -3) => world.walkTo(x, z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180),
    /** Sends the person to the landing nearest (x, z), as a pick on the map does, at `pace` along the tread or straight across. Returns false when neither route reaches it. */
    travel: (x: number, z: number, pace: number = TRAVEL.pace) => {
      const at = world.landingNear(x, z);
      world.travelPace = pace;
      const going = at !== null && world.travelTo(at, false);
      world.travelPace = TRAVEL.pace;
      return going;
    },
    /** How far inside each land level's window the person is, in meters, finest first. This is the land's lead, which a trip must not outrun. */
    landLead: () => {
      const spacing = frameOf(world.terrain.spec).spacing;
      return world.land.origins.map((o, k) => {
        const unit = spacing * 2 ** k;
        const lo = { x: o.x * unit, z: o.z * unit };
        const hi = { x: (o.x + CLIP.size) * unit, z: (o.z + CLIP.size) * unit };
        return Math.round(Math.min(world.walker.x - lo.x, hi.x - world.walker.x, world.walker.z - lo.z, hi.z - world.walker.z));
      });
    },
    /** Where a person sent to (x, z) would stand (`landingNear`), or null. */
    landingNear: (x: number, z: number) => world.landingNear(x, z),
    travelTest,
    /** Each tile placed within sight of the person since the last call (`Standing.late`), whose things could be seen appearing. */
    tilesLate: () => world.thingTiles.late(),
    /** The tiles each layer still waits for (`ThingTiles.pending`), and the land's workers. */
    tilesPending: () => ({ ...world.thingTiles.pending(), workers: world.land.workers() }),
    /** The walk's state: the held keys, whether a tap's walk or a trip is under way, and why the last trip ended. */
    walkState: () => ({ keys: [...world.keys], goal: world.goal !== null, trip: world.trip !== null, lastEnd: world.tripEnd }),
    /**
     * The trip under way, or null: distance along and total length, pace, whether the view follows the way, and how
     * many times its own pace it goes while paper hides the world (`hurry`).
     */
    trip: () => (world.trip === null ? null : { s: +world.trip.at.s.toFixed(1), length: Math.round(world.trip.plan.length), v: +world.trip.at.v.toFixed(2), going: world.trip.at.going, follows: world.trip.at.follows, stopping: world.trip.stopping, hurry: world.trip.hurry === null ? null : +world.trip.hurry.toFixed(2), unready: world.trip.marks.filter((m) => !m.ready).length, asked: world.trip.marks.filter((m) => m.asked).length, yaw: +world.trip.at.yaw.toFixed(2) }),
    /**
     * Plans a trip from (x0, z0) to the landing nearest (x1, z1) and steps it
     * at 60 frames a second without moving the person. Returns its length,
     * how much of it is on the tread and how long it takes.
     */
    tripTime: (x0: number, z0: number, x1: number, z1: number) => {
      // Start at a landing, since the given point may be inside a thing.
      const start = world.landingNear(x0, z0) ?? { x: x0, z: z0 };
      x0 = start.x;
      z0 = start.z;
      const at = world.landingNear(x1, z1);
      const t0 = performance.now();
      const chosen = at === null ? null : world.travelWay({ x: x0, z: z0 }, at);
      const planMs = Math.round(performance.now() - t0);
      if (at === null || chosen === null) return null;
      const plan = planTrip(fordBeside(world.terrain, chosen.way, world.broken), chosen.off, null, TRAVEL.pace, (x, z) => wadingAt(world.terrain, world.decks, x, z));
      let t = travelFrom(plan, plan.heading[0] as number);
      let seconds = 0;
      while (!t.done && seconds < 3600) {
        t = travelStep(plan, t, 1 / 60, t.yaw);
        seconds += 1 / 60;
      }
      const tread = trailWay(world.ways.network, { x: x0, z: z0 }, at);
      const trails = tread === null ? null : Math.round(tread.reduce((sum, p, i) => (i === 0 ? Math.hypot(p.x - x0, p.z - z0) : sum + Math.hypot(p.x - (tread[i - 1] as Walker).x, p.z - (tread[i - 1] as Walker).z)), 0) + Math.hypot((tread[tread.length - 1] as Walker).x - at.x, (tread[tread.length - 1] as Walker).z - at.z));
      const end = chosen.way[chosen.way.length - 1] as Walker;
      return { by: chosen.by, planMs, gap: Math.round(Math.hypot(end.x - at.x, end.z - at.z)), off: [Math.round(chosen.off.start), Math.round(chosen.off.end)], straight: Math.round(Math.hypot(at.x - x0, at.z - z0)), length: Math.round(plan.length), trails, seconds: Math.round(seconds), walking: Math.round(plan.length / WALK_TO.pace) };
    },
    /**
     * The tour (`tourStops`). With no name, returns every stop's name, what is
     * there and where. With a name, such as "ruined building", "bridge",
     * "stepping stones", "cairn" or "watermill (ruin)", walks there facing it
     * and returns the stop, or null when this world has none.
     */
    tour: (name?: string) => {
      const stops = tour();
      if (name === undefined) return stops.map((s) => ({ name: s.name, what: s.what, x: Math.round(s.x), z: Math.round(s.z) }));
      const s = stops.find((t) => t.name === name.toLowerCase());
      if (s !== undefined) world.walkTo(s.x, s.z, s.yaw, s.pitch);
      return s ?? null;
    },
    /** Moves to where the world's next open would land the person, as if they last stood at `stood`, or as on a first visit. */
    valley: (stood?: LastSpot) => world.valleyView(stood),
    /** The person's spot, as the page saves it with the world (`lastSpotAt`). */
    stood: () => (world.code === null ? null : lastSpotAt(world.code.world, world.walker.x, world.walker.z, world.walker.yaw)),
    walker: () => ({ x: world.walker.x, z: world.walker.z, yawDeg: (world.walker.yaw * 180) / Math.PI, pitchDeg: (world.walker.pitch * 180) / Math.PI, eye: world.walker.eye }),
    /**
     * Points the camera at the land from above for a capture, from exactly `pos` toward `target`. Without them it
     * uses the world's center or where the last call looked. `walk` or any trip returns to walking.
     */
    overview: (pos?: [number, number, number], target?: [number, number, number]) => world.lookFromAbove(pos, target),
    freeze: (t: number | null) => (world.frozen = t),
    /** For filming only. Fixes the camera at `pin`, with the walker under it, where `eye` is the camera's height in world meters. Null releases it. */
    film: (pin: { x: number; z: number; eye: number; yaw: number; pitch: number } | null) => {
      world.viewPin = pin;
      if (pin === null) return;
      world.walkTo(pin.x, pin.z, pin.yaw, pin.pitch);
      world.arrived = true;
    },
    streams: () => world.terrain.streams.map((s) => s.stations.filter((_, k) => k % 10 === 0).map((p) => [Math.round(p.x), Math.round(p.z), +p.level.toFixed(2)])),
    report: () => ({ ...world.terrain.report, fit: world.terrain.fit, bakeMs: Math.round(world.bakeMs), steps: world.openingSteps }),
    info: () => world.renderer.info.render,
    /** The water's mirror stats, and draw calls in the whole last frame: shadow, mirror and view. */
    water: () => ({ ...world.water.stats(), frameCalls: world.frameCalls }),
    /** Draw calls and triangles of each pass in the last frame: the sun's shadow, the water's mirror and the view. */
    passes: () => structuredClone(world.passes),
    /**
     * Sets vitality live for a file and its definitions, or for every file
     * under a directory, by path. "" sets every file. Like a refresh, it goes
     * through `setVitality` and changes what represents the files, their
     * patches and what grows there, and the lots and water of the areas that
     * pool them. Nothing rebakes. Returns how many files it set.
     */
    fileVitality: (path: string, v: number) => {
      const under = (p: string): boolean => path === "" || p === path || p.startsWith(`${path}/`);
      const files = (world.code?.world.patches ?? []).filter((p) => under(p.path));
      const definitions = (world.code?.world.symbols ?? []).filter((s) => under(s.file));
      world.setVitality(new Map([...files.map((p) => p.path), ...definitions.map((s) => s.id)].map((id) => [id, v])));
      return files.length;
    },
    /** The ground's own vitality and its area's at (x, z), or underfoot, as the grass, ground and water use them. */
    groundVitality: (x?: number, z?: number) => groundVitalityAt(x ?? world.walker.x, z ?? world.walker.z),
    /** The air settings last applied at the eye: the ground's decline around it, the eye's height above the land, and the air values. */
    air: () => world.appliedAir,
    understory: () => world.understory.stats(),
    /** A hash of the baked heights, water levels and shore distances, to prove a change leaves the bake identical byte for byte. */
    bakeHash: () => contentHash(world.terrain.lattice.heights, world.terrain.waterLevel, world.terrain.shore),
    /** Copies and triangles each kind of the understory drew in the last pass. */
    understoryDrawn: () => world.understory.drawnByKind(),
    /** Shows or hides the wild bushes, for comparing frame costs. */
    showWilds: (on: boolean) => world.wildGrowth.show(on),
    /** Per wild bush blueprint: copies placed, triangles per copy, levels, and what the last pass drew. */
    wilds: () => world.wildGrowth.all().map((v) => ({ placed: v.count, perCopy: v.triangles / Math.max(1, v.count), levels: v.levels, ...v.drawn() })),
    placements: () => world.understory.placements(),
    showUnderstory: (on: boolean) => world.understory.show(on),
    /** Shows or hides what drifts through the air, for comparing frame costs. */
    showDrifts: (on: boolean) => {
      world.drifts.object.visible = on;
    },
    /** For each drifting form: its density in its densest region, 0 to 1, how many of its pieces can show, and how many trees shed it now. */
    drifts: () => world.drifts.state(),
    /** Shows or hides the grass, for comparing frame costs and looking at the bare ground. */
    showGrass: (on: boolean) => {
      world.grass.mesh.visible = on;
    },
    /**
     * Fixes the detail center at (x, z) and the eye's height while the view
     * stays put, or with null lets it follow the eye again. Every detail
     * choice uses this point: tree and bush levels and thinning, the grass,
     * the ground's rings and the wild bushes. Moving only this point shows
     * exactly what a step of walking changes in the detail drawn.
     */
    detailCenter: (at: [number, number] | null) => {
      world.detailPin = at === null ? null : { x: at[0], z: at[1] };
    },
    /**
     * Draws one frame and counts each kind's draw calls and triangles in each
     * pass, from what the renderer drew. The passes are the sun's shadow, the
     * water's mirror and the view.
     */
    drawn: () => {
      const kinds = new Map<THREE.Object3D, string>();
      const name = (kind: string, objects: readonly (THREE.Object3D | undefined)[]): void => {
        for (const o of objects) if (o !== undefined) kinds.set(o, kind);
      };
      name("trees", world.treeViews.map((v) => v.object));
      name("understory", [...world.understory.all().map((v) => v.object), ...world.understory.quiet()]);
      name("wild bushes", world.wildGrowth.all().map((v) => v.object));
      // Each far set's cards draw in one batch. The bush set also covers stones and flowers.
      name("far trees", [world.treeSet.forms.cards.object]);
      name("far understory", [world.bushSet.forms.cards.object]);
      name("grass", [world.grass.mesh]);
      name("ground", [world.ground.fine, world.ground.coarse, world.ground.mirror, world.ground.wilds]);
      name("water", [world.water.group]);
      name("sky", [world.sky.mesh]);
      name("signs", [world.signs.mesh]);
      name("buildings", world.settlement.views().map((v) => v.object));
      name("landmarks", [...world.landmarkViews, ...world.landmarkPool.values()].map((v) => v.object));
      name("trails", (world.built?.views ?? []).map((v) => v.object));
      const now = performance.now();
      return tallyFrame(world.renderer, world.scene, world.camera, kinds, () => world.frame(0, now, world.hour));
    },
    /**
     * Draws `settle` frames at this instant, without time passing, and
     * returns the last one's pixels, to compare with `change`. Freeze the
     * wind's clock first (`freeze`), so only what the probe changes moves.
     */
    grab: grabFrame,
    /** How much the picture changed between two grabbed frames (`pictureChange`). */
    change: frameChange,
    /** The walk test (`walkSteps`): each step's change to the detail drawn, and the wind's along the same walk. */
    steps: (meters: number, step = 0.7, at?: number) => walkSteps(meters, step, at),
    /** The ramp test (`vitalityRamp`): what each frame of a vitality ramp changes, compared with the wind. */
    ramp: vitalityRamp,
    /** Finishes every vitality ease at once, so the next draw shows exactly the vitality set. */
    settleVitality: () => settleVitality(),
    /**
     * The stand check. The person stands still for `seconds` with the wind's
     * clock frozen while the page keeps running, including the journal's
     * painter. Every half second it draws the view and compares it with the
     * first. Nothing the person sees may change. Returns the worst change and
     * each look's [seconds, change, level 0's window origin].
     */
    standCheck: async (seconds = 30) => {
      const was = world.frozen;
      world.frozen = world.light.uTime.value;
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
      try {
        await wait(300);
        const base = grabFrame();
        const looks: [number, number, string][] = [];
        for (let t = 0.5; t <= seconds; t += 0.5) {
          await wait(500);
          const o = world.land.origins[0] as { x: number; z: number };
          looks.push([t, +frameChange(base, grabFrame()).worst.toFixed(2), `${o.x},${o.z}`]);
        }
        return { worst: Math.max(0, ...looks.map((l) => l[1])), looks };
      } finally {
        world.frozen = was;
      }
    },
    /**
     * The painter check. With the person still and the wind's clock frozen,
     * requests paintings of the `count` farthest things one at a time, as the
     * journal does, while the page keeps drawing frames. Every 100 ms, and
     * after each painting, it draws the person's view and compares it with
     * the first. A painting must change nothing the person sees. Returns the
     * painted ids, the worst change, the number of checks, the frame
     * intervals in milliseconds while painting, and the first painting as a
     * JPEG. Without `look` it only paints, so the intervals show the
     * painter's own cost. With `near` it paints the nearest things instead,
     * which need no land of their own, to measure a painting by itself.
     */
    paintCheck: async (count = 6, look = true, near = false) => {
      const from = (s: Subject): number => Math.hypot(s.x - world.walker.x, s.z - world.walker.z);
      const far = near ? world.subjects.filter((s) => from(s) <= PAINTING.near).sort((a, b) => from(a) - from(b)).slice(0, count) : world.subjects.filter((s) => from(s) > PAINTING.near).sort((a, b) => from(b) - from(a)).slice(0, count);
      const was = world.frozen;
      world.frozen = world.light.uTime.value;
      const intervals: number[] = [];
      let last = performance.now();
      let going = true;
      const tick = (now: number): void => {
        intervals.push(+(now - last).toFixed(1));
        last = now;
        if (going) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
      try {
        await wait(300);
        const base = look ? grabFrame() : null;
        const changes: number[] = [];
        let first: string | null = null;
        for (const s of far) {
          let done = false;
          const job = world.viewOf(s.represented.id, 520, 660)
            .then((p) => {
              if (first !== null || p === null) return;
              const out = document.createElement("canvas");
              out.width = p.color.width;
              out.height = p.color.height;
              const ctx = out.getContext("2d") as CanvasRenderingContext2D;
              const image = ctx.createImageData(p.color.width, p.color.height);
              image.data.set(p.color.data);
              ctx.putImageData(image, 0, 0);
              first = out.toDataURL("image/jpeg", 0.9);
            })
            .finally(() => {
              done = true;
            });
          while (!done && base !== null) {
            await wait(100);
            changes.push(frameChange(base, grabFrame()).worst);
          }
          await job;
          if (base !== null) changes.push(frameChange(base, grabFrame()).worst);
        }
        return { painted: far.map((s) => s.represented.id), worst: +Math.max(0, ...changes).toFixed(2), checks: changes.length, intervals, first };
      } finally {
        going = false;
        world.frozen = was;
      }
    },
    /** The swap test (`swapTest`) for preset `name` at `vitality`. With no name, returns every tree and bush preset's name. */
    swap: (name?: string, vitality = 1) => (name === undefined ? farPresets().map((p) => p.name) : swapTest(name, vitality)),
    /** The likeness test (`likenessTest`) for preset `name` at `vitality`, at each crown span in `sizes` or the default ones. */
    likeness: (name: string, vitality = 1, sizes?: readonly number[], pictures = false) => likenessTest(name, vitality, sizes, pictures),
    /** Resolves once the bushes' far forms, which load after the loading screen closes, have loaded and both sets have settled. */
    farReady: () => world.bushesBaked,
    /** Resolves once both far sets have settled at the person's current spot, with no form loading or fading. */
    farSettled: () => Promise.all([world.treeSet.stream.settled(), world.bushSet.stream.settled()]).then(() => undefined),
    /** Walks as a person would for `seconds` of real time (`wander`). */
    wander,
    /** Shows or hides the far tree cards, to see what they draw. */
    showFarTrees: (on: boolean) => world.treeSet.forms.cards.show(on),
    /** Shows or hides every tree, for comparing frame costs. */
    showTrees: (on: boolean) => {
      for (const v of world.treeViews) v.object.visible = on;
    },
    /** Draw calls in one whole frame: the shadow, mirror and view passes together. */
    calls: () => {
      world.renderer.info.autoReset = false;
      world.renderer.info.reset();
      world.frame(0, performance.now(), world.hour);
      const calls = world.renderer.info.render.calls;
      world.renderer.info.autoReset = true;
      return calls;
    },
    /** Draws `count` frames back to back and waits for the GPU: milliseconds per frame, shadows included. */
    bench: (count: number) => {
      const gl = world.renderer.getContext();
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const t0 = performance.now();
      for (let k = 0; k < count; k++) world.frame(1 / 60, t0, world.hour);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return (performance.now() - t0) / count;
    },
    /** Walks straight ahead for `seconds` at walking pace, as if W were held, and reports where the walk ended. */
    stride: (seconds: number) => {
      for (let k = 0; k < Math.round(seconds * 60); k++) {
        const next = walkStep(world.terrain, world.solids, world.walker, { dx: -Math.sin(world.walker.yaw), dz: -Math.cos(world.walker.yaw), speed: WALK_TO.pace }, 1 / 60);
        world.walker.x = next.x;
        world.walker.z = next.z;
      }
      world.body = standAt(world.terrain, world.decks, world.walker.x, world.walker.z);
      world.walker.eye = world.body.eye;
      return { x: world.walker.x, z: world.walker.z, depth: waterDepthAt(world.terrain, world.walker.x, world.walker.z) };
    },
    depth: () => waterDepthAt(world.terrain, world.walker.x, world.walker.z),
    /** The body's speed, its eye height, the camera height with the stride added, and the footing under it. */
    gait: () => (world.body === null ? null : { speed: Math.hypot(world.body.vx, world.body.vz), eye: world.body.eye, camera: world.camera.position.y, footing: footingAt(world.terrain, world.decks, world.walker.x, world.walker.z) }),
    /** Every footbridge deck a walker can stand on: its center, its direction, its span and width, and its top at the center. */
    decks: () => world.decks.flatMap((d) => ("tops" in d ? [] : [{ x: d.x, z: d.z, along: [d.cos, -d.sin], span: d.half * 2, width: d.halfWidth * 2, top: d.base + d.topAt(0) }])),
    /** At each (x, z): the ground height without bridges, the stance without decks (`stanceAt`), and the footing with decks. */
    profile: (points: readonly (readonly [number, number])[]) =>
      points.map(([x, z]) => {
        const s = stanceAt(world.terrain, x, z);
        const f = footingAt(world.terrain, world.decks, x, z);
        return { ground: groundHeightAt(world.terrain, x, z), eye: s.eye, depth: s.depth, swim: s.swim, footing: f.ground, deck: f.deck };
      }),
    /**
     * Runs the world's walk for `seconds` at 60 frames a second without
     * drawing, holding the key codes in `keys` for `hold` seconds or walking a
     * tap to `to`. Records each frame as [t, x, z, speed, camera y, eye
     * height, footing, depth, on a deck, yaw].
     */
    trace: (seconds: number, drive: { keys?: readonly string[]; hold?: number; to?: readonly [number, number] }) => {
      world.release();
      if (drive.to !== undefined) world.setGoal(drive.to[0], drive.to[1]);
      for (const k of drive.keys ?? []) world.press(k);
      const rows: number[][] = [];
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        if (drive.hold !== undefined && i === Math.round(drive.hold * 60)) world.release();
        world.updateWalk(1 / 60);
        const f = footingAt(world.terrain, world.decks, world.walker.x, world.walker.z);
        const b = world.body as Stride;
        rows.push([i / 60, world.walker.x, world.walker.z, Math.hypot(b.vx, b.vz), world.camera.position.y, world.walker.eye, f.ground, f.depth, f.deck ? 1 : 0, world.walker.yaw]);
      }
      world.release();
      return rows;
    },
    /** Where a tap's walk is headed, or null, and the corners of its way. */
    goal: () => ({ goal: world.goal === null ? null : { ...world.goal.target }, way: world.goal?.way.map((p) => [p.x, p.z]) ?? null }),
    /** How far (x, z) is from the nearest solid's edge, at most 2 m, and negative inside one. */
    clearance: (x: number, z: number) => clearanceAt(world.solids, x, z),
    /** How many trunks, rocks, bushes and walls block a walker. */
    solids: () => world.solids.count,
    /** The eye height, the water depth and how far the person swims at their spot. */
    stance: () => stanceAt(world.terrain, world.walker.x, world.walker.z),
    /** Where the ground at (x, z) shows on screen, in CSS pixels from the page's top left. Null when it is behind the view. */
    onScreen: (x: number, z: number) => {
      const p = new THREE.Vector3(x, groundHeightAt(world.terrain, x, z), z).project(world.camera);
      if (p.z > 1) return null;
      const rect = world.canvas.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    ponds: () => world.terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
    plants: () => world.trees.map((t) => ({ x: t.x, z: t.z, height: (world.variants[t.variant] as TreeVariant).height * t.scale, region: regionAt(t.x, t.z), preset: composedName(world.treeBlueprints[t.variant] as Blueprint), vitality: t.represented.vitality })),
    /**
     * Places every code tree `copies` times, each copy on its own patch, to measure at scale. 1 restores the world as
     * it is. The bake thread places them again. Not for a world a person walks.
     */
    forest: async (copies: number) => {
      world.forestCopies = Math.max(1, Math.round(copies));
      await world.rebake(world.spec);
      return { trees: world.trees.length, understory: world.understory.stats().placed };
    },
    /** Forces every instanced blueprint's detail ("full" or "far"), or lets distance choose ("auto"). */
    detail: (mode: DetailMode) => {
      for (const v of world.instanced()) v.detail = mode;
    },
    /** Trees, builds, each blueprint's levels, and the copies and triangles the last pass drew. */
    scale: () => ({
      trees: world.trees.length,
      builds: world.variants.length,
      levels: world.instanced().map((v) => v.levels),
      drawn: world.instanced().reduce((n, v) => n + v.drawn().copies, 0),
      drawnTriangles: world.instanced().reduce((n, v) => n + v.drawn().triangles, 0),
      /** The crown span in device pixels at which trees switch to their far form (`FAR.swapPx`). */
      swapPx: FAR.swapPx,
      /** Milliseconds spent loading the trees' far forms, by baking or reading, and then the bushes'. */
      farBakeMs: world.treeSet.stream.stats().ms,
      bushBakeMs: world.bushSet.stream.stats().ms,
      /**
       * Each far set's slots and the forms in them, the slots' GPU memory in MB, the forms a view would draw far and
       * their far copies, the copies drawn as cards now, and the forms read and baked so far.
       */
      treeCards: farCards(world.treeSet),
      bushCards: farCards(world.bushSet),
      /** The understory's build count by group, one build per distinct blueprint. */
      understoryBuilds: Object.fromEntries(Object.entries(world.code?.plants ?? {}).map(([group, builds]) => [group, builds.length])),
      /** Trees in the last pass in the band, or small enough on screen to draw as far forms. */
      treesInBand: world.treeViews.reduce((n, v) => n + v.drawn().band, 0),
      treesFar: world.treeViews.reduce((n, v) => n + v.drawn().far, 0),
      treesDrawn: world.treeViews.reduce((n, v) => n + v.drawn().copies, 0),
      treeTriangles: world.treeViews.reduce((n, v) => n + v.drawn().triangles, 0),
    }),
    /** Where the walker is, or (x, z): the area and file patch underfoot, in either world. */
    place: (x?: number, z?: number) => placeAt(world.places, x ?? world.walker.x, z ?? world.walker.z),
    /** The codebase's world: its size, areas, patches, buildings, landmarks and trails. */
    code: () =>
      world.code === null
        ? null
        : {
            name: world.code.world.name,
            judged: world.code.summary,
            size: world.code.world.size,
            regions: world.code.world.regions.map((r) => ({ area: r.area, land: r.biome?.slots.relief?.use ?? "", x: Math.round(r.x), z: Math.round(r.z) })),
            areas: world.code.world.areas.map((a) => ({ path: a.path, x: Math.round(a.x), z: Math.round(a.z), ground: Math.round(a.ground), depth: a.depth })),
            symbols: world.code.world.symbols.length,
            placedSymbols: world.symbolPlacements.filter((k) => k >= 0).length,
            patches: world.code.world.patches.length,
            things: world.code.world.things.map((t) => ({ path: t.path, name: t.name, as: t.as, blueprint: t.blueprint.id, x: Math.round(t.x), z: Math.round(t.z), vitality: +t.vitality.toFixed(2) })),
            trails: world.code.world.trails.map((t) => `${t.from}->${t.to}`),
          },
  };
}
