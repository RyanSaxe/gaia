// Traces lines over a grid for the field sheet's contours and shores. It runs
// marching squares, joins the segments into polylines, simplifies them, and
// thins contours on steep ground as survey maps do.

/** The radius in samples over which `slopes` averages each sample's grade, so thinning follows whole slopes, not single cells. */
const SLOPE_REACH = 2;
/** The shortest open piece of a thinned line kept, in cells. A shorter piece is a stub left by thinning. */
const STUB = 6;

/**
 * Runs marching squares over columns i0..i1 and rows j0..j1, emitting segments
 * in grid coordinates around the cells where `inside` is true.
 */
export function contour(i0: number, i1: number, j0: number, j1: number, inside: (i: number, j: number) => boolean, emit: (x0: number, y0: number, x1: number, y1: number) => void): void {
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = (inside(i, j) ? 1 : 0) | (inside(i + 1, j) ? 2 : 0) | (inside(i + 1, j + 1) ? 4 : 0) | (inside(i, j + 1) ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = [i + 0.5, j] as const;
      const right = [i + 1, j + 0.5] as const;
      const bottom = [i + 0.5, j + 1] as const;
      const left = [i, j + 0.5] as const;
      const seg = (p: readonly [number, number], q: readonly [number, number]): void => emit(p[0], p[1], q[0], q[1]);
      if (k === 1 || k === 14) seg(left, top);
      else if (k === 2 || k === 13) seg(top, right);
      else if (k === 3 || k === 12) seg(left, right);
      else if (k === 4 || k === 11) seg(right, bottom);
      else if (k === 6 || k === 9) seg(top, bottom);
      else if (k === 7 || k === 8) seg(left, bottom);
      else if (k === 5) {
        seg(left, top);
        seg(right, bottom);
      } else if (k === 10) {
        seg(top, right);
        seg(left, bottom);
      }
    }
  }
}

/**
 * Runs marching squares over a grid of heights `n` on a side, between columns
 * i0..i1 and rows j0..j1, emitting segments in grid coordinates where the
 * ground crosses `level`. Each end is interpolated along its cell edge, so a
 * contour runs smooth. It skips cells with a NaN corner.
 */
export function isoline(h: Float32Array, n: number, level: number, emit: (x0: number, y0: number, x1: number, y1: number) => void, i0 = 0, i1 = n - 1, j0 = 0, j1 = n - 1): void {
  const at = (i: number, j: number): number => h[j * n + i] as number;
  const cross = (a: number, b: number): number => (level - a) / (b - a || 1e-6);
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if (Number.isNaN(a + b + c + d)) continue;
      const k = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const top = (): [number, number] => [i + cross(a, b), j];
      const right = (): [number, number] => [i + 1, j + cross(b, c)];
      const bottom = (): [number, number] => [i + cross(d, c), j + 1];
      const left = (): [number, number] => [i, j + cross(a, d)];
      const seg = (p: [number, number], q: [number, number]): void => emit(p[0], p[1], q[0], q[1]);
      if (k === 1 || k === 14) seg(left(), top());
      else if (k === 2 || k === 13) seg(top(), right());
      else if (k === 3 || k === 12) seg(left(), right());
      else if (k === 4 || k === 11) seg(right(), bottom());
      else if (k === 6 || k === 9) seg(top(), bottom());
      else if (k === 7 || k === 8) seg(left(), bottom());
      else if (k === 5) {
        seg(left(), top());
        seg(right(), bottom());
      } else if (k === 10) {
        seg(top(), right());
        seg(left(), bottom());
      }
    }
  }
}

