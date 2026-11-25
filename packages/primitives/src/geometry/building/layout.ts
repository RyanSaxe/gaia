// Lays out a building's plan: its massing (the volumes and the roof over
// each), then where its door and windows go. Each volume is a `Mass`. Joined
// masses overlap by `OVERLAP`, so hidden walls never show and every roof meets
// the walls under it.

import type {
  BuildContext,
  BuildingPlan,
  Mass,
  Opening,
  Rand,
  Resolved,
  RoofForm,
} from "@gaia/schema";
import type { cottagePlanParams } from "../../structure.ts";
import { clamp } from "../kit.ts";
import {
  DEEPEST_EAVE,
  DOOR_HEADROOM,
  type Wall,
  chimneyEnd,
  hidden,
  massOf,
  on,
  peakOf,
  placeOf,
  sameWall,
  shownWalls,
  topAt,
  wallTop,
  wallsOf,
} from "./frame.ts";

/** Floor-to-floor height in meters. */
const STOREY = 2.3;
/** The most windows a building has, however many walls it shows. */
const MAX_WINDOWS = 14;
/** How far a joined mass reaches into the one it joins, so their walls never meet face to face. */
const OVERLAP = 0.45;

const wallFor = (storeys: number): number => 2.45 + (storeys - 1) * STOREY;
/** A door's height, meters, and the least wall above it to the eaves. */
const DOOR_HEIGHT = 1.95;
const DOOR_LINTEL = 0.32;
/** The most a settled roof's eave dips below its wall top, meters (`thatchSlab` and `tileSlab` in roofs.ts). */
const EAVE_DIP = 0.16;

type Face = readonly [number, number];

interface Massing {
  readonly pitch: number;
  readonly form: RoofForm;
}

/** A mass with its roof's rise: the pitch over half the span, 0.9 of that for a lean-to, and 0.95 of the width for a turret's cone. */
function massAt(
  g: Massing,
  m: Omit<Mass, "rise" | "fall" | "ends"> & {
    fall?: 1 | -1;
    ends?: readonly [boolean, boolean];
  },
): Mass {
  const halfSpan = (m.ridge === "x" ? m.depth : m.width) / 2;
  let rise = g.pitch * halfSpan;
  if (m.roof === "cone") {
    rise = m.width * 0.95;
  } else if (m.roof === "lean-to") {
    rise = g.pitch * halfSpan * 0.9;
  }
  return { ...m, rise, fall: m.fall ?? 1, ends: m.ends ?? [true, true] };
}

/**
 * A wing joined to the face of `host` whose outward normal is `face`. `t`
 * places it along the face, from -1 (flush with one end) to 1 (flush with the
 * other). It is `wide` along the face and reaches `out` from it. Its ridge
 * runs out from the face, so its gable faces outward.
 */
function wing(
  g: Massing,
  host: Mass,
  face: Face,
  t: number,
  wide: number,
  out: number,
  storeys: number,
  roof: RoofForm,
): Mass {
  const alongX = face[1] !== 0;
  const halfFace = (alongX ? host.width : host.depth) / 2;
  const along = t * Math.max(0, halfFace - wide / 2);
  const reach = out + OVERLAP;
  // Its inner end runs into the host, so only its outer end is hipped.
  const outward = face[0] + face[1] > 0;
  const fx =
    host.x + face[0] * (host.width / 2) + (face[0] * (out - OVERLAP)) / 2;
  const fz =
    host.z + face[1] * (host.depth / 2) + (face[1] * (out - OVERLAP)) / 2;
  return massAt(g, {
    x: alongX ? host.x + along : fx,
    z: alongX ? fz : host.z + along,
    width: alongX ? wide : reach,
    depth: alongX ? reach : wide,
    round: false,
    wallHeight: wallFor(storeys),
    storeys,
    ridge: alongX ? "z" : "x",
    roof,
    ends: outward ? [false, true] : [true, false],
  });
}

