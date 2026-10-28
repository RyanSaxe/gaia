// The start page's interface, the text for each refused address, and the
// helpers that turn a recent world or a folder into a `StartChoice`.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";

/** The start page. It shows an offer and resolves once a place is chosen. */
export interface StartPage {
  /** Shows the offer, or shows it again with why an address failed, and resolves with the chosen place. */
  offer(offer: StartOffer): Promise<StartChoice>;
  /** Sets the world's hour, which lights the table. */
  hour(h: number): void;
  /**
   * Called once a place is chosen, or when a world opens without the start page. The page stops taking choices, and the
   * table stays behind the wait with its card risen into the wait's sheet.
   */
  leave(): void;
  /** Called when the wait has lifted and the world shows. The page releases all its resources. */
  close(): void;
}

/** The text shown for each reason an address failed, written in the world's voice. */
export const REFUSALS: Readonly<Record<NonNullable<StartOffer["refused"]>["why"], string>> = {
  address: "The map can't follow that. An address looks like github.com/someone/something.",
  missing: "Nothing open lies at that address. It may be private, or spelled a little differently.",
  offline: "The way there can't be reached just now. Try again in a little while.",
  large: "That place is too vast to walk yet.",
  slow: "That place is too far to reach today. Try again in a little while.",
};

/** The choice that reopens a recent world. A GitHub world reopens through its address, so its clone is updated first. */
export const placeOf = (r: StartOffer["recent"][number]): StartChoice => (r.github === undefined ? { folder: r.root } : { address: `github.com/${r.github}` });

/** Asks the app for a local folder. Returns null when the person cancels, or outside the app. */
export async function askFolder(): Promise<string | null> {
  return (await window.gaiaShell?.chooseFolder()) ?? null;
}
