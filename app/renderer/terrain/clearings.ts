// Where grass does not grow: the ground under rocks and bushes, as a mask the
// grass shader reads, so no blade ever pierces a stone. Each cleared shape
// follows its component's own outline at the ground, not a disc. The same
// mask holds capsules of ground kept bare, such as buildings' floors and
// walks and landmarks' feet, however many a world has. A second mask holds
// where grass grows only as short turf, round things too low to show over it,
// such as a drift of mushrooms. Only the grass reads them, and the grass grows
// only around the person, so each mask is a window of the land's mask around
// the grass, drawn again from the outlines and capsules as the grass moves on.

import * as THREE from "three";
import type { Capsule, Terrain } from "@gaia/terrain";

/** Meters per mask texel. */
const RESOLUTION = 0.5;

/** How far past its outline a patch of short turf eases back into the grass around it, meters. */
const TURF_EASE = 0.9;

/**
 * The window: texels per side (256 m, the grass reaching 62 m from its
 * middle), and how far, in texels, the grass may move from the window's
 * middle before it is drawn again around it.
 */
const WINDOW = { size: 512, recenter: 64 } as const;

/** Meters a side of the cells the outlines are sorted into, so drawing a window visits only the outlines near it. */
const CELL = 64;

/** A component's reach at the ground in each of `outline.length` directions around it, at scale 1. */
export interface Clearing {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly outline: Float32Array;
  /** Short turf within the outline, rather than bare ground. */
  readonly turf?: boolean;
}

export interface Clearings {
  readonly uniforms: {
    readonly uClearing: { value: THREE.DataTexture };
    /** Where the grass grows only as short turf: the same window, 1 in the turf. */
    readonly uTurf: { value: THREE.DataTexture };
    /** The window's corner on the ground, x and z. */
    readonly uClearingOrigin: { value: THREE.Vector2 };
    /** The window's side, meters. */
    readonly uClearingSize: { value: number };
  };
  /** Clears the ground under each component's outline (or keeps it short turf), and the capsules set last. */
  update(clearings: readonly Clearing[]): void;
  /** Takes on a bake of another size; the mask is drawn again by the next `update`. */
  fit(t: Terrain): void;
  /** Ground kept bare whatever the components are, such as buildings and their walks; drawn by the next `update`, and kept until set again. */
  setCapsules(capsules: readonly Capsule[]): void;
  /** Keeps the window around the grass's middle at (x, z), drawing it again once the grass has moved far enough. */
  follow(x: number, z: number): void;
}