/** A low lean-to against a face of `host`, its one slope falling away from it and its top tucked under the host's eaves. */
function leanTo(
  g: Massing,
  host: Mass,
  face: Face,
  t: number,
  wide: number,
  out: number,
): Mass {
  const w = wing(g, host, face, t, wide, out, 1, "lean-to");
  const wallHeight = 2.05;
  const rise = Math.min(
    host.wallHeight - 0.35 - wallHeight,
    g.pitch * 0.55 * (out + OVERLAP),
  );
  return {
    ...w,
    ridge: face[1] === 0 ? "z" : "x",
    wallHeight,
    rise: Math.max(0.5, rise),
    fall: (face[0] + face[1]) as 1 | -1,
  };
}

/** Whether `m` overlaps any mass other than `host`. Attachments check it so they never run into each other. */
const clashes = (masses: readonly Mass[], m: Mass, host: number): boolean =>
  masses.some(
    (o, i) =>
      i !== host &&
      Math.abs(o.x - m.x) < (o.width + m.width) / 2 - 0.2 &&
      Math.abs(o.z - m.z) <
        ((o.round ? o.width : o.depth) + (m.round ? m.width : m.depth)) / 2 -
          0.2,
  );

function roofFormOf(
  roof: Resolved<typeof cottagePlanParams>["roof"],
): RoofForm {
  if (roof === "hipped") return "hip";
  if (roof === "half-hipped") return "half-hip";
  return "gable";
}

function shapeFootprint(
  shape: Resolved<typeof cottagePlanParams>["shape"],
): readonly [number, number] {
  if (shape === "long") return [7.8, 5.4];
  if (shape === "snug") return [6.2, 5.3];
  return [5.2, 7.2];
}

function appendInLine(
  masses: Mass[],
  g: Massing,
  host: number,
  face: Face,
  share: number,
  n: number,
  alongX: boolean,
): Mass {
  const h = masses[host] as Mass;
  const end = face[0] + face[1] > 0 ? 1 : 0;
  masses[host] = {
    ...h,
    ends: end === 1 ? [h.ends[0], false] : [false, h.ends[1]],
  };
  return wing(
    g,
    h,
    face,
    0,
    (alongX ? h.depth : h.width) * share,
    (alongX ? h.width : h.depth) * 0.62,
    n,
    g.form,
  );
}

function addClusterMassing(
  masses: Mass[],
  g: Massing,
  main: Mass,
  side: 1 | -1,
  storeys: number,
  alongX: boolean,
  lower: (n: number) => number,
  forwardWing: (t: number) => Mass,
  sideWing: (s: number, t: number) => Mass,
): void {
  masses.push(alongX ? forwardWing(side) : sideWing(side, -1));
  const lineFace: Face = alongX ? [-side, 0] : [0, -1];
  masses.push(
    appendInLine(masses, g, 0, lineFace, 0.86, lower(storeys), alongX),
  );
  const back = alongX
    ? wing(
        g,
        main,
        [0, -1],
        side * 0.6,
        clamp(0.5 * main.depth, 2.8, 3.8),
        0.4 * main.depth + 1,
        lower(lower(storeys)),
        g.form,
      )
    : sideWing(-side, 0.6);
  if (!clashes(masses, back, 0)) masses.push(back);
}

