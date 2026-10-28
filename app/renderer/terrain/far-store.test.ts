import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FarStore, contentHash, openFarStore } from "./far-store.ts";

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
    // Object key order doesn't change the hash. Every value does.
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

const DAY = 24 * 60 * 60 * 1000;

describe("the far-form store", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Opens the store on `day` and reads `keys`, as a visit does. */
  const visit = async (day: number, keys: readonly string[] = []): Promise<FarStore | null> => {
    vi.setSystemTime(day * DAY);
    const store = await openFarStore(2);
    for (const key of keys) await store?.get(key);
    return store;
  };

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
    // Another page opens the database at an earlier bake and never closes it.
    vi.stubGlobal("indexedDB", new IDBFactory());
    await new Promise((resolve) => {
      indexedDB.open("gaia-far-forms", 1).onsuccess = resolve;
    });
    expect(await openFarStore(2)).toBeNull();
  });

  it("keeps the forms a world opened once a week draws, and deletes those no visit drew for 30 days before the last", async () => {
    const store = await visit(0);
    await store?.put("summer", { version: 2 });
    await store?.put("autumn", { version: 2 });
    // The autumn world opens every week, and the summer world never opens again.
    for (let day = 7; day <= 70; day += 7) await visit(day, ["autumn"]);
    const later = await visit(71);
    expect(await later?.get("autumn")).toEqual({ version: 2 });
    expect(await later?.get("summer")).toBeUndefined();
  });

  it("keeps every form for a person back after months away", async () => {
    await (await visit(0))?.put("tree", { version: 2 });
    await visit(1, ["tree"]);
    expect(await (await visit(200))?.get("tree")).toEqual({ version: 2 });
  });

  it("starts over from a store made before forms recorded their use", async () => {
    await new Promise((resolve) => {
      const open = indexedDB.open("gaia-far-forms", 2);
      open.onupgradeneeded = () => open.result.createObjectStore("forms").put({ version: 2 }, "tree");
      open.onsuccess = () => {
        open.result.close();
        resolve(undefined);
      };
    });
    const store = await visit(0);
    expect(await store?.get("tree")).toBeUndefined();
    await store?.put("tree", { version: 2 });
    expect(await (await visit(1))?.get("tree")).toEqual({ version: 2 });
  });
});
