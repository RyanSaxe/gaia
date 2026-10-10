// What both directions of the start share: the page each draws, the words for
// an address that leads nowhere, and how a recent world or a folder is chosen.

import type { StartChoice, StartOffer } from "../../world-service/protocol.ts";

/** One direction's page: it shows an offer and settles once a place is chosen. */
export interface StartPage {
  /** Shows the offer (again, with why an address led nowhere); resolves with the place chosen. */
  offer(offer: StartOffer): Promise<StartChoice>;
  /** The hour the world shows: the table is lit by it, while the signpost follows the veil's night. */
  hour(h: number): void;
  /** The place is on its way: the page dissolves into the wait beneath it. */
  leave(): void;
}

/** The words for an address that leads nowhere, in the world's own voice. */
export const REFUSALS: Readonly<Record<NonNullable<StartOffer["refused"]>["why"], string>> = {
  address: "The map can't follow that. An address looks like github.com/someone/something.",
  missing: "Nothing open lies at that address. It may be private, or spelled a little differently.",
  offline: "The way there can't be reached just now. Try again in a little while.",
  large: "That place is too vast to walk yet.",
  slow: "That place is too far to reach today. Try again in a little while.",
};

/** The place a recent world reopens: a place on GitHub through its address, so it is brought up to date. */
export const placeOf = (r: StartOffer["recent"][number]): StartChoice => (r.github === undefined ? { folder: r.root } : { address: `github.com/${r.github}` });

/** A folder on this computer, asked of the app; null when the person thinks better of it, or outside the app. */
export async function askFolder(): Promise<string | null> {
  return (await window.gaiaShell?.chooseFolder()) ?? null;
}
