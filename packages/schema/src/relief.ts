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
      /** Sideways swing of the axis, as a fraction of the half width. */
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

/** A stream bed from source to mouth. The world solves its waterline so the water always sits in the ground. */
export interface StreamBed {
  readonly kind: "stream";
  /** Local x, z pairs along the bed. */
  readonly path: Float32Array;
  /** Full width of the water, meters. */
  readonly width: number;
  /** Depth of the channel below the waterline, meters. */
  readonly depth: number;
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
}
