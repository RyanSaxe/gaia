// The world's understory: the stones, bushes and flowers that code
// stands as, one build of each distinct blueprint the world's things take
// (`OpenedWorld.plants`), drawn as one InstancedMesh per part and level of
// detail of each build, so a hundred bushes cost a handful of draw calls,
// and each pass draws only the cells it can see. Nothing here stands for
// nothing: the land between them is grass, ground and water.

import * as THREE from "three";
import type { Blueprint, Library } from "@gaia/schema";
import type { Realized } from "@gaia/realize";
import type { SceneLight } from "@gaia/render";
import type { Placement } from "@gaia/terrain";
import type { Clearings } from "./clearings.ts";
import type { PlantBuilds, PlantGroup } from "./code-world.ts";
import { type BuildAsk, made, plantAsk } from "./made.ts";
import { type Copies, FAR, type FarForms, type FarOf, createCopies } from "./woods.ts";

interface Group {
  readonly id: Exclude<PlantGroup, "trees">;
  /** Whether the group's instances draw into the sun's shadow map. */
  readonly casts: boolean;
  /** How much of its outline at the ground is kept clear of grass, 0 for none. */
  readonly clears: number;
  /**
   * A patch of short turf round each copy, for things too low to show over
   * the grass: how far past its outline the patch reaches, as a share of the
   * outline and in meters. Absent for none.
   */
  readonly turf?: { readonly share: number; readonly beyond: number };
  /**
   * The crown span, as a share of `FAR.swapPx`, at which a copy small on
   * screen draws as its build's far form, and its form bakes: one texel to a
   * pixel where it turns.
   */
  readonly far: number;
}

/** Each group the understory draws: a placement's rule names it, and its variant indexes the group's builds. */
const GROUPS: readonly Group[] = [
  { id: "rocks", casts: true, clears: 0.92, far: FAR.bush },
  { id: "shrubs", casts: true, clears: 0.55, far: FAR.bush },
  { id: "flowers", casts: false, clears: 0, far: FAR.bush },
  { id: "mushrooms", casts: false, clears: 0, turf: { share: 1.25, beyond: 0.35 }, far: FAR.bush },
];

/** The least a patch of turf reaches from a copy's middle, meters: a mask texel is half a meter, so a smaller patch could miss every texel. */
const TURF_LEAST = 0.6;

/**
 * A patch of turf round `outline`, reaching `turf` past it, never less than
 * `TURF_LEAST`, its edge wandering in and out a little so it reads as turf
 * worn short, not a cut disc.
 */
function turfOf(outline: Float32Array, turf: NonNullable<Group["turf"]>): Float32Array {
  const k = outline.length;
  return outline.map((r, i) => {
    const a = (i / k) * Math.PI * 2;
    return Math.max(TURF_LEAST, r * turf.share + turf.beyond * (1 + 0.3 * Math.sin(a * 3 + 1.3) + 0.2 * Math.sin(a * 5 + 0.4)));
  });
}

/** Every build the understory makes for a world's things, for making ahead: one per distinct blueprint. */
export const understoryBuilds = (plants: PlantBuilds): BuildAsk[] => GROUPS.flatMap((g) => plants[g.id].map(plantAsk));

/** A component's reach where it meets the ground, in 48 directions around its origin. */
function outlineOf(plant: Realized): Float32Array {
  const out = new Float32Array(48);
  for (const part of plant.parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1] as number;
      if (y < -0.02 || y > 0.25) continue;
      const x = p[i] as number;
      const z = p[i + 2] as number;
      const k = Math.floor(((((Math.atan2(z, x) / (Math.PI * 2)) % 1) + 1) % 1) * 48) % 48;
      out[k] = Math.max(out[k] as number, Math.hypot(x, z));
    }
  }
  // Fill directions no vertex fell in from their neighbors.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 48; k++) if (out[k] === 0) out[k] = Math.max(out[(k + 47) % 48] as number, out[(k + 1) % 48] as number);
  }
  return out;
}

