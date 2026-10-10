// The traveller's map table: the field map's own paper on a wooden table,
// with the worlds walked before laid on it as pictures of their field maps, and
// a line at the paper's foot to write an address on, lettered like the map.
// Choosing a place lifts its sheet; then the table falls away and the paper
// becomes the wait's.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";
import { SHEET_LOGO } from "../brand/logo.ts";
import { FILTERS, deckle, hashOf } from "./paint.ts";
import { REFUSALS, type StartPage, askFolder, placeOf } from "./choice.ts";

const baseName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

/** Where a world lies, in small capitals under its name: who keeps it on GitHub, or the folder it sits in. */
const whereOf = (r: StartOffer["recent"][number]): string => (r.github !== undefined ? (r.github.split("/")[0] ?? "") : (r.root.includes("/") ? baseName(r.root.slice(0, r.root.lastIndexOf("/"))) : ""));
const nameOf = (r: StartOffer["recent"][number]): string => (r.github !== undefined ? (r.github.split("/")[1] ?? r.name) : r.name);

export function createTable(veil: HTMLElement): StartPage {
  const root = document.createElement("div");
  root.className = "start start-table";
  root.innerHTML = /* html */ `
    ${FILTERS}
    <div class="table-wood"></div>
    <div class="table-sheet">
      <div class="sheet-paper"></div>
      <img class="sheet-mark" src="${SHEET_LOGO}" alt="Gaia">
      <p class="sheet-say">the worlds you have walked</p>
      <ol class="sheet-cards"></ol>
      <form class="sheet-line" autocomplete="off">
        <label class="line-say" for="start-address">or write the address of a place on GitHub</label>
        <span class="line-row">
          <input id="start-address" name="address" type="text" placeholder="github.com/…" spellcheck="false" autocapitalize="off" autocomplete="off">
          <svg class="line-ink" viewBox="0 0 400 10" preserveAspectRatio="none" aria-hidden="true"><path d="M2 6 C 70 3.5, 140 7.5, 210 5.2 S 340 3.8, 398 5.6" pathLength="1"/></svg>
        </span>
        <p class="line-answer" aria-live="polite"></p>
        <button type="button" class="line-folder">or open a folder on this computer</button>
      </form>
    </div>
    <div class="table-lantern"></div>`;
  veil.append(root);
  const sheet = root.querySelector(".table-sheet") as HTMLElement;
  sheet.style.clipPath = deckle("table", 26, 0.7);
  const cards = root.querySelector(".sheet-cards") as HTMLOListElement;
  const say = root.querySelector(".sheet-say") as HTMLElement;
  const lineSay = root.querySelector(".line-say") as HTMLElement;
  const form = root.querySelector(".sheet-line") as HTMLFormElement;
  const row = root.querySelector(".line-row") as HTMLElement;
  const input = root.querySelector("input") as HTMLInputElement;
  const answer = root.querySelector(".line-answer") as HTMLElement;
  const folder = root.querySelector(".line-folder") as HTMLButtonElement;

  let settle: ((place: StartChoice) => void) | null = null;
  const choose = (place: StartChoice): void => {
    const s = settle;
    settle = null;
    s?.(place);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const address = input.value.trim();
    if (address === "" || settle === null) return;
    root.classList.remove("refused");
    row.classList.add("reading");
    choose({ address });
  });
  input.addEventListener("input", () => root.classList.remove("refused"));
  folder.addEventListener("click", () => {
    void askFolder().then((f) => {
      if (f !== null) choose({ folder: f });
    });
  });

  return {
    offer(offer) {
      cards.replaceChildren(
        ...offer.recent.map((r, i) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.className = "postcard";
          b.style.setProperty("--tilt", `${((hashOf(r.root) - 0.5) * 6).toFixed(2)}deg`);
          b.style.setProperty("--lift", `${((hashOf(r.root, 2) - 0.5) * 10).toFixed(1)}px`);
          b.style.setProperty("--i", String(i));
          const paper = document.createElement("span");
          paper.className = "postcard-sheet";
          paper.style.clipPath = deckle(r.root, 9, 2.2);
          if (r.picture !== undefined) {
            const picture = document.createElement("img");
            picture.src = r.picture;
            picture.alt = "";
            paper.append(picture);
          }
          const name = document.createElement("span");
          name.className = "postcard-name";
          name.textContent = nameOf(r);
          const where = document.createElement("span");
          where.className = "postcard-where";
          where.textContent = whereOf(r);
          b.append(paper, name, where);
          b.addEventListener("click", () => {
            if (settle === null) return;
            b.classList.add("chosen");
            root.classList.add("choosing");
            choose(placeOf(r));
          });
          li.append(b);
          return li;
        }),
      );
      root.classList.toggle("empty", offer.recent.length === 0);
      say.textContent = offer.recent.length === 0 ? "where shall we wander?" : "the worlds you have walked";
      lineSay.textContent = `${offer.recent.length === 0 ? "write" : "or write"} the address of a place on GitHub`;
      row.classList.remove("reading");
      root.classList.remove("choosing");
      for (const c of cards.querySelectorAll(".chosen")) c.classList.remove("chosen");
      if (offer.refused !== undefined) {
        input.value = offer.refused.address;
        answer.textContent = REFUSALS[offer.refused.why];
        root.classList.remove("refused");
        // Restarts the answer's coming in, even for the same words twice.
        void root.offsetWidth;
        root.classList.add("refused");
        input.focus({ preventScroll: true });
      } else if (offer.recent.length === 0) input.focus({ preventScroll: true });
      requestAnimationFrame(() => root.classList.add("shown"));
      return new Promise((resolve) => (settle = resolve));
    },
    leave() {
      settle = null;
      root.classList.add("leaving");
      window.setTimeout(() => root.remove(), 1400);
    },
  };
}
