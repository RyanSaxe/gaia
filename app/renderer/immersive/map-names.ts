// What the map letters above an area's name so that names that repeat can be
// told apart, worked out from the folder names alone so it fits any codebase.

/**
 * For each path, the folders above its own name that the map letters with it:
 * none for a name no other path shares, and otherwise just enough of the path
 * above it that no other path ends the same way ("world" above a `src` when
 * another `src` sits elsewhere). Folders are joined with " / ".
 */
export function nameTails(paths: readonly string[]): Map<string, string> {
  const parts = paths.map((p) => p.split("/"));
  const ends = (segs: readonly string[], k: number): string => segs.slice(-k).join("/");
  const tails = new Map<string, string>();
  for (const segs of parts) {
    let k = 1;
    while (k < segs.length && parts.some((o) => o !== segs && ends(o, k) === ends(segs, k))) k++;
    tails.set(segs.join("/"), segs.slice(-k, -1).join(" / "));
  }
  return tails;
}