export interface Understory {
  /** Stands exactly `placed`, what the bake stood for code, moving each blueprint's copies. */
  place(placed: readonly Placement[]): void;
  /** Instances that cast into the sun's shadow map. */
  readonly casters: () => readonly Copies[];
  /** Objects the shadow pass hides: drifts of flowers are too fine to cast. */
  readonly quiet: () => readonly THREE.Object3D[];
  /** Every instanced blueprint, for culling each pass and forcing detail. */
  readonly all: () => readonly Copies[];
  /** Every instanced blueprint and the group it stands for, such as "rocks", for counting what each kind draws. */
  readonly grouped: () => readonly { readonly group: string; readonly view: Copies }[];
  readonly placements: () => readonly Placement[];
  /**
   * Makes the instances of every blueprint `placements` uses that has none
   * yet, one blueprint between each `wait`, so standing them (`place`) only
   * moves copies. They are made in the order `place` would make them.
   */
  prepare(placements: readonly Placement[], wait: () => Promise<void>): Promise<void>;
  /** Sets each placement's vitality, by its index in `placements()`, on its copy; nothing moves or rebuilds. */
  setVitality(vitality: ArrayLike<number>): void;
  /** A placed component's reach at the ground in 48 directions and its top above its origin, at scale 1, by the rule and variant its placement names. */
  readonly footprint: (rule: string, variant: number) => { readonly outline: Float32Array; readonly top: number } | undefined;
  /** Shows or hides everything, for comparing frame costs. */
  show(on: boolean): void;
  /** What was placed, its triangles at full detail, its meshes, and the triangles the last pass drew. */
  readonly stats: () => { placed: Record<string, number>; triangles: number; meshes: number; drawn: number };
  /** Copies and triangles each kind of the understory drew in the last pass. */
  readonly drawnByKind: () => Record<string, { copies: number; triangles: number }>;
  /**
   * Makes one build of every distinct blueprint the world's things take and its far form, once, when the world opens
   * and before anything stands: `place` then only moves copies.
   */
  build(plants: PlantBuilds): void;
  /** Each build that turns far, with its blueprint: what the swap test stands alone. */
  readonly farBuilds: () => readonly { readonly blueprint: Blueprint; readonly plant: () => Realized; readonly far: FarOf }[];
}