/** Joins line segments (x0, y0, x1, y1 each) that share ends into polylines, x and y pairs. */
export function chained(segments: readonly number[]): number[][] {
  // Two segments that share a cell edge end at exactly the same point. Rounding to a millimeter gives them one key.
  const key = (x: number, y: number): number => (Math.round(x * 1000) + 2 ** 24) * 2 ** 26 + (Math.round(y * 1000) + 2 ** 24);
  const at = new Map<number, number[]>();
  const count = segments.length / 4;
  for (let k = 0; k < count; k++) {
    for (const end of [0, 2]) {
      const id = key(segments[k * 4 + end] as number, segments[k * 4 + end + 1] as number);
      const list = at.get(id);
      if (list === undefined) at.set(id, [k]);
      else list.push(k);
    }
  }
  const used = new Uint8Array(count);
  const lines: number[][] = [];
  // From a segment, follows the unused segment sharing its far end until none is left.
  const walk = (k: number, fromEnd: number, line: number[]): void => {
    let seg = k;
    let end = fromEnd;
    for (;;) {
      const x = segments[seg * 4 + end] as number;
      const y = segments[seg * 4 + end + 1] as number;
      const next = (at.get(key(x, y)) ?? []).find((o) => used[o] === 0);
      if (next === undefined) return;
      used[next] = 1;
      const near = key(segments[next * 4] as number, segments[next * 4 + 1] as number) === key(x, y) ? 0 : 2;
      const far = 2 - near;
      line.push(segments[next * 4 + far] as number, segments[next * 4 + far + 1] as number);
      seg = next;
      end = far;
    }
  };
  for (let k = 0; k < count; k++) {
    if (used[k] === 1) continue;
    used[k] = 1;
    const forward = [segments[k * 4] as number, segments[k * 4 + 1] as number, segments[k * 4 + 2] as number, segments[k * 4 + 3] as number];
    walk(k, 2, forward);
    const back: number[] = [];
    walk(k, 0, back);
    const head: number[] = [];
    for (let i = back.length - 2; i >= 0; i -= 2) head.push(back[i] as number, back[i + 1] as number);
    lines.push([...head, ...forward]);
  }
  return lines;
}

/**
 * Simplifies a polyline of x and y pairs by Douglas-Peucker, dropping points within `tolerance` of the chord between
 * kept points. For a closed line, whose last point is its first, the point farthest from that shared point is kept
 * first, and each half is simplified as an open line.
 */
export function simplified(line: readonly number[], tolerance: number): number[] {
  const n = line.length / 2;
  if (n < 3) return [...line];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const ax = line[a * 2] as number;
    const ay = line[a * 2 + 1] as number;
    const dx = (line[b * 2] as number) - ax;
    const dy = (line[b * 2 + 1] as number) - ay;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = [(line[i * 2] as number) - ax, (line[i * 2 + 1] as number) - ay];
      // When both ends are the same point, as on a closed line, the distance is from that point.
      const d = length > 1e-9 ? Math.abs(px * dy - py * dx) / length : Math.hypot(px, py);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push(line[i * 2] as number, line[i * 2 + 1] as number);
  return out;
}

/** Each sample's grade (rise over run) in a grid of heights `n` on a side and `cell` apart, averaged over the samples within `SLOPE_REACH` of it. */
export function slopes(h: Float32Array, n: number, cell: number): Float32Array {
  const at = (i: number, j: number): number => h[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))] as number;
  const grade = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) grade[j * n + i] = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * cell);
  }
  const broad = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let b = Math.max(0, j - SLOPE_REACH); b <= Math.min(n - 1, j + SLOPE_REACH); b++) {
        for (let a = Math.max(0, i - SLOPE_REACH); a <= Math.min(n - 1, i + SLOPE_REACH); a++) {
          const g = grade[b * n + a] as number;
          if (Number.isNaN(g)) continue;
          sum += g;
          count++;
        }
      }
      broad[j * n + i] = count === 0 ? Number.NaN : sum / count;
    }
  }
  return broad;
}

/**
 * Returns a contour's polylines at `level` through a grid of heights `n` on a side, in grid coordinates, from the
 * segments `keep` accepts (`isoline`, `chained`). With `thin`, it drops segments where the grade (`slopes`) is steeper
 * than `steepest`, and open pieces shorter than `STUB` cells, which thinning leaves at a steep patch's edge. Survey
 * maps thin the lines between their heavier contours the same way.
 */
export function contourLines(h: Float32Array, n: number, level: number, keep: (x0: number, y0: number, x1: number, y1: number) => boolean, thin?: { readonly slopes: Float32Array; readonly steepest: number }): number[][] {
  const segments: number[] = [];
  isoline(h, n, level, (x0, y0, x1, y1) => {
    if (!keep(x0, y0, x1, y1)) return;
    if (thin !== undefined && (thin.slopes[Math.round((y0 + y1) / 2) * n + Math.round((x0 + x1) / 2)] as number) > thin.steepest) return;
    segments.push(x0, y0, x1, y1);
  });
  const lines = chained(segments);
  if (thin === undefined) return lines;
  return lines.filter((line) => {
    const closed = Math.hypot((line[0] as number) - (line[line.length - 2] as number), (line[1] as number) - (line[line.length - 1] as number)) < 1e-3;
    let length = 0;
    for (let q = 2; q < line.length; q += 2) length += Math.hypot((line[q] as number) - (line[q - 2] as number), (line[q + 1] as number) - (line[q - 1] as number));
    return closed || length >= STUB;
  });
}
