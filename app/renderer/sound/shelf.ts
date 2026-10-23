// Recordings decoded only while they may be heard. A decoded minute of stereo
// is 23 MB at 48 kHz, so the page decodes a recording when the soundscape
// first asks for it and frees it once it has been silent a while; a recorded
// walk, rendered offline in one pass, decodes everything first and keeps it.

export interface Shelf<K extends string> {
  /** The recording, decoded, or null while it decodes; asking starts decoding it. */
  take(name: K): AudioBuffer | null;
  /** Lets the recording go, so its samples can be freed until it is asked for again. */
  put(name: K): void;
  /** Resolves once every recording named is decoded. */
  ready(names: readonly K[]): Promise<void>;
}

/**
 * A shelf of the recordings at `urls`, decoded by `decode`. With `keep`
 * nothing is ever let go, as an offline rendering needs.
 */
export function createShelf<K extends string>(urls: Readonly<Record<K, string>>, decode: (url: string) => Promise<AudioBuffer>, keep: boolean): Shelf<K> {
  const decoded = new Map<K, AudioBuffer>();
  const decoding = new Map<K, Promise<void>>();
  const load = (name: K): Promise<void> => {
    const pending = decoding.get(name);
    if (pending !== undefined) return pending;
    const loading = decode(urls[name]).then(
      (buffer) => {
        // Let go while it decoded: it is not kept.
        if (decoding.get(name) === loading) decoded.set(name, buffer);
        decoding.delete(name);
      },
      (error: unknown) => {
        decoding.delete(name);
        console.error(`sound: could not decode ${name}: ${String(error)}`);
      },
    );
    decoding.set(name, loading);
    return loading;
  };
  return {
    take(name) {
      const buffer = decoded.get(name);
      if (buffer !== undefined) return buffer;
      void load(name);
      return null;
    },
    put(name) {
      if (keep) return;
      decoded.delete(name);
      decoding.delete(name);
    },
    async ready(names) {
      await Promise.all(names.map((n) => (decoded.has(n) ? Promise.resolve() : load(n))));
    },
  };
}
