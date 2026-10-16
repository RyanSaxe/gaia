// Far forms kept between visits. Baking a tree build into its far form takes
// seconds of frames under the wait, and the same builds stand in every
// world, so each form is stored in this browser's IndexedDB, keyed by
// everything that makes it, and baked again only when the build or the bake
// changes. The database's version is the bake's: a form of an earlier bake is
// never read again and holds megabytes, so the first open at a newer bake
// empties the store. A second, small store records when each form was last
// used, so each open also deletes the forms of builds no recent visit drew,
// such as a season no world wears any more, reading no form.

/**
 * How long before the last visit a form must have been used to be kept: a
 * world opened once a week, or once in three, keeps its forms. It counts back
 * from the last visit, not from today, so a person back after months away
 * finds every form they last saw.
 */
const KEPT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** Two 32-bit FNV-1a lanes, so the key is 64 bits: accidental matches never happen in practice. */
const LANES = [0x811c9dc5, 0x01000193 ^ 0x5bd1e995] as const;

/**
 * A stable hash of `values`, as 16 hex digits: every typed array's bytes,
 * every array's and object's fields (objects in key order), every string,
 * number and boolean. Equal content hashes equal; any change hashes apart.
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
 * This browser's far forms of bake `version`, or null where the store can't
 * be opened at that version at once: where IndexedDB is unavailable, as in
 * some private windows, where a page of a later bake has opened it, or while
 * a page of an earlier one holds it open. The forms then bake as on a first
 * visit, and none is kept.
 */
export async function openFarStore(version: number): Promise<FarStore | null> {
  let db = await openDatabase(version);
  if (db !== null && !db.objectStoreNames.contains("used")) {
    // A store made before forms recorded their use starts over, as at a new bake.
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
        // Each form's key, with the time of the last visit that read or stored it.
        db.createObjectStore("used");
      };
      open.onsuccess = () => {
        // A page of a later bake waits on every page holding the store open.
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

/** Deletes the whole store, or resolves false where another page holds it open. */
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
 * Deletes every form no visit used in the `KEPT_FOR_MS` before the last
 * visit, reading only the forms' keys and when each was last used, and
 * resolves with this visit's time.
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
      // A clock set back never makes this visit look older than the last.
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
