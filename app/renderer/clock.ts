// Supplies the hour every world shows. It follows the local clock unless
// `?hour=` or a script pins it. Only the renderer reads the clock, because the
// packages are pure and receive the hour as a number.

/** The local hour of `d`, 0 to 24, with minutes and seconds as a fraction. */
export const localHour = (d: Date): number => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

export interface Clock {
  /** The hour to show now. */
  hour(): number;
  /** Pins the hour, or `null` to follow the person's clock again. */
  pin(hour: number | null): void;
}

/** A clock that re-reads the local time every minute. */
export function createClock(): Clock {
  let clockHour = localHour(new Date());
  let pinned: number | null = null;
  setInterval(() => {
    clockHour = localHour(new Date());
  }, 60_000);
  return {
    hour: () => pinned ?? clockHour,
    pin(h) {
      pinned = h === null ? null : ((h % 24) + 24) % 24;
      if (pinned === null) clockHour = localHour(new Date());
    },
  };
}
