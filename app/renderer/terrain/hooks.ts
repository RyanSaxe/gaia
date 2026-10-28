// The hooks scripted checks drive the world through, `window.__lab.terrain`:
// what stands in the world and where the person is, walking and travelling
// as a person would, setting vitality live, and measuring what a frame draws
// and what a step of walking changes in it. `pnpm probe`, `pnpm shots`, the
// proving ground's tour and capture scripts use them. They reach inside the
// world (`WorldInside`), and nothing a person sees calls them.

import * as THREE from "three";
import type { Realized } from "@gaia/realize";
import type { Blueprint } from "@gaia/schema";
import { settleVitality } from "@gaia/render";
import { clearanceAt, fordBeside, footingAt, frameOf, groundHeightAt, heightAt, junctionVitality, placeAt, planTrip, stanceAt, standAt, stoodBy, type StoodSpot, type Stride, TRAVEL, trailWay, travelFrom, travelStep, wadingAt, WALK_TO, walkStep, type Walker, waterDepthAt, wayVitalityAt, wayWear } from "@gaia/terrain";
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

/** A step of walking: half a second at walking pace, as the walk test steps. */
const WALK_STEP = 0.7;
/** One step of the swap test: how much it changes the tree's part of the screen, the wind's change there, and how far away the tree stands. */
interface SwapStep {
  readonly change: Change;
  readonly wind: Change;
  readonly distance: number;
}