function addMassing(
  masses: Mass[],
  g: Massing,
  main: Mass,
  p: Resolved<typeof cottagePlanParams>,
  side: 1 | -1,
  storeys: number,
  alongX: boolean,
  lower: (n: number) => number,
): number {
  const W = main.width;
  const D = main.depth;
  const span = alongX ? D : W;
  const forwardWing = (t: number): Mass =>
    wing(
      g,
      main,
      [0, 1],
      t,
      clamp(0.68 * D, 3.2, 4.6),
      0.55 * D + 1.3,
      lower(storeys),
      g.form,
    );
  const sideWing = (s: number, t: number): Mass =>
    wing(
      g,
      main,
      [s, 0],
      t,
      clamp(0.66 * D * 0.8, 3.2, 4.4),
      0.55 * W + 1.2,
      lower(storeys),
      g.form,
    );

  if (p.massing === "an L") {
    masses.push(alongX ? forwardWing(side) : sideWing(side, -1));
    return 0;
  }
  if (p.massing === "a T") {
    if (alongX) {
      masses.push(
        wing(
          g,
          main,
          [0, 1],
          0,
          clamp(0.5 * W, 3, 0.8 * span),
          0.5 * D + 1.1,
          storeys,
          g.form,
        ),
      );
      return 1;
    }
    masses.push(sideWing(1, -0.3), sideWing(-1, -0.3));
    return 0;
  }
  if (p.massing === "a long range") {
    const face: Face = alongX ? [side, 0] : [0, -1];
    // Each block is a little narrower than the last, so the ridges step down even when the eaves line up.
    masses.push(appendInLine(masses, g, 0, face, 0.84, lower(storeys), alongX));
    masses.push(
      appendInLine(
        masses,
        g,
        1,
        face,
        0.82,
        lower((masses[1] as Mass).storeys),
        alongX,
      ),
    );
    return 0;
  }
  if (p.massing === "a cluster") {
    addClusterMassing(
      masses,
      g,
      main,
      side,
      storeys,
      alongX,
      lower,
      forwardWing,
      sideWing,
    );
  }
  return 0;
}

function addLeanTo(
  masses: Mass[],
  g: Massing,
  main: Mass,
  side: 1 | -1,
  alongX: boolean,
): void {
  const candidates: [Face, number][] = alongX
    ? [
        [[0, -1], -side * 0.3],
        [[-side, 0], 0],
        [[side, 0], 0],
      ]
    : [
        [[-side, 0], 0.35],
        [[side, 0], 0.4],
        [[0, -1], 0],
      ];
  for (const [face, t] of candidates) {
    const shed = leanTo(
      g,
      main,
      face,
      t,
      Math.min(0.62 * (face[1] === 0 ? main.depth : main.width), 5),
      2.1,
    );
    if (!clashes(masses, shed, 0)) {
      masses.push(shed);
      break;
    }
  }
}

function addTurret(
  masses: Mass[],
  g: Massing,
  main: Mass,
  side: 1 | -1,
  storeys: number,
): void {
  const across = clamp(0.44 * Math.min(main.width, main.depth), 2.5, 3.3);
  for (const [sx, sz] of [
    [-side, 1],
    [side, 1],
    [-side, -1],
    [side, -1],
  ] as const) {
    const turret = massAt(g, {
      x: sx * (main.width / 2 - across * 0.12),
      z: sz * (main.depth / 2 - across * 0.12),
      width: across,
      depth: across,
      round: true,
      wallHeight: main.wallHeight + 2.3,
      storeys: storeys + 1,
      ridge: "x",
      roof: "cone",
    });
    if (!clashes(masses, turret, 0)) {
      masses.push(turret);
      break;
    }
  }
}

function recenterPlan(
  masses: readonly Mass[],
  p: Resolved<typeof cottagePlanParams>,
): BuildingPlan {
  const x0 = Math.min(...masses.map((m) => m.x - m.width / 2));
  const x1 = Math.max(...masses.map((m) => m.x + m.width / 2));
  const z0 = Math.min(
    ...masses.map((m) => m.z - (m.round ? m.width : m.depth) / 2),
  );
  const z1 = Math.max(
    ...masses.map((m) => m.z + (m.round ? m.width : m.depth) / 2),
  );
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const placed = masses.map((m) => ({ ...m, x: m.x - cx, z: m.z - cz }));
  return {
    width: x1 - x0,
    depth: z1 - z0,
    floor: p.base,
    footing: 1.4,
    masses: placed,
    settle: p.character,
    openings: [],
  };
}

function seatDoor(
  plan: BuildingPlan,
  w: Wall,
  from: number,
  lean: number,
): number | undefined {
  const shows = (at: number): boolean =>
    at >= 0.7 &&
    at <= w.length - 0.7 &&
    !hidden(plan, w, at - 0.7, 1) &&
    !hidden(plan, w, at + 0.7, 1);
  return Array.from(
    { length: 8 * Math.ceil(w.length) + 1 },
    (_, k) => from + (k % 2 === 1 ? -lean : lean) * Math.ceil(k / 2) * 0.25,
  ).find(shows);
}

