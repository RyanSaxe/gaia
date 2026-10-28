// Plain data for the stones, bushes and drifts of flowers placed on the land
// for code, and for the footprints new placements avoid.

/** A footprint that new placements avoid, such as a tree's. */
export interface Occupied {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** A stone, bush or drift of flowers that represents code. `rule` and `variant` select its blueprint. */
export interface Placement {
  readonly rule: string;
  readonly variant: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** The footprint's radius at this scale, in meters. */
  readonly radius: number;
  /** The vitality of the code it represents. Absent means 1. */
  readonly vitality?: number;
  /** The ground's slope under it as dy/dx and dy/dz. The instance's base follows the slope and its stems stay upright. */
  readonly slope?: readonly [number, number];
}