/** Every hook of `window.__lab.terrain`, reading and steering `world` from inside. */
export function worldHooks(world: WorldInside): Readonly<Record<string, unknown>> {
  /** Each preset's copy the swap test stands alone, by its far form: the trees' and the bushes' forms are numbered apart. */
  const swapCopies = new Map<FarOf, Copies>();

  /** The region of the lattice sample nearest (x, z). */
  function regionAt(x: number, z: number): number {
    const l = world.terrain.lattice;
    const ix = Math.round((x - l.origin) / l.spacing);
    const iz = Math.round((z - l.origin) / l.spacing);
    return world.terrain.region[Math.max(0, Math.min(l.n - 1, iz)) * l.n + Math.max(0, Math.min(l.n - 1, ix))] ?? 0;
  }

  /** The places worth seeing in the world now shown, each with where to stand and which way to look (`tourStops`). */
  function tour(): TourStop[] {
    // A file's trees, its definitions that stand as trees, make its grove.
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
          const front = world.settlement.standOf(b);
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
   * The walk test. From where the person stands, walks `meters` along the
   * view in steps of `step` meters with the wind's clock frozen. At each step
   * the view holds while only the point detail is chosen from moves one step
   * on, so the change measured is exactly what the step does to the detail
   * drawn: levels, thinning, the grass, the ground's rings. A step is held
   * to the wind's own change over half a second, a change people already see
   * all the time, measured along the same walk every `windEvery` steps, each
   * time 1.7 s further on, so the samples span the breeze's lulls and gusts.
   * The wind's clock stands at `at` seconds, or where it is now. Returns each
   * step's [meters walked, mean, worst block] and the wind's worst blocks.
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
   * The ramp test. With the wind's clock frozen, takes vitality from `from` to
   * `to` over `seconds`, setting it with `set` once a frame at `fps`, each
   * frame's time passing for the change to ease in, then holds `to` for
   * `hold` seconds more while what is still easing in settles, and measures
   * what each frame changes. A frame is held to the wind's own change over
   * half a second at the same view, measured at rest at the ramp's start,
   * middle and end, three moments 1.7 s apart at each. Returns each frame's
   * [vitality, mean, worst block], the wind's worst blocks, and the frames
   * named in `snaps` (0 at rest before it, then counted through the ramp and
   * the hold) as JPEG data URLs.
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
        // A frame's time passes for the change to ease in; the wind's clock stays frozen.
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

  /** The view held at `pin`, detail chosen from there and nothing streaming, drawn and read back. */
  function heldView(pin: ViewPin): Uint8Array {
    world.viewPin = pin;
    world.detailPin = { x: pin.x, z: pin.z };
    world.streamHeld = true;
    try {
      return grabFrame(1);
    } finally {
      world.viewPin = null;
      world.detailPin = null;
      world.streamHeld = false;
    }
  }

  /**
   * The travel test. Stands the person at (x0, z0) with the land and
   * everything on it in, then sends them to the landing nearest (x1, z1) at
   * `pace` meters a second along the tread, driving the frames itself in
   * real time with the wind's clock frozen. Every `every` frames the view is
   * held where it was and drawn again, its detail chosen from there too, so
   * the change measured is only what streaming did meanwhile: the land's
   * windows moving and tiles standing. Each frame's work is timed to the
   * GPU's finish. Returns the trip's length and seconds, how long it took to
   * set off and how long it waited on the way ahead, each check's [meters
   * along, pace, mean change, worst block, the land levels that moved as
   * bits, the water's depth under the person, how far the water's mirror
   * plane moved, and where the view was held], the frames' work in
   * milliseconds, the land's least lead, and every tile that stood within
   * sight of the person.
   */
  async function travelTest(x0: number, z0: number, x1: number, z1: number, pace: number, every = 3, cap = 400, pitch = -0.05) {
    // The trip starts where a person stands: the point given may be a thing's own middle, inside it.
    const start = world.landingNear(x0, z0) ?? { x: x0, z: z0 };
    x0 = start.x;
    z0 = start.z;
    world.walkTo(x0, z0, 0, pitch);
    await Promise.all([world.land.around(x0, z0), world.standing.ready(x0, z0)]);
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
    world.standing.late();
    const checks: [number, number, number, number, number, number, number, number, number][] = [];
    /** Which land levels moved since `held`'s view was drawn, one bit a level. */
    const windows = (): string => world.land.origins.map((o) => `${o.x},${o.z}`).join(" ");
    const work: number[] = [];
    let lead = Infinity;
    let ended = Number.NaN;
    let held: { pin: ViewPin; image: Uint8Array; s: number; windows: string; mirror: number } | null = null;
    /** The most the depth walking reads ever differed from the land's own water level under the person, meters. */
    let ghosts = 0;
    let last = performance.now();
    try {
      for (let k = 0; world.trip === t && performance.now() - t.began < cap * 1000; k++) {
        // The workers' answers come in between frames, as they do between the app's own.
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
          // How deep the water is under the person, from the land's own water level: wading spreads rings.
          const level = heightAt(world.terrain.lattice, world.walker.x, world.walker.z, world.terrain.waterLevel);
          const depth = level > -500 ? Math.max(0, level - heightAt(world.terrain.lattice, world.walker.x, world.walker.z)) : 0;
          // The water's mirror follows the person's eye, not the held view's: how far its plane moved between the two draws.
          const mirrored = +(world.water.stats().mirrorLevel - held.mirror).toFixed(3);
          // The depth walking reads (`waterDepthAt`), against the land's own water level just above.
          const cached = waterDepthAt(world.terrain, world.walker.x, world.walker.z);
          ghosts = Math.max(ghosts, Math.abs(cached - depth));
          checks.push([+held.s.toFixed(1), +t.at.v.toFixed(1), +change.mean.toFixed(3), +change.worst.toFixed(2), moved, +depth.toFixed(2), mirrored, Math.round(held.pin.x), Math.round(held.pin.z)]);
          held = null;
        }
      }
    } finally {
      world.driving = false;
      world.frozen = was;
      // A trip the test stopped early ends where it was.
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
      late: world.standing.late(),
      ghosts: +ghosts.toFixed(2),
    };
  }

  /** Every build that turns far, by a name from its parts: each of the world's tree builds, its understory's and the wild's bushes. */
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
   * The swap test: whether a tree's or a bush's change of form ever shows.
   * One copy of preset `name`'s first build (`farPresets`), at `vitality`,
   * stands alone straight ahead of the eye. With the wind's clock frozen, only the point detail is
   * chosen from moves back, so the crown's span on screen shrinks:
   * - `middle`: from halfway into the band to 5% farther, the far form
   *   coming in over the full one;
   * - `whole`: from just inside the band's far end to just past it, where
   *   the far form comes to draw whole over the full one;
   * - `leaving`: from halfway through the full form's dissolve past the band
   *   (`FAR.leave`) to 5% farther;
   * - `end`: from just before the dissolve's end to just past it, the frame
   *   where the full form leaves and the far form stands alone;
   * - `dissolving`: from halfway into the band where a crown too small to see
   *   dissolves (`GONE`), one step of walking farther;
   * - `gone`: the step of walking across that band's end, where the copy
   *   stops drawing;
   * these two over at least a 64-pixel block around the copy, as the walk
   * test measures, since the crown spans only a few pixels.
   * Each is held to the wind's half-second change at the same spot, all
   * measured over the plant's own part of the screen. Every other plant that
   * turns far and the grass hide while it runs. A plant whose crown is still
   * too large to dissolve where the air has already hidden it stands there
   * all the same, and changes nothing. Null when there is no such preset.
   */
  async function swapTest(name: string, vitality: number): Promise<{ middle: SwapStep; whole: SwapStep; leaving: SwapStep; end: SwapStep; dissolving: SwapStep; gone: SwapStep } | null> {
    const preset = farPresets().find((f) => f.name === name);
    if (preset === undefined) return null;
    // Its far form holds a slot, turned all the way in, while it runs.
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
    /** Stands the tree where its crown spans `from` pixels, and measures moving the detail back until it spans `to`. */
    const at = (px: number): number => (2 * crown.radius * focal) / px;
    /** Stands the copy where its crown spans `from` pixels, and measures moving the detail back until it spans `to`. */
    const step = (stood: Copies, from: number, to: number): SwapStep => walk(stood, from, at(to) - at(from), 0);
    /**
     * Stands the copy where its crown spans `from` pixels, and measures moving the detail back `back` meters, over the
     * crown's part of the screen and at least a `block`-pixel square around it.
     */
    const walk = (stood: Copies, from: number, back: number, block: number): SwapStep => {
      const distance = at(from);
      // The crown's middle at the eye's height, straight ahead.
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
        // Too small to see, a crown dissolves over hundreds of meters: each is held to a step of walking, over a block.
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
   * Walks for `seconds` of real time as a person would: forward all along,
   * turning the view about 70° left or right every 2.5 s as a hand drags it,
   * over half a second, and running a third of the time with Shift. The
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

  /** A set of far forms as reports show it: its slots and what holds them, in plain numbers. */
  const farCards = (set: FarSet): Record<string, number> => {
    const st = set.stream.stats();
    return { slots: st.slots, forms: set.forms.count, held: st.held, turnedIn: st.turnedIn, mb: Math.round(st.bytes / 2 ** 20), wanted: st.wanted, farCopies: st.farCopies, carded: st.carded, read: st.read, baked: st.baked };
  };

  return {
    /**
     * Shows the sweep's sky `k`, of every light, sky and wind Jev composes skies from (`sweep`), until the next world
     * opens; the proving ground stands the first. Gives how many skies the sweep holds.
     */
    sky: (k: number): number => {
      const skies = sweep(COMPOSING.world, COMPOSING.lib).blueprints;
      const sky = skies[k];
      if (sky === undefined) throw new Error(`The sweep holds ${skies.length} skies, numbered from 0: there is no sky ${k}.`);
      world.skyWorld = sky;
      return skies.length;
    },
    /** Each standing landmark: its name, site, height and triangles. */
    landmarks: () =>
      world.ways.sites.map((s, i) => ({ name: world.landmarks[s.landmark]?.name, ...s.site, height: world.landmarkViews[i]?.height, triangles: world.landmarkViews[i]?.triangles })),
    /** Sets every landmark's entity's vitality, 0 to 1, and with it the trails they join. */
    landmarkVitality: (v: number) => {
      world.setVitality(new Map(world.landmarkEntities.map((e) => [e.id, v])));
      for (const view of world.landmarkPool.values()) view.setVitality(v);
    },
    /** Sets a thing's vitality by its path, or every building's or landmark's entity's with that name: wherever it shows, and the wear of every trail it joins, live. */
    entityVitality: (key: string, v: number) => {
      const named = [...world.settlement.buildings.map((b) => b.represented), ...world.landmarkEntities].filter((r) => r.name === key).map((r) => r.id);
      world.setVitality(new Map((world.thingVitality.has(key) ? [key] : named).map((id) => [id, v])));
    },
    /** Each trail (a dependency): its ends, length and the ways it walks. */
    trails: () =>
      world.ways.network.trails.map((t) => ({
        id: t.id,
        from: { place: t.from, entity: world.entityOfPlace.get(t.from), vitality: world.vitalityOfPlace(t.from) },
        to: { place: t.to, entity: world.entityOfPlace.get(t.to), vitality: world.vitalityOfPlace(t.to) },
        length: Math.round(t.length),
        ways: t.ways.map((w) => w.way),
      })),
    /** Each way of tread: its ends, length, width, crossings, the trails walking it, its wear now and a point every 10 m. */
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
    /** Every building: what it stands for, where, and its vitality now. */
    buildings: () =>
      world.settlement.buildings.map((b) => ({ name: b.represented.name, building: b.kindName, ...b.site, width: b.plan.width, depth: b.plan.depth, triangles: b.triangles, vitality: b.vitality, sign: world.settlement.signOf(b), stand: world.settlement.standOf(b) })),
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
    subjects: () => world.subjects.map((s) => ({ name: s.represented.name, standsAs: s.standsAs, ...(s.built === undefined ? {} : { built: s.built }), x: s.x, z: s.z, height: s.height, vitality: s.represented.vitality })),
    card: () => (world.shown === null ? null : { name: world.shown.name, what: world.shown.what }),
    closeCard: () => world.hideCard(),
    walk: (x: number, z: number, yawDeg: number, pitchDeg = -3) => world.walkTo(x, z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180),
    /** Sends the person to the landing nearest (x, z), as a pick on the map does, at `pace` on the tread and straight across; false where neither goes. */
    travel: (x: number, z: number, pace: number = TRAVEL.pace) => {
      const at = world.landingNear(x, z);
      world.travelPace = pace;
      const going = at !== null && world.travelTo(at, false);
      world.travelPace = TRAVEL.pace;
      return going;
    },
    /** How far the person stands inside each land level's window, meters, finest first: the land's lead on them, which a trip must not outrun. */
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
    /** The travel test (`travelTest`). */
    travelTest,
    /** Each tile that stood within sight of the person since last asked (`Standing.late`): things that could be seen appearing. */
    standingLate: () => world.standing.late(),
    /** The tiles each stander still waits for (`Standing.asking`). */
    standingAsking: () => ({ ...world.standing.asking(), workers: world.land.workers() }),
    /** The walk's own state: the keys it holds, whether a tap's walk is under way, and why the last trip ended. */
    walkState: () => ({ keys: [...world.keys], goal: world.goal !== null, trip: world.trip !== null, lastEnd: world.tripEnd }),
    /** The trip under way, or null: how far along it and how long, its pace, whether its view follows the way, and how many times its own pace it goes under paper. */
    trip: () => (world.trip === null ? null : { s: +world.trip.at.s.toFixed(1), length: Math.round(world.trip.plan.length), v: +world.trip.at.v.toFixed(2), going: world.trip.at.going, follows: world.trip.at.follows, stopping: world.trip.stopping, hurry: world.trip.hurry === null ? null : +world.trip.hurry.toFixed(2), unready: world.trip.marks.filter((m) => !m.ready).length, asked: world.trip.marks.filter((m) => m.asked).length, yaw: +world.trip.at.yaw.toFixed(2) }),
    /**
     * A trip from (x0, z0) to the landing nearest (x1, z1), planned and
     * taken at 60 frames a second without moving anyone: its length, how
     * much of it is on the tread, and how long it takes.
     */
    tripTime: (x0: number, z0: number, x1: number, z1: number) => {
      // A trip starts where a person stands: the point given may be a thing's own middle, inside it.
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
     * The tour (`tourStops`): with no name, every stop's name, what is there
     * and where; with a name, such as "ruined building", "bridge",
     * "stepping stones", "cairn" or "watermill (ruin)", walks there, looking
     * at it, and returns the stop, or null when this world has none.
     */
    tour: (name?: string) => {
      const stops = tour();
      if (name === undefined) return stops.map((s) => ({ name: s.name, what: s.what, x: Math.round(s.x), z: Math.round(s.z) }));
      const s = stops.find((t) => t.name === name.toLowerCase());
      if (s !== undefined) world.walkTo(s.x, s.z, s.yaw, s.pitch);
      return s ?? null;
    },
    /** Opens where the world's next open would land the person, as if they last stood at `stood`, or as on a first visit. */
    valley: (stood?: StoodSpot) => world.valleyView(stood),
    /** Where the person stands, as the page keeps it with the world (`stoodBy`). */
    stood: () => (world.code === null ? null : stoodBy(world.code.world, world.walker.x, world.walker.z, world.walker.yaw)),
    walker: () => ({ x: world.walker.x, z: world.walker.z, yawDeg: (world.walker.yaw * 180) / Math.PI, pitchDeg: (world.walker.pitch * 180) / Math.PI, eye: world.walker.eye }),
    /**
     * Looks at the land from above for a capture, from `pos` toward `target` (the world's middle unless given, or
     * where the last call looked), the camera exactly there; `walk` or any trip goes back to walking.
     */
    overview: (pos?: [number, number, number], target?: [number, number, number]) => world.lookFromAbove(pos, target),
    freeze: (t: number | null) => (world.frozen = t),
    /** Film only: holds the camera at `pin` (eye is the camera's height in world meters), the walker under it, or lets go with null. */
    film: (pin: { x: number; z: number; eye: number; yaw: number; pitch: number } | null) => {
      world.viewPin = pin;
      if (pin === null) return;
      world.walkTo(pin.x, pin.z, pin.yaw, pin.pitch);
      world.arrived = true;
    },
    streams: () => world.terrain.streams.map((s) => s.stations.filter((_, k) => k % 10 === 0).map((p) => [Math.round(p.x), Math.round(p.z), +p.level.toFixed(2)])),
    report: () => ({ ...world.terrain.report, fit: world.terrain.fit, bakeMs: Math.round(world.bakeMs), steps: world.openingSteps }),
    info: () => world.renderer.info.render,
    /** Draw calls in the whole last frame (shadow, mirror and view), and the water's mirror. */
    water: () => ({ ...world.water.stats(), frameCalls: world.frameCalls }),
    /** Draw calls and triangles of each pass in the last frame: the sun's shadow, the water's mirror and the view. */
    passes: () => structuredClone(world.passes),
    /**
     * Sets the vitality of a file and its definitions, or of every file under
     * a directory, by its path ("" for every file), live, as a heal does
     * (`setVitality`): what stands for them, their patches of ground and what
     * grows there, and the lots and water of the areas pooling them. Nothing
     * rebakes. Returns how many files it set.
     */
    fileVitality: (path: string, v: number) => {
      const under = (p: string): boolean => path === "" || p === path || p.startsWith(`${path}/`);
      const files = (world.code?.world.patches ?? []).filter((p) => under(p.path));
      const definitions = (world.code?.world.symbols ?? []).filter((s) => under(s.file));
      world.setVitality(new Map([...files.map((p) => p.path), ...definitions.map((s) => s.id)].map((id) => [id, v])));
      return files.length;
    },
    /** The ground's own vitality and its area's at (x, z), or underfoot, as the grass, the ground and the water read them. */
    groundVitality: (x?: number, z?: number) => groundVitalityAt(x ?? world.walker.x, z ?? world.walker.z),
    /** The air last laid where the eye is: the ground's decline around it, its height above the land, and the air itself. */
    air: () => world.breathed,
    understory: () => world.understory.stats(),
    /** A hash of the baked land (heights, water levels and shore distances), to prove a change to the bake leaves it byte for byte. */
    bakeHash: () => contentHash(world.terrain.lattice.heights, world.terrain.waterLevel, world.terrain.shore),
    /** Copies and triangles each kind of the understory drew in the last pass. */
    understoryDrawn: () => world.understory.drawnByKind(),
    /** Shows or hides the wild bushes, for comparing frame costs. */
    showWilds: (on: boolean) => world.wildGrowth.show(on),
    /** The wild bushes: copies standing and drawn in the last pass, per blueprint, and each blueprint's triangles. */
    wilds: () => world.wildGrowth.all().map((v) => ({ standing: v.count, perCopy: v.triangles / Math.max(1, v.count), levels: v.levels, ...v.drawn() })),
    placements: () => world.understory.placements(),
    showUnderstory: (on: boolean) => world.understory.show(on),
    /** Shows or hides what drifts through the air, for comparing frame costs. */
    showDrifts: (on: boolean) => {
      world.drifts.object.visible = on;
    },
    /** Each form drifting: how full its fullest region holds it, 0 to 1, how many of its things can show, and how many trees drop it now. */
    drifts: () => world.drifts.state(),
    /** Shows or hides the grass, for comparing frame costs and looking at the bare ground. */
    showGrass: (on: boolean) => {
      world.grass.mesh.visible = on;
    },
    /**
     * Holds the point every detail is chosen from (the trees' and bushes'
     * levels and thinning, the grass, the ground's rings and the wild
     * bushes) at (x, z), at the eye's height, while the view stays put; or
     * lets it follow the eye again (null). Moving only this point shows
     * exactly what a step of walking changes in the detail drawn.
     */
    detailCenter: (at: [number, number] | null) => {
      world.detailPin = at === null ? null : { x: at[0], z: at[1] };
    },
    /**
     * Draws one frame and counts each kind's draw calls and triangles in
     * each pass (the sun's shadow, the water's mirror and the view), from
     * what the renderer actually drew.
     */
    drawn: () => {
      const kinds = new Map<THREE.Object3D, string>();
      const name = (kind: string, objects: readonly (THREE.Object3D | undefined)[]): void => {
        for (const o of objects) if (o !== undefined) kinds.set(o, kind);
      };
      name("trees", world.treeViews.map((v) => v.object));
      name("understory", [...world.understory.all().map((v) => v.object), ...world.understory.quiet()]);
      name("wild bushes", world.wildGrowth.all().map((v) => v.object));
      // Each set's cards draw in one batch: the trees', and the bushes', stones' and flowers'.
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
    /** The ramp test: what each frame of a vitality ramp changes, against the wind (see `vitalityRamp`). */
    ramp: vitalityRamp,
    /** Lets every change in vitality settle at once, so what is drawn next shows exactly the vitality set. */
    settleVitality: () => settleVitality(),
    /**
     * The stand check. The person stands still for `seconds` with the wind's
     * clock frozen while the page goes on as it does, the journal's painter
     * included; every half second their view is drawn and held against the
     * first. Nothing they see may change. Returns the worst change, and each
     * look's [seconds, change, level 0's window].
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
     * The painter check. With the person standing still and the wind's clock
     * frozen, asks one at a time for paintings of the `count` things farthest
     * from them, as the journal does, while the page's own frames go on.
     * Every 100 ms, and once each painting is done, the person's view is
     * drawn and held against how it was: a painting must change nothing the
     * person sees. Returns the worst change, the frames' intervals while
     * painting, milliseconds, and the first painting as a JPEG. Without
     * `look` it only paints, so the frames' intervals are the painter's own;
     * with `near` it paints the nearest things instead, which need no land
     * of their own, for comparing what a painting costs by itself.
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
    /** The swap test (`swapTest`) for preset `name` at `vitality`, and every tree and bush preset's name with none. */
    swap: (name?: string, vitality = 1) => (name === undefined ? farPresets().map((p) => p.name) : swapTest(name, vitality)),
    /** Resolves once the bushes' far forms, which come in after the wait lifts, are in too, and both sets have settled. */
    farReady: () => world.bushesBaked,
    /** Resolves once both sets' far forms have settled where the person stands now: none being brought or turning. */
    farSettled: () => Promise.all([world.treeSet.stream.settled(), world.bushSet.stream.settled()]).then(() => undefined),
    /** Walks as a person would for `seconds` of real time (`wander`). */
    wander,
    /** Shows or hides the far trees' cards alone, for seeing what they draw. */
    showFarTrees: (on: boolean) => world.treeSet.forms.cards.show(on),
    /** Shows or hides every tree, for comparing frame costs. */
    showTrees: (on: boolean) => {
      for (const v of world.treeViews) v.object.visible = on;
    },
    /** Draw calls in one whole frame: the shadow pass and the view together. */
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
    /** The body now: its speed, its eyes' ride and what the stride adds, and the footing under it. */
    gait: () => (world.body === null ? null : { speed: Math.hypot(world.body.vx, world.body.vz), eye: world.body.eye, camera: world.camera.position.y, footing: footingAt(world.terrain, world.decks, world.walker.x, world.walker.z) }),
    /** Every footbridge deck a walk stands on: its middle, the way it runs along, its span and its top at the middle. */
    decks: () => world.decks.flatMap((d) => ("tops" in d ? [] : [{ x: d.x, z: d.z, along: [d.cos, -d.sin], span: d.half * 2, width: d.halfWidth * 2, top: d.base + d.topAt(0) }])),
    /** The ground (bridges left out), how a person stood there before decks, and the footing now, at each (x, z). */
    profile: (points: readonly (readonly [number, number])[]) =>
      points.map(([x, z]) => {
        const s = stanceAt(world.terrain, x, z);
        const f = footingAt(world.terrain, world.decks, x, z);
        return { ground: groundHeightAt(world.terrain, x, z), eye: s.eye, depth: s.depth, swim: s.swim, footing: f.ground, deck: f.deck };
      }),
    /**
     * Walks the world's own walk for `seconds` at 60 frames a second without
     * drawing, holding `keys` (codes) for `hold` seconds or walking a tap to
     * `to`, and records each frame: [t, x, z, speed, camera y, eye ride, footing, depth, on a deck, facing (yaw)].
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
    /** How far (x, z) is from the nearest solid's edge, at most 2 m; negative inside one. */
    clearance: (x: number, z: number) => clearanceAt(world.solids, x, z),
    /** The trunks, rocks and bushes and walls that stop a walker. */
    solids: () => world.solids.count,
    /** The eyes' height, the water's depth and how far the person swims where they stand. */
    stance: () => stanceAt(world.terrain, world.walker.x, world.walker.z),
    /** Where the ground at (x, z) shows on screen, in CSS pixels from the page's top left; null when it is behind the view. */
    onScreen: (x: number, z: number) => {
      const p = new THREE.Vector3(x, groundHeightAt(world.terrain, x, z), z).project(world.camera);
      if (p.z > 1) return null;
      const rect = world.canvas.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    ponds: () => world.terrain.ponds.map((p) => ({ x: p.x, z: p.z, reach: p.reach })),
    plants: () => world.trees.map((t) => ({ x: t.x, z: t.z, height: (world.variants[t.variant] as TreeVariant).height * t.scale, region: regionAt(t.x, t.z), preset: composedName(world.treeBlueprints[t.variant] as Blueprint), vitality: t.represented.vitality })),
    /**
     * Stands every tree that stands for code `copies` times, each copy on its own patch, for measuring at scale;
     * 1 stands the world as it is. The bake thread stands them again. Never in a world a person walks.
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
      /** The crown span trees turn far at, in device pixels (`FAR.swapPx`). */
      swapPx: FAR.swapPx,
      /** Milliseconds bringing the trees' far forms took, baking or reading them, and then the bushes'. */
      farBakeMs: world.treeSet.stream.stats().ms,
      bushBakeMs: world.bushSet.stream.stats().ms,
      /**
       * Each set's far forms: its slots and the forms holding them, the GPU memory the slots take (MB), the forms a
       * view would draw far and their far copies, those drawn as cards now, and the forms read and baked so far.
       */
      treeCards: farCards(world.treeSet),
      bushCards: farCards(world.bushSet),
      /** The understory's distinct builds by group: one for each distinct blueprint its things take. */
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
            standingSymbols: world.symbolPlacements.filter((k) => k >= 0).length,
            patches: world.code.world.patches.length,
            things: world.code.world.things.map((t) => ({ path: t.path, name: t.name, as: t.as, blueprint: t.blueprint.id, x: Math.round(t.x), z: Math.round(t.z), vitality: +t.vitality.toFixed(2) })),
            trails: world.code.world.trails.map((t) => `${t.from}->${t.to}`),
          },
  };
}
