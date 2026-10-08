// The card that tells a person what something in the world stands for: its
// name, what kind of thing it is, where it lives in the code, how it is
// doing and why. It opens in the panel on a wide screen and in the sheet on
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

/** Vitality in words, from thriving to a ruin. */
export function standing(v: number): string {
  return v >= 0.85 ? "Thriving" : v >= 0.65 ? "Healthy" : v >= 0.4 ? "Tired" : v >= 0.15 ? "Failing" : "In ruins";
}

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
      const v = r.report.vitality;
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
      const word = el("b", undefined, standing(v));
      health.append(word, el("span", "card-score", v.toFixed(2)), meter);
      const why = el("ul", "card-signals");
      const terms = r.report.terms.filter((t) => t.penalty > 0).sort((a, b) => b.weight * b.penalty - a.weight * a.penalty);
      for (const t of terms) {
        const li = el("li");
        const cost = el("span", "card-cost");
        cost.style.width = `${Math.round(Math.min(1, t.weight * t.penalty) * 100)}%`;
        li.append(el("span", "card-signal", t.label), el("span", "card-reading", t.reading ?? ""), cost);
        why.append(li);
      }
      if (terms.length === 0) why.append(el("li", "card-well", "Nothing is wrong with it."));
      root.replaceChildren(head, el("p", "card-doc", r.doc), facts, health, why);
      root.hidden = false;
      root.scrollTop = 0;
    },
    hide() {
      shown = null;
      root.hidden = true;
    },
  };
}
