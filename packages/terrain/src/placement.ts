// What stands on the land for code, as plain data: where each stone, bush or
// drift of flowers stands, and what anything new keeps clear of.

/** Something already standing that new placements keep clear of, such as a tree. */
export interface Occupied {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** A stone, a bush or a drift of flowers standing for code: its blueprint by rule and variant, and where and how it stands. */
export interface Placement {
  readonly rule: string;
  readonly variant: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** The footprint's radius at this scale, meters. */
  readonly radius: number;
  /** The vitality the copy shows: that of what it stands for. Absent, full health. */
  readonly vitality?: number;
}
