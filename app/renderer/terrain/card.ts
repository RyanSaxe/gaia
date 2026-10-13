// The card that tells a person what something in the world stands for: its
// name, what kind of thing it is, where it lives in the code, and how it is
// doing, as a percentage. It opens in the panel on a wide screen and in the sheet on
// a phone, once the person has walked up to the thing, and reads like a
// page from a field guide rather than a readout.

import type { Represented } from "./samples.ts";

export interface Card {
  /** Shows a thing; `standsAs` names its form in the world, such as "a watermill", and `judge` who chose it, in a codebase's world. */
  show(r: Represented, standsAs: string, judge?: "jev" | "stand-in"): void;
  hide(): void;
  /** The thing shown, if any. */
  readonly shown: Represented | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls !== undefined) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createCard(root: HTMLElement, onClose: () => void): Card {
  let shown: Represented | null = null;
  root.classList.add("card");
  root.hidden = true;
  return {
    get shown() {
      return shown;
    },
    show(r, standsAs, judge) {
      shown = r;
      const v = r.vitality;
      const close = el("button", "card-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Close");
      close.addEventListener("click", onClose);
      const head = el("div", "card-head");
      head.append(el("div", "card-what", r.what), el("h2", "card-name", r.name), close);
      const facts = el("dl", "card-facts");
      const fact = (term: string, value: string | HTMLElement): void => {
        const dd = el("dd");
        dd.append(value);
        facts.append(el("dt", undefined, term), dd);
      };
      fact("Lives in", el("code", undefined, r.where));
      fact("Size", r.size);
      if (r.dependsOn.length > 0) fact("Leans on", r.dependsOn.join(", "));
      if (r.dependents.length > 0) fact("Leaned on by", r.dependents.join(", "));
      fact("Stands as", standsAs);
      if (judge !== undefined) fact("Judged by", judge === "jev" ? "Jev" : "the stand-in");
      const meter = el("div", "card-meter");
      const fill = el("span");
      fill.style.width = `${Math.round(v * 100)}%`;
      meter.append(fill);
      const health = el("div", "card-health");
      health.append(el("span", "card-score", `${Math.round(v * 100)}%`), meter);
      root.replaceChildren(head, el("p", "card-doc", r.doc), facts, health);
      root.hidden = false;
      root.scrollTop = 0;
    },
    hide() {
      shown = null;
      root.hidden = true;
    },
  };
}
