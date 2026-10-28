// Stores far forms between visits in this browser's IndexedDB. Baking a
// tree's far form takes seconds of the loading screen, so each form is keyed
// by a hash of everything that makes it and bakes again only when its build or
// the bake changes. The database version is the bake version, and opening at a
// newer bake empties the store. A second store, `used`, records when each form
// was last used, so each open deletes the forms no recent visit used.

/**
 * A form is kept if it was used within this time before the last visit, so a
 * world opened once every three weeks keeps its forms. The window ends at the
 * last visit rather than today, so a person who returns after months away
 * still has every form they last saw.
 */
const KEPT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** Seeds for two 32-bit FNV-1a lanes. Together they make a 64-bit key, so accidental collisions don't occur in practice. */
const LANES = [0x811c9dc5, 0x01000193 ^ 0x5bd1e995] as const;

/**
 * Returns a stable hash of `values` as 16 hex digits. It covers every typed
 * array's bytes, every array element, every object field in key order, and
 * every string, number and boolean. Equal content gives equal hashes.
 */
export function contentHash(...values: unknown[]): string {
  const h = [LANES[0], LANES[1]];
  const mix = (word: number): void => {
    h[0] = Math.imul((h[0] as number) ^ word, 0x01000193) >>> 0;
    h[1] = Math.imul((h[1] as number) ^ (word + 0x9e3779b9), 0x01000193) >>> 0;
  };
  const text = (s: string): void => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  const visit = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) {
      text(v.constructor.name);
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      mix(bytes.length);
      const words = Math.floor(bytes.length / 4);
      const view = new DataView(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i < words; i++) mix(view.getUint32(i * 4, true));
      for (let i = words * 4; i < bytes.length; i++) mix(bytes[i] as number);
    } else if (Array.isArray(v)) {
      mix(0xa11a);
      mix(v.length);
      for (const item of v) visit(item);
    } else if (v instanceof Map) {
      visit([...v.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
    } else if (v !== null && typeof v === "object") {
      mix(0x0b1e);
      for (const key of Object.keys(v).sort()) {
        text(key);
        visit((v as Record<string, unknown>)[key]);
      }
    } else {
      text(`${typeof v}:${String(v)}`);
    }
  };
  for (const v of values) visit(v);
  return h.map((x) => (x as number).toString(16).padStart(8, "0")).join("");
}

export interface FarStore {
  get(key: string): Promise<unknown>;
  put(key: string, data: unknown): Promise<void>;
}

/**
 * Opens this browser's far forms for bake `version`. Returns null when the
 * store can't open at that version right away: IndexedDB is unavailable, as
 * in some private windows, a page with a later bake has opened it, or a page
 * with an earlier bake holds it open. Forms then bake as on a first visit,
 * and none is stored.
 */
export async function openFarStore(version: number): Promise<FarStore | null> {
  let db = await openDatabase(version);
  if (db !== null && !db.objectStoreNames.contains("used")) {
    // A database created before the `used` store existed starts over, as at a new bake.
    db.close();
    db = (await deleteDatabase()) ? await openDatabase(version) : null;
  }
  if (db === null) return null;
  const store = db;
  const visit = await prune(store).catch(() => Date.now());
  const request = <T>(name: "forms" | "used", mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const r = run(store.transaction(name, mode).objectStore(name));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("The far-form store failed."));
    });
  return {
    get: async (key) => {
      const form = await request("forms", "readonly", (forms) => forms.get(key));
      if (form !== undefined) void request("used", "readwrite", (used) => used.put(visit, key)).catch(() => undefined);
      return form;
    },
    put: (key, data) =>
      new Promise((resolve, reject) => {
        const t = store.transaction(["forms", "used"], "readwrite");
        t.objectStore("forms").put(data, key);
        t.objectStore("used").put(visit, key);
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error ?? new Error("The far-form store failed."));
      }),
  };
}

const NAME = "gaia-far-forms";

function openDatabase(version: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(NAME, version);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const name of ["forms", "used"]) if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        db.createObjectStore("forms");
        // Maps each form's key to the time of the last visit that read or stored it.
        db.createObjectStore("used");
      };
      open.onsuccess = () => {
        // A page with a later bake waits until every page holding the database closes it.
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Deletes the whole database. Resolves false when another page holds it open. */
function deleteDatabase(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(NAME);
      r.onsuccess = () => resolve(true);
      r.onerror = () => resolve(false);
      r.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Deletes every form unused in the `KEPT_FOR_MS` before the last visit. It
 * reads only keys and use times, never forms, and resolves with this visit's
 * time.
 */
function prune(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(["forms", "used"], "readwrite");
    const forms = t.objectStore("forms");
    const used = t.objectStore("used");
    const formKeys = forms.getAllKeys();
    const usedKeys = used.getAllKeys();
    const usedAt = used.getAll();
    let visit = Date.now();
    usedAt.onsuccess = () => {
      const lastUse = new Map(usedKeys.result.map((key, i) => [key, usedAt.result[i] as number]));
      const last = Math.max(0, ...lastUse.values());
      // If the clock was set back, this visit still counts as no older than the last.
      visit = Math.max(visit, last);
      for (const key of formKeys.result) {
        if ((lastUse.get(key) ?? 0) < last - KEPT_FOR_MS) {
          forms.delete(key);
          used.delete(key);
        }
      }
    };
    t.oncomplete = () => resolve(visit);
    t.onabort = () => reject(t.error ?? new Error("The far-form store failed."));
  });
}
