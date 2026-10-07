// The hour every world shows. It follows the person's own clock; the lab can
// pin it to scrub through a day. Only the renderer reads the clock: the
// packages are pure and receive the hour as a number.

/** The local hour of `d`, 0 to 24, with minutes and seconds as a fraction. */
export const localHour = (d: Date): number => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

export const QUICK_HOURS: readonly number[] = [6, 12.5, 18, 20, 22, 2];

export const formatHour = (hour: number): string => {
  const minutes = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

export interface Clock {
  /** The hour to show now. */
  hour(): number;
  /** Pins the hour, or `null` to follow the person's clock again. */
  pin(hour: number | null): void;
  readonly following: boolean;
}

/** A clock that re-reads the local time every minute, with a time control in `root`. */
export function createClock(root: HTMLElement): Clock {
  let clockHour = localHour(new Date());
  let pinned: number | null = null;
  setInterval(() => {
    clockHour = localHour(new Date());
    if (pinned === null) render();
  }, 60_000);

  root.innerHTML = /* html */ `
    <label class="follow" title="Show each world at your own local time"><input type="checkbox" data-clock="follow" checked> Follow my clock</label>
    <input class="scrub" type="range" data-clock="scrub" min="0" max="24" step="0.25" aria-label="Hour of the day">
    <output data-clock="out"></output>
    <div class="quick" role="group" aria-label="Jump to an hour">
      ${QUICK_HOURS.map((h) => `<button class="seg" type="button" data-hour="${h}">${formatHour(h)}</button>`).join("")}
    </div>`;
  const need = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (node === null) throw new Error(`The time control has no ${selector}.`);
    return node;
  };
  const follow = need<HTMLInputElement>('[data-clock="follow"]');
  const scrub = need<HTMLInputElement>('[data-clock="scrub"]');
  const out = need<HTMLOutputElement>('[data-clock="out"]');
  const quick = [...root.querySelectorAll<HTMLButtonElement>("[data-hour]")];

  const hour = (): number => pinned ?? clockHour;
  function render(): void {
    const h = hour();
    follow.checked = pinned === null;
    scrub.value = String(h);
    out.textContent = formatHour(h);
    for (const b of quick) b.classList.toggle("on", pinned !== null && Math.abs(Number(b.dataset.hour) - h) < 1e-6);
  }
  function pin(h: number | null): void {
    pinned = h === null ? null : ((h % 24) + 24) % 24;
    if (pinned === null) clockHour = localHour(new Date());
    render();
  }

  follow.addEventListener("change", () => pin(follow.checked ? null : clockHour));
  scrub.addEventListener("input", () => pin(Number(scrub.value)));
  for (const b of quick) b.addEventListener("click", () => pin(Number(b.dataset.hour)));
  render();

  return {
    hour,
    pin,
    get following() {
      return pinned === null;
    },
  };
}