/** The first position in `list` holding `v` or more; `list` never decreases. */
function from(list: Int32Array, v: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createClearings(t: Terrain): Clearings {
  let l = t.lattice;
  /** Texels per side of the land's whole mask, which the window is a part of. */
  let n = Math.ceil(((l.n - 1) * l.spacing) / RESOLUTION);
  const { size } = WINDOW;
  const mask = (): { data: Uint8Array; texture: THREE.DataTexture } => {
    const data = new Uint8Array(size * size);
    const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return { data, texture };
  };
  const { data, texture } = mask();
  const turf = mask();
  const uniforms = {
    uClearing: { value: texture },
    uTurf: { value: turf.texture },
    uClearingOrigin: { value: new THREE.Vector2() },
    uClearingSize: { value: size * RESOLUTION },
  };
  let outlines: readonly Clearing[] = [];
  /** Each outline's farthest reach, meters. */
  let reaches = new Float64Array(0);
  /** The land's first sample in z: the page's land is a window around the person, so it need not match x's. */
  const originZ = (): number => l.originZ ?? l.origin;
  /**
   * The outlines by the cell of `CELL` meters over the land's mask their
   * middles lie in (past it, its edge cell): cell k's are `order` from
   * `starts[k]` to `starts[k + 1]`. `reach` is the farthest any reaches.
   * The cells start at the land's first sample when they were sorted
   * (`x`, `z`), since the land's window moves on with the person.
   */
  let cells = { side: 1, starts: new Int32Array(2), order: new Int32Array(0), reach: 0, x: 0, z: 0 };
  const cellAt = (v: number, from: number, side: number): number => Math.max(0, Math.min(side - 1, Math.floor((v - from) / CELL)));
  const sort = (): void => {
    const side = Math.max(1, Math.ceil((n * RESOLUTION) / CELL));
    const x = l.origin;
    const z = originZ();
    const of = Int32Array.from(outlines, (c) => cellAt(c.z, z, side) * side + cellAt(c.x, x, side));
    const starts = new Int32Array(side * side + 1);
    for (const k of of) starts[k + 1] = (starts[k + 1] as number) + 1;
    for (let k = 0; k < side * side; k++) starts[k + 1] = (starts[k + 1] as number) + (starts[k] as number);
    const next = starts.slice(0, side * side);
    const order = new Int32Array(outlines.length);
    of.forEach((k, o) => {
      order[next[k] as number] = o;
      next[k] = (next[k] as number) + 1;
    });
    let reach = 0;
    for (const r of reaches) reach = Math.max(reach, r);
    cells = { side, starts, order, reach, x, z };
  };
  let capsules: readonly Capsule[] = [];
  /** The window's first texel of the land's mask, x and z; null until drawn. */
  let corner: { i: number; j: number } | null = null;
  let middle = { x: 0, z: 0 };
  /** The land's mask texel under each of the window's columns and rows: past the land's mask, its edge, as a texture clamps. */
  const columns = new Int32Array(size);
  const rows = new Int32Array(size);
  /** Draws the land's mask over the window whose first texel is (i, j): each texel as the whole land's mask would hold it. */
  const draw = (i: number, j: number): void => {
    corner = { i, j };
    const oz = originZ();
    for (let k = 0; k < size; k++) {
      columns[k] = Math.max(0, Math.min(n - 1, i + k));
      rows[k] = Math.max(0, Math.min(n - 1, j + k));
    }
    uniforms.uClearingOrigin.value.set(l.origin + i * RESOLUTION, oz + j * RESOLUTION);
    data.fill(0);
    turf.data.fill(0);
    /**
     * Marks every texel of the window over mask texels [i0, i1] by [j0, j1]
     * by how far `inside` holds its middle, 0 to 1, keeping the most any shape
     * gives it, in `into` (the bare ground's mask unless given).
     */
    const clear = (i0: number, i1: number, j0: number, j1: number, inside: (x: number, z: number) => boolean | number, into: Uint8Array = data): void => {
      const c0 = from(columns, i0);
      const c1 = from(columns, i1 + 1);
      const r0 = from(rows, j0);
      const r1 = from(rows, j1 + 1);
      for (let r = r0; r < r1; r++) {
        const z = oz + ((rows[r] as number) + 0.5) * RESOLUTION;
        for (let c = c0; c < c1; c++) {
          const v = inside(l.origin + ((columns[c] as number) + 0.5) * RESOLUTION, z);
          const level = v === true ? 255 : v === false ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 255);
          if (level > (into[r * size + c] as number)) into[r * size + c] = level;
        }
      }
    };
    for (const c of capsules) {
      const i0 = Math.max(0, Math.floor((Math.min(c.ax, c.bx) - c.radius - l.origin) / RESOLUTION));
      const i1 = Math.min(n - 1, Math.ceil((Math.max(c.ax, c.bx) + c.radius - l.origin) / RESOLUTION));
      const j0 = Math.max(0, Math.floor((Math.min(c.az, c.bz) - c.radius - oz) / RESOLUTION));
      const j1 = Math.min(n - 1, Math.ceil((Math.max(c.az, c.bz) + c.radius - oz) / RESOLUTION));
      const abx = c.bx - c.ax;
      const abz = c.bz - c.az;
      const len = abx * abx + abz * abz;
      clear(i0, i1, j0, j1, (x, z) => {
        const t = len > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * abx + (z - c.az) * abz) / len)) : 0;
        return Math.hypot(x - c.ax - abx * t, z - c.az - abz * t) < c.radius;
      });
    }
    /** Draws outline o. */
    const outline = (o: number): void => {
      const c = outlines[o] as Clearing;
      const k = c.outline.length;
      const reach = reaches[o] as number;
      const i0 = Math.max(0, Math.floor((c.x - reach - l.origin) / RESOLUTION));
      const i1 = Math.min(n - 1, Math.ceil((c.x + reach - l.origin) / RESOLUTION));
      const j0 = Math.max(0, Math.floor((c.z - reach - oz) / RESOLUTION));
      const j1 = Math.min(n - 1, Math.ceil((c.z + reach - oz) / RESOLUTION));
      const cos = Math.cos(c.yaw);
      const sin = Math.sin(c.yaw);
      // Past its farthest reach, with room for rounding, no direction of the outline holds a texel.
      const beyond = (reach * (1 + 1e-6) + 1e-6) ** 2;
      clear(i0, i1, j0, j1, (x, z) => {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz > beyond) return false;
        // Back into the component's own frame: three's Y rotation turns local x to (cos, -sin).
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const a = ((Math.atan2(lz, lx) / (Math.PI * 2)) % 1 + 1) % 1;
        const r = (c.outline[Math.floor(a * k) % k] as number) * c.scale;
        const d = Math.hypot(lx, lz);
        // Turf eases back into the grass past its outline; bare ground stops at it.
        return c.turf === true ? Math.min(1, Math.max(0, 1 - (d - r) / TURF_EASE)) : d < r;
      }, c.turf === true ? turf.data : data);
    };
    // Only the cells whose outlines could reach the window's texels.
    const { side, starts, order, reach } = cells;
    const ci0 = cellAt(l.origin + (columns[0] as number) * RESOLUTION - reach, cells.x, side);
    const ci1 = cellAt(l.origin + ((columns[size - 1] as number) + 1) * RESOLUTION + reach, cells.x, side);
    const cj0 = cellAt(oz + (rows[0] as number) * RESOLUTION - reach, cells.z, side);
    const cj1 = cellAt(oz + ((rows[size - 1] as number) + 1) * RESOLUTION + reach, cells.z, side);
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        const cell = cj * side + ci;
        for (let q = starts[cell] as number; q < (starts[cell + 1] as number); q++) outline(order[q] as number);
      }
    }
    texture.needsUpdate = true;
    turf.texture.needsUpdate = true;
  };
  /** The window's first texel for grass around (x, z): on a step of `WINDOW.recenter`. */
  const cornerAt = (x: number, z: number): { i: number; j: number } => {
    const snap = (v: number, from: number): number => Math.round((v - from) / RESOLUTION / WINDOW.recenter) * WINDOW.recenter - size / 2;
    return { i: snap(x, l.origin), j: snap(z, originZ()) };
  };
  const redraw = (): void => {
    const at = cornerAt(middle.x, middle.z);
    draw(at.i, at.j);
  };
  return {
    uniforms,
    fit(next) {
      if (next.lattice.n === l.n && next.lattice.origin === l.origin) return;
      l = next.lattice;
      n = Math.ceil(((l.n - 1) * l.spacing) / RESOLUTION);
      sort();
      corner = null;
    },
    update(next) {
      outlines = next;
      reaches = Float64Array.from(next, (c) => {
        let reach = 0;
        for (const r of c.outline) reach = Math.max(reach, r);
        return reach * c.scale + (c.turf === true ? TURF_EASE : 0);
      });
      sort();
      redraw();
    },
    setCapsules(next) {
      capsules = next;
    },
    follow(x, z) {
      middle = { x, z };
      const at = cornerAt(x, z);
      if (corner !== null && at.i === corner.i && at.j === corner.j) return;
      draw(at.i, at.j);
    },
  };
}

/** Samples the masks: 1 where nothing grows, and 1 where only short turf grows, each easing to 0 across a texel. */
export const CLEARING_GLSL = /* glsl */ `
uniform sampler2D uClearing;
uniform sampler2D uTurf;
uniform vec2 uClearingOrigin;
uniform float uClearingSize;
float clearingAt(vec2 xz) {
  return texture2D(uClearing, (xz - uClearingOrigin) / uClearingSize).r;
}
float turfAt(vec2 xz) {
  return texture2D(uTurf, (xz - uClearingOrigin) / uClearingSize).r;
}
`;