/** `farForms` takes the far form of every build whose group turns far; without it, nothing does. */
export function createUnderstory(scene: THREE.Scene, light: SceneLight, lib: Library, clearings: Clearings, farForms?: FarForms): Understory {
  const buildGroup = (g: Group, blueprints: readonly Blueprint[]) => {
    const asks = blueprints.map(plantAsk);
    const fresh = asks.map((ask) => made(ask, lib));
    const reach = fresh.map(outlineOf);
    const tops = fresh.map((p) => p.parts.reduce((top, part) => part.positions.reduce((t, v, i) => (i % 3 === 1 ? Math.max(t, v) : t), top), 0));
    const far = fresh.map((p) => farForms?.add(p, g.far));
    // Each build is held only until its instances are made (`instancesOf`) and its far form baked; asked for after
    // that, it is realized again, the same build.
    const plants: (Realized | null)[] = [...fresh];
    const plant = (variant: number): Realized => plants[variant] ?? made(asks[variant] as BuildAsk, lib);
    const turf = g.turf;
    return { group: g, blueprints, plants, plant, far, reach, tops, outlines: reach.map((o) => o.map((r) => r * g.clears)), turfs: turf === undefined ? undefined : reach.map((o) => turfOf(o, turf)) };
  };
  let built: ReturnType<typeof buildGroup>[] = [];
  const views: { group: Group; view: Copies }[] = [];
  /** Each blueprint's instances by rule and variant, kept for the life of the world. */
  const kept = new Map<string, { group: Group; view: Copies }>();
  let placed: readonly Placement[] = [];
  /** Each placement's blueprint and its copy among that blueprint's instances. */
  let copies: readonly { readonly key: string; readonly copy: number }[] = [];
  return {
    build(plants) {
      if (built.length > 0) throw new Error("The understory builds a world's blueprints once, when it opens.");
      built = GROUPS.map((g) => buildGroup(g, plants[g.id]));
    },
    farBuilds: () =>
      built.flatMap(({ blueprints, plant, far }) =>
        blueprints.flatMap((blueprint, i) => {
          const f = far[i];
          return f === undefined ? [] : [{ blueprint, plant: () => plant(i), far: f }];
        }),
      ),
    place(given) {
      placed = given;
      clearings.update(
        placed.flatMap((p) => {
          const b = built.find((x) => x.group.id === p.rule);
          const outline = b?.outlines[p.variant];
          const turf = b?.turfs?.[p.variant];
          const at = { x: p.x, z: p.z, yaw: p.yaw, scale: p.scale };
          return [
            ...(b === undefined || outline === undefined || b.group.clears === 0 ? [] : [{ ...at, outline }]),
            ...(turf === undefined ? [] : [{ ...at, outline: turf, turf: true }]),
          ];
        }),
      );
      // Each blueprint keeps its instances from bake to bake and only moves its
      // copies, so a new world never rebuilds a blueprint's geometry or levels.
      for (const { group, plants, plant, far } of built) {
        plants.forEach((_, variant) => {
          const spots = placed
            .filter((p) => p.rule === group.id && p.variant === variant)
            .map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale, hue: ((((p.x * 12.9898 + p.z * 78.233) % 1) + 1) % 1) * 0.04 - 0.02, ...(p.vitality === undefined ? {} : { vitality: p.vitality }), ...(p.slope === undefined ? {} : { slope: p.slope }) }));
          const key = `${group.id}/${variant}`;
          const had = kept.get(key);
          if (had !== undefined) {
            had.view.respot(spots);
            return;
          }
          if (spots.length === 0) return;
          const view = createCopies(plant(variant), light, spots, far[variant]);
          plants[variant] = null;
          scene.add(view.object);
          const entry = { group, view };
          kept.set(key, entry);
          views.push(entry);
        });
      }
      const counts = new Map<string, number>();
      copies = placed.map((p) => {
        const key = `${p.rule}/${p.variant}`;
        const copy = counts.get(key) ?? 0;
        counts.set(key, copy + 1);
        return { key, copy };
      });
    },
    async prepare(given, wait) {
      for (const { group, plants, plant, far } of built) {
        for (const variant of plants.keys()) {
          const key = `${group.id}/${variant}`;
          if (kept.has(key) || !given.some((p) => p.rule === group.id && p.variant === variant)) continue;
          const view = createCopies(plant(variant), light, [], far[variant]);
          plants[variant] = null;
          scene.add(view.object);
          const entry = { group, view };
          kept.set(key, entry);
          views.push(entry);
          await wait();
        }
      }
    },
    setVitality(vitality) {
      copies.forEach((c, i) => kept.get(c.key)?.view.setVitalityAt(c.copy, vitality[i] ?? 1));
    },
    casters: () => views.filter((v) => v.group.casts).map((v) => v.view),
    quiet: () => views.filter((v) => !v.group.casts).map((v) => v.view.object),
    all: () => views.map((v) => v.view),
    grouped: () => views.map((v) => ({ group: v.group.id, view: v.view })),
    placements: () => placed,
    footprint: (rule, variant) => {
      const b = built.find((x) => x.group.id === rule);
      const outline = b?.reach[variant];
      return b === undefined || outline === undefined ? undefined : { outline, top: b.tops[variant] ?? 0 };
    },
    show(on) {
      for (const v of views) v.view.object.visible = on;
    },
    drawnByKind: () => {
      const by: Record<string, { copies: number; triangles: number }> = {};
      for (const { group, view } of views) {
        const d = view.drawn();
        const sum = (by[group.id] ??= { copies: 0, triangles: 0 });
        sum.copies += d.copies;
        sum.triangles += d.triangles;
      }
      return by;
    },
    stats: () => ({
      placed: Object.fromEntries(GROUPS.map((g) => [g.id, placed.filter((p) => p.rule === g.id).length])),
      triangles: views.reduce((n, v) => n + v.view.triangles, 0),
      meshes: views.reduce((n, v) => n + v.view.object.children.length, 0),
      drawn: views.reduce((n, v) => n + v.view.drawn().triangles, 0),
    }),
  };
}
