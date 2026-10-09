// Far forms kept between visits. Baking a tree build into its far form takes
// seconds of frames under the wait, and the same builds stand in every
// world, so each form is stored in this browser's IndexedDB, keyed by
// everything that makes it, and baked again only when the build or the bake
// changes.

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

/** This browser's stored far forms, or null where IndexedDB is unavailable, as in some private windows. */
export async function openFarStore(): Promise<FarStore | null> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    try {
      const open = indexedDB.open("gaia-far-forms", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("forms");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (db === null) return null;
  const request = <T>(mode: IDBTransactionMode, run: (forms: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const r = run(db.transaction("forms", mode).objectStore("forms"));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("The far-form store failed."));
    });
  return {
    get: (key) => request("readonly", (forms) => forms.get(key)),
    put: async (key, data) => {
      await request("readwrite", (forms) => forms.put(data, key));
    },
  };
}
