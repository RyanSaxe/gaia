// Where the journal keeps its paintings between visits: the page's own
// store in the browser (IndexedDB), each painting under a key that names its
// world, its thing and how the thing stood when it was painted, so a world
// opened again is never painted again, and a thing whose vitality changed is.
// Where the store can't be opened, nothing is kept and everything still works.

export interface PaintingStore {
  get(key: string): Promise<Blob | null>;
  put(key: string, painting: Blob): Promise<void>;
}

const DB = "gaia-journal";
const SHELF = "paintings";

export function browserPaintings(): PaintingStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> =>
    (opened ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(SHELF);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const run = <T>(mode: IDBTransactionMode, act: (shelf: IDBObjectStore) => IDBRequest<T>): Promise<T | null> =>
    db().then(
      (d) =>
        new Promise((resolve) => {
          if (d === null) return resolve(null);
          try {
            const request = act(d.transaction(SHELF, mode).objectStore(SHELF));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        }),
    );
  return {
    get: async (key) => {
      const found = await run<unknown>("readonly", (s) => s.get(key));
      return found instanceof Blob ? found : null;
    },
    put: async (key, painting) => {
      await run("readwrite", (s) => s.put(painting, key));
    },
  };
}