function fallbackDoorWall(
  plan: BuildingPlan,
  skipMass: number,
  lean: number,
): { entry: number; doorWall: Wall; doorAt: number } | undefined {
  for (const w of wallsOf(plan)) {
    if (w.n[2] < 0.99 || w.mass === skipMass) continue;
    const doorAt = seatDoor(plan, w, w.length / 2, lean);
    if (doorAt !== undefined) {
      return { entry: w.mass, doorWall: w, doorAt };
    }
  }
  return undefined;
}

function findDoorPlacement(
  plan: BuildingPlan,
  initialEntry: number,
  p: Resolved<typeof cottagePlanParams>,
  side: 1 | -1,
  alongX: boolean,
): { entry: number; doorWall: Wall; doorAt: number } {
  const doorWall = wallsOf(plan).find(
    (w) => w.mass === initialEntry && w.n[2] > 0.99,
  ) as Wall;
  // The door is off center on a long front, away from a forward wing beside it.
  const onMainAlongX = alongX && initialEntry === 0;
  const single = p.massing === "a single block";
  const lean = onMainAlongX && !single ? -side : side;
  const leaning =
    doorWall.length / 2 +
    (onMainAlongX ? lean * doorWall.length * (single ? 0.12 : 0.16) : 0);
  const doorAt = seatDoor(plan, doorWall, leaning, lean);
  if (doorAt !== undefined) {
    return { entry: initialEntry, doorWall, doorAt };
  }
  // When a turret or wing leaves no room on that front, the door goes on another front that has room.
  const fallback = fallbackDoorWall(plan, initialEntry, lean);
  if (fallback !== undefined) return fallback;
  return {
    entry: initialEntry,
    doorWall,
    doorAt: clamp(leaning, 0.7, doorWall.length - 0.7),
  };
}

function addDoorAndPorch(
  plan: BuildingPlan,
  g: Massing,
  p: Resolved<typeof cottagePlanParams>,
  extras: ReadonlySet<string>,
  side: 1 | -1,
  alongX: boolean,
  initialEntry: number,
): { plan: BuildingPlan; entry: number; porched: boolean } {
  let { entry, doorWall, doorAt } = findDoorPlacement(
    plan,
    initialEntry,
    p,
    side,
    alongX,
  );
  const entryMass = plan.masses[entry] as Mass;
  const t = clamp(
    (doorAt - doorWall.length / 2) / Math.max(0.01, doorWall.length / 2 - 1.15),
    -1,
    1,
  );
  // A porch is always gabled, so its front is a gable over the door and no eave comes down across it.
  const porch = {
    ...wing(g, entryMass, [0, 1], t, 2.3, 1.75, 1, "gable"),
    wallHeight: 2.3,
  };
  // A porch is added only where it overlaps no other mass.
  const porched = extras.has("porch") && !clashes(plan.masses, porch, entry);
  let nextPlan = plan;
  if (porched) {
    nextPlan = { ...plan, masses: [...plan.masses, porch] };
    entry = nextPlan.masses.length - 1;
    doorWall = wallsOf(nextPlan).find(
      (w) => w.mass === entry && w.n[2] > 0.99,
    ) as Wall;
    doorAt = doorWall.length / 2;
  }
  const doorMass = nextPlan.masses[entry] as Mass;
  const door: Opening = {
    kind: "door",
    mass: entry,
    position: on(doorWall, doorAt, nextPlan.floor),
    normal: doorWall.n,
    width: 0.96,
    height: Math.min(DOOR_HEIGHT, doorMass.wallHeight - DOOR_LINTEL),
  };
  return {
    plan: { ...nextPlan, openings: [door] },
    entry,
    porched,
  };
}

