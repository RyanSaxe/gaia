import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentHash, openFarStore } from "./far-store.ts";

const part = (lift: number) => ({
  swatch: "leaf",
  positions: new Float32Array([0, lift, 0, 1, 2, 3]),
  indices: new Uint32Array([0, 1, 2]),
  channels: { decline: new Float32Array([0.5, 0.25]) },
});

describe("a far form's key", () => {
  it("is the same for the same build, and differs for any change to it", () => {
    const same = contentHash([part(1)], { sway: 1 }, "bake@1", 128);
    expect(contentHash([part(1)], { sway: 1 }, "bake@1", 128)).toBe(same);
    // Key order in an object doesn't matter; every value does.
    expect(contentHash([{ channels: part(1).channels, indices: part(1).indices, positions: part(1).positions, swatch: "leaf" }], { sway: 1 }, "bake@1", 128)).toBe(same);
    for (const changed of [
      contentHash([part(1.0001)], { sway: 1 }, "bake@1", 128),
      contentHash([part(1), part(1)], { sway: 1 }, "bake@1", 128),
      contentHash([{ ...part(1), swatch: "bark" }], { sway: 1 }, "bake@1", 128),
      contentHash([part(1)], { sway: 1.5 }, "bake@1", 128),
      contentHash([part(1)], { sway: 1 }, "bake@2", 128),
      contentHash([part(1)], { sway: 1 }, "bake@1", 112),
    ]) {
      expect(changed).not.toBe(same);
    }
  });
});

describe("the far-form store", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("keeps each form between visits of one bake", async () => {
    await (await openFarStore(2))?.put("tree", { version: 2 });
    expect(await (await openFarStore(2))?.get("tree")).toEqual({ version: 2 });
  });

  it("drops every form of an earlier bake when a later bake opens it, even while a page of the earlier one has it open", async () => {
    const earlier = await openFarStore(1);
    await earlier?.put("tree", { version: 1 });
    const later = await openFarStore(2);
    expect(later).not.toBeNull();
    expect(await later?.get("tree")).toBeUndefined();
    await later?.put("tree", { version: 2 });
    expect(await later?.get("tree")).toEqual({ version: 2 });
  });

  it("opens nothing, rather than fail or wait, where it can't be opened at the page's bake", async () => {
    await openFarStore(3);
    expect(await openFarStore(2)).toBeNull();
    // A page that never lets go of an earlier bake's store.
    vi.stubGlobal("indexedDB", new IDBFactory());
    await new Promise((resolve) => {
      indexedDB.open("gaia-far-forms", 1).onsuccess = resolve;
    });
    expect(await openFarStore(2)).toBeNull();
  });
});
