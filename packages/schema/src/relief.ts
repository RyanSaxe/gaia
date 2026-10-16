// What a Relief primitive produces: a region's ground shape as plain data.
// A height field is a small expression tree that one evaluator samples, so a
// landform crosses worker boundaries and hashes like any other output.
// Coordinates are meters in the region's own frame: origin at its center,
// +x east, +z south. Heights are meters above the region's base.

export type HeightField =
  | { readonly op: "constant"; readonly value: number }
  /** Fractal noise. "smooth" spans about -1..1; "ridged" spans 0..1 with sharp crests. */
  | {
      readonly op: "noise";
      readonly seed: number;
      readonly wavelength: number;
      readonly octaves: number;
      /** Amplitude kept per octave, 0 to 1: higher is rougher. */
      readonly gain: number;
      /** Direction of the long axis, radians from +x toward +z. */
      readonly angle: number;
      /** How much longer than wide each feature is, 1 for round. */
      readonly stretch: number;
      readonly style: "smooth" | "ridged";
    }
  /** Wind ridges, 0..1: a gentle windward face and a steeper lee, crests running across `angle`. */
  | { readonly op: "dunes"; readonly seed: number; readonly wavelength: number; readonly angle: number; readonly wander: number }
  /** A valley's cross-section, 0 on the floor line to 1 on the shoulders, along a meandering axis at `angle`. */
  | {
      readonly op: "trough";
      readonly seed: number;
      readonly angle: number;
      readonly halfWidth: number;
      /** The flat floor's share of the half width, each side of the axis, where the stream winds. */
      readonly floor: number;
      /** Sideways swing of the axis, meters, from one bend to the next `meanderWavelength` meters along it. */
      readonly meander: number;
      readonly meanderWavelength: number;
    }
  /** A tilt of `grade` meters per meter toward `angle`, eased flat beyond `reach` meters from the center. */
  | { readonly op: "plane"; readonly angle: number; readonly grade: number; readonly reach: number }
  /** 1 at the center, falling smoothly to 0 at `radius`. */
  | { readonly op: "dome"; readonly radius: number }
  /** A soft circular bump of height 1 centered on `radius`. */
  | { readonly op: "ring"; readonly radius: number; readonly width: number }
  /** Quantizes a field into flat treads of `step` meters; `riser` is the share of each step spent climbing. */
  | { readonly op: "terrace"; readonly step: number; readonly riser: number; readonly of: HeightField }
  | { readonly op: "sum"; readonly of: readonly HeightField[] }
  | { readonly op: "product"; readonly of: readonly HeightField[] }
  | { readonly op: "scale"; readonly by: number; readonly of: HeightField };

/**
 * A river's valley along its course, as a surface the land is cut down to: its floor, rising up each wall to that
 * side's shoulder, then on at a gentle grade until it meets the land.
 */
export interface ValleyCourse {
  /** World x, z pairs from source to mouth, a few meters apart. */
  readonly points: Float32Array;
  /** At each point: the valley's half width, the height of its floor, and how far its shoulders rise above the floor, meters. */
  readonly halfWidths: Float32Array;
  readonly floors: Float32Array;
  readonly depths: Float32Array;
  /**
   * At each point, six numbers: on its left, where the flat floor ends and where the wall rising from it reaches its
   * shoulder, meters out from the course, and how much of a terrace the wall keeps, 0 to 1; then the same on its right.
   */
  readonly walls: Float32Array;
}

/** Every river valley of a world, in world meters, with its segments by square cells `cell` meters a side from (`x0`, `z0`), so a point finds the few near it. */
export interface ValleyNet {
  readonly courses: readonly ValleyCourse[];
  readonly cell: number;
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Per cell, row by row: each segment that may carve it, as its course's index times 65536 plus the segment's. */
  readonly cells: readonly (readonly number[])[];
}

/** A stream bed from source to mouth. The world solves its waterline so the water always sits in the ground. */
export interface StreamBed {
  readonly kind: "stream";
  /** Local x, z pairs along the bed. */
  readonly path: Float32Array;
  /** Full width of the water, meters. */
  readonly width: number;
  /** Depth of the channel below the waterline, meters. */
  readonly depth: number;
  /** A river's whole course across the land, kept whole past its region, and its width at each point, source first. */
  readonly widths?: Float32Array;
  /** Whether it dries away at its end, rather than ending in another stream, a pond or at the land's edge. */
  readonly seep?: boolean;
  /** Its valley's floor under each point, which only descends. */
  readonly floors?: Float32Array;
}

/** A hollow that holds still water; the world fills it to just below its lowest rim point. */
export interface PondBed {
  readonly kind: "pond";
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly depth: number;
}

export type WaterBed = StreamBed | PondBed;

export interface Landform {
  readonly height: HeightField;
  readonly water: readonly WaterBed[];
  /** The world's river valleys, the same for every region of a world once its rivers are routed: the land is cut down to them. */
  readonly valleys?: ValleyNet;
}