function windowFits(
  at: BuildingPlan,
  placed: readonly Opening[],
  w: Wall,
  s: number,
  y: number,
  ww: number,
  hh: number,
): boolean {
  if (s - ww / 2 <= 0.45 || s + ww / 2 >= w.length - 0.45) return false;
  if (
    y + hh >=
    Math.min(topAt(at, w, s - ww / 2), topAt(at, w, s + ww / 2)) - 0.22
  ) {
    return false;
  }
  if (
    [s - ww / 2, s, s + ww / 2].some(
      (q) => hidden(at, w, q, y) || hidden(at, w, q, y + hh),
    )
  ) {
    return false;
  }
  return !placed.some((o) => {
    const there = placeOf(at, o);
    return (
      sameWall(there.wall, w) &&
      Math.abs(there.s - s) < o.width / 2 + ww / 2 + 0.4 &&
      o.position[1] < y + hh &&
      o.position[1] + o.height > y
    );
  });
}

function addRoundWallWindows(
  at: BuildingPlan,
  w: Wall,
  m: Mass,
  add: (s: number, y: number, scale: number) => void,
): void {
  // A turret's narrow windows go on every other face. The top storey's sit 0.2 m higher, above the roofs.
  const round = Math.round(Math.atan2(w.n[0], w.n[2]) / (Math.PI / 4));
  for (let k = 0; k < m.storeys; k++) {
    const y = at.floor + 0.86 + k * STOREY;
    if ((round + k) % 2 === 0) {
      add(w.length / 2, y + (k === m.storeys - 1 ? 0.2 : 0), 0.62);
    }
  }
}

function addWallWindows(
  at: BuildingPlan,
  placed: Opening[],
  w: Wall,
  spacing: number,
  winW: number,
  winH: number,
): void {
  const m = massOf(at, w);
  const add = (s: number, y: number, scale: number): void => {
    if (windowFits(at, placed, w, s, y, winW * scale, winH * scale)) {
      placed.push({
        kind: "window",
        mass: w.mass,
        position: on(w, s, y),
        normal: w.n,
        width: winW * scale,
        height: winH * scale,
      });
    }
  };
  if (m.round) {
    addRoundWallWindows(at, w, m, add);
    return;
  }
  for (let k = 0; k < m.storeys; k++) {
    const y = at.floor + 0.86 + k * STOREY;
    const scale = k === 0 ? 1 : 0.85;
    const n = Math.max(1, Math.floor((w.length - 0.6) / spacing));
    for (let j = 1; j <= n; j++) add((w.length * j) / (n + 1), y, scale);
  }
  // A small attic window high in a tall gable.
  const peak = peakOf(at, w);
  if (
    peak.s > 0.3 * w.length &&
    peak.s < 0.7 * w.length &&
    peak.y - wallTop(at, m) > 1.75
  ) {
    add(peak.s, wallTop(at, m) + 0.3, 0.7);
  }
}

function isBlankWall(
  w: Wall,
  porched: boolean,
  entry: number,
  blank: -1 | 0 | 1,
  mainAxis: readonly [number, number],
): boolean {
  if (porched && w.mass === entry) return true;
  return (
    w.mass === 0 &&
    blank !== 0 &&
    (w.n[0] * mainAxis[0] + w.n[2] * mainAxis[1]) * blank > 0.99
  );
}

