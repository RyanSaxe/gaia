// The walking playground: with `?walk=playground`, a small paper card in the
// corner switches the way of walking live and tunes its numbers, so ways of
// walking can be felt in the world itself before one is chosen (round 21's
// movement page). Only that page shows it; switching never reloads the world.

import { SCHEMES, type SteerScheme, type SteerSchemeId } from "@gaia/terrain";

/** Whether the page asks for the playground. */
export const WALK_PLAYGROUND = typeof location !== "undefined" && new URLSearchParams(location.search).get("walk") === "playground";

/** A tunable number: its label, unit, range and step, and whether a way of walking uses it. */
interface Knob {
  readonly key: keyof SteerScheme & ("rate" | "nudgeFor" | "nudge" | "keep" | "pace" | "back" | "side" | "blink" | "snap" | "sensitivity");
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** What 0 means, where it means something: keep-turning off, a turn made as a cut. */
  readonly zero?: string;
  readonly uses: (s: SteerScheme) => boolean;
}
const KNOBS: readonly Knob[] = [
  { key: "rate", label: "Turn", unit: "°/s", min: 10, max: 180, step: 5, uses: (s) => s.walk === "strafe" || s.walk === "face" || (s.turn !== "none" && s.big !== "snap") },
  { key: "nudge", label: "Nudge", unit: "°", min: 1, max: 30, step: 1, uses: (s) => s.walk === "face" },
  { key: "keep", label: "Held", unit: "°/s", min: 0, max: 90, step: 5, zero: "off", uses: (s) => s.walk === "face" },
  { key: "nudgeFor", label: "Nudge", unit: "s", min: 0.05, max: 0.5, step: 0.01, uses: (s) => s.walk !== "strafe" && s.turn === "nudge" },
  { key: "snap", label: "Step", unit: "°", min: 10, max: 90, step: 5, uses: (s) => s.big === "snap" },
  { key: "blink", label: "Blink", unit: "s", min: 0, max: 0.6, step: 0.02, zero: "a cut", uses: (s) => s.big === "blink" || s.walk === "face" },
  { key: "pace", label: "Walk", unit: "m/s", min: 1, max: 8, step: 0.1, uses: () => true },
  { key: "back", label: "Back", unit: "× walk", min: 0.1, max: 1, step: 0.05, uses: (s) => s.walk !== "none" && s.walk !== "face" && s.big !== "blink" },
  { key: "side", label: "Aside", unit: "× walk", min: 0.1, max: 1, step: 0.05, uses: (s) => s.walk === "strafe" },
  { key: "sensitivity", label: "Look", unit: "°/px", min: 0.03, max: 0.6, step: 0.01, uses: () => true },
];
/** Where the last way tried is kept; a new key when the ways change, so the playground opens on the one asked for. */
const KEPT = "gaia-walk-playground@22";

/** Lays the card on `parent`, starting from `first` or the way last tried on this browser; `chosen` gets each way and its numbers as they change. */
export function createWalkPlayground(parent: HTMLElement, first: SteerSchemeId, chosen: (scheme: SteerScheme) => void): void {
  const ids = Object.keys(SCHEMES) as SteerSchemeId[];
  let id = first;
  let scheme: SteerScheme = SCHEMES[first];
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT) ?? "null") as { id?: string; scheme?: SteerScheme } | null;
    if (kept?.id !== undefined && kept.id in SCHEMES && kept.scheme !== undefined) {
      id = kept.id as SteerSchemeId;
      scheme = { ...SCHEMES[id], ...kept.scheme };
    }
  } catch {
    // A private window keeps nothing: the playground starts from the app's own way.
  }
  const card = document.createElement("form");
  card.className = "walk-playground";
  card.addEventListener("submit", (e) => e.preventDefault());
  const pick = document.createElement("select");
  pick.setAttribute("aria-label", "Way of walking");
  for (const i of ids) pick.append(new Option(SCHEMES[i].label, i));
  const says = document.createElement("p");
  const knobs = document.createElement("div");
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Its own numbers";
  card.append(pick, says, knobs, reset);
  parent.append(card);

  // Keys go back to the world as soon as a control has been used.
  const settle = (el: HTMLElement): void => el.addEventListener("change", () => el.blur());
  settle(pick);
  function apply(): void {
    pick.value = id;
    says.textContent = scheme.name;
    knobs.replaceChildren(
      ...KNOBS.filter((k) => k.uses(scheme)).map((k) => {
        const row = document.createElement("label");
        const value = document.createElement("output");
        const input = document.createElement("input");
        input.type = "range";
        Object.assign(input, { min: String(k.min), max: String(k.max), step: String(k.step), value: String(scheme[k.key]) });
        const show = (): void => {
          const v = Number(input.value);
          value.textContent = v === 0 && k.zero !== undefined ? k.zero : `${v.toFixed(k.step < 0.1 ? 2 : k.step < 1 ? 1 : 0)} ${k.unit}`;
        };
        show();
        input.addEventListener("input", () => {
          scheme = { ...scheme, [k.key]: Number(input.value) };
          show();
          use();
        });
        settle(input);
        row.append(document.createTextNode(k.label), input, value);
        return row;
      }),
      ...(scheme.walk === "face" ? [toggle("↑ with ← → faces the diagonal", "diagonal")] : []),
    );
    use();
  }
  /** A yes-or-no setting of the way of walking, as a checkbox. */
  function toggle(text: string, key: "diagonal"): HTMLElement {
    const row = document.createElement("label");
    row.className = "walk-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = scheme[key];
    box.addEventListener("change", () => {
      scheme = { ...scheme, [key]: box.checked };
      use();
    });
    settle(box);
    row.append(box, document.createTextNode(text));
    return row;
  }
  function use(): void {
    if (scheme.look !== "pointer" && document.pointerLockElement !== null) document.exitPointerLock();
    chosen(scheme);
    try {
      localStorage.setItem(KEPT, JSON.stringify({ id, scheme }));
    } catch {
      // Nothing kept; the playground still works.
    }
  }
  pick.addEventListener("change", () => {
    id = pick.value as SteerSchemeId;
    scheme = SCHEMES[id];
    apply();
  });
  reset.addEventListener("click", () => {
    scheme = SCHEMES[id];
    apply();
    reset.blur();
  });
  apply();
}