function placeWindows(
  plan: BuildingPlan,
  p: Resolved<typeof cottagePlanParams>,
  r: Rand,
  alongX: boolean,
  entry: number,
  porched: boolean,
): BuildingPlan {
  const winW = 0.78 + 0.14 * r.next();
  const winH = 0.98 + 0.12 * r.next();
  // The chimney's gable gets no windows, so the stack has the whole wall.
  const blank = chimneyEnd(plan);
  const mainAxis: readonly [number, number] = alongX ? [1, 0] : [0, 1];
  const doorOnly = [...plan.openings];
  /** Windows every `spacing` meters along each wall that shows, in every storey, clear of the door and of each other. */
  const windowsAt = (spacing: number): Opening[] => {
    const placed = [...doorOnly];
    const at = { ...plan, openings: placed };
    for (const w of shownWalls(at)) {
      if (isBlankWall(w, porched, entry, blank, mainAxis)) continue;
      addWallWindows(at, placed, w, spacing, winW, winH);
    }
    return placed;
  };
  // A big house widens its window spacing, up to three times, to stay within `MAX_WINDOWS`.
  let spacing = 3.4 - 0.85 * (p.windows - 1);
  let all = windowsAt(spacing);
  for (let k = 0; k < 3 && all.length - 1 > MAX_WINDOWS; k++) {
    spacing *= (all.length - 1) / MAX_WINDOWS;
    all = windowsAt(spacing);
  }
  // Of the windows over `MAX_WINDOWS`, those facing the walk are kept first, low ones before high.
  const [door, ...windows] = all;
  const kept = windows
    .map((o, k) => ({ o, k }))
    .toSorted(
      (a, b) =>
        b.o.normal[2] - a.o.normal[2] ||
        a.o.position[1] - b.o.position[1] ||
        a.k - b.k,
    )
    .slice(0, MAX_WINDOWS)
    .toSorted((a, b) => a.k - b.k)
    .map(({ o }) => o);
  return { ...plan, openings: door === undefined ? kept : [door, ...kept] };
}

function buildMainMass(
  p: Resolved<typeof cottagePlanParams>,
  g: Massing,
  size: number,
  storeys: number,
  r: Rand,
): Mass {
  // A door goes in the main body's front. Where that front is an eave side whose eave, under the deepest roof, could
  // come down in front of the door, as on a gabled or half-hipped house of one storey, the house turns a gable end to
  // the front, so the door stands under the gable. A hipped house has no gable end, and its roof lifts its eave over
  // the door instead (`roofs.ts`).
  const eaveOverDoor =
    wallFor(storeys) - g.pitch * DEEPEST_EAVE - EAVE_DIP <
    Math.min(DOOR_HEIGHT, wallFor(storeys) - DOOR_LINTEL) + DOOR_HEADROOM;
  const turned =
    p.shape !== "gable-fronted" && g.form !== "hip" && eaveOverDoor;
  const [w0, d0] = shapeFootprint(p.shape);
  const ridge = p.shape === "gable-fronted" || turned ? "z" : "x";
  const [mainW, mainD] = turned ? [d0, w0] : [w0, d0];
  return massAt(g, {
    x: 0,
    z: 0,
    width: mainW * size * (0.96 + 0.08 * r.next()),
    depth: mainD * size * (0.96 + 0.08 * r.next()),
    round: false,
    wallHeight: wallFor(storeys),
    storeys,
    ridge,
    roof: g.form,
  });
}

export function layOutCottage(
  p: Resolved<typeof cottagePlanParams>,
  ctx: BuildContext,
): BuildingPlan {
  const r = ctx.rand.fork("plan");
  const size = clamp(ctx.facts.size ?? 1, 0.6, 1.4) * p.size;
  const storeys = clamp(
    Math.round(p.storeys - 0.01 + ((ctx.facts.floors ?? 1) - 1) * 0.6),
    1,
    3,
  );
  const lower = (n: number): number =>
    p.heights === "stepped" ? Math.max(1, n - 1) : n;
  const g: Massing = {
    pitch: Math.tan((p.roofline * Math.PI) / 180),
    form: roofFormOf(p.roof),
  };
  const main = buildMainMass(p, g, size, storeys, r);
  const side: 1 | -1 = r.next() < 0.5 ? -1 : 1;
  const masses: Mass[] = [main];
  const alongX = main.ridge === "x";
  const initialEntry = addMassing(
    masses,
    g,
    main,
    p,
    side,
    storeys,
    alongX,
    lower,
  );
  const extras = new Set(p.attachments);
  if (extras.has("lean-to")) {
    addLeanTo(masses, g, main, side, alongX);
  }
  if (extras.has("turret")) {
    addTurret(masses, g, main, side, storeys);
  }
  const centered = recenterPlan(masses, p);
  const { plan, entry, porched } = addDoorAndPorch(
    centered,
    g,
    p,
    extras,
    side,
    alongX,
    initialEntry,
  );
  return placeWindows(plan, p, r, alongX, entry, porched);
}
