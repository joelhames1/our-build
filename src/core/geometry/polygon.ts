import pc from 'polygon-clipping';
import type { Pt, Rect } from '../model/schema';

export type Ring = Pt[];
/** Outer ring first, then holes. Rings are open (first point not repeated). */
export type Poly = Ring[];
export type MultiPoly = Poly[];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectToBox = ([x, y, w, d]: Rect): Box => ({ x0: x, y0: y, x1: x + w, y1: y + d });
export const boxToRect = (b: Box): Rect => [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
export const boxRing = (b: Box): Ring => [
  [b.x0, b.y0],
  [b.x1, b.y0],
  [b.x1, b.y1],
  [b.x0, b.y1],
];
export const rectRing = (r: Rect): Ring => boxRing(rectToBox(r));
export const boxW = (b: Box) => b.x1 - b.x0;
export const boxD = (b: Box) => b.y1 - b.y0;
export const boxArea = (b: Box) => boxW(b) * boxD(b);
export const boxCenter = (b: Box): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
export const expandBox = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });
export const boxesOverlap = (a: Box, b: Box, eps = 1e-6) =>
  a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;

export function ringBox(ring: Ring): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function multiBox(m: MultiPoly): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of m)
    for (const [x, y] of p[0]) {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    }
  return b;
}

/** Signed area: positive for counter-clockwise. */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const polyArea = (p: Poly) => p.reduce((s, r, i) => s + (i === 0 ? Math.abs(ringArea(r)) : -Math.abs(ringArea(r))), 0);
export const multiArea = (m: MultiPoly) => m.reduce((s, p) => s + polyArea(p), 0);

export function ccw(ring: Ring): Ring {
  return ringArea(ring) < 0 ? [...ring].reverse() : ring;
}

export function pointInRing([px, py]: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPoly(pt: Pt, poly: Poly): boolean {
  if (!pointInRing(pt, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(pt, poly[i])) return false;
  return true;
}

export const pointInMulti = (pt: Pt, m: MultiPoly) => m.some((p) => pointInPoly(pt, p));

// --- boolean ops (polygon-clipping works with closed rings; we keep rings open) ---

const close = (r: Ring): Ring => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
const open = (r: Ring): Ring => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

type PcGeom = pc.Polygon | pc.MultiPolygon;
const q = (v: number, step: number) => Math.round(v / step) * step;
const toPc = (m: MultiPoly, step = 1e-7): pc.MultiPolygon => m.map((p) => p.map((r) => close(r.map(([x, y]) => [q(x, step), q(y, step)] as [number, number])) as pc.Ring));

/**
 * polygon-clipping is exact enough for plans but can recurse forever on near-degenerate input.
 * Retry with coarser snapping before giving up.
 */
function robust(run: (step: number) => pc.MultiPolygon, fallback: () => MultiPoly): MultiPoly {
  for (const step of [1e-7, 1e-5, 1e-3]) {
    try {
      return fromPc(run(step));
    } catch {
      // try again, coarser
    }
  }
  return fallback();
}
const fromPc = (m: pc.MultiPolygon): MultiPoly =>
  m
    .map((p) => p.map((r) => cleanRing(open(r as Ring))))
    .filter((p) => p[0].length >= 3 && Math.abs(ringArea(p[0])) > 1e-6)
    .map((p) => [ccw(p[0]), ...p.slice(1).filter((h) => h.length >= 3).map((h) => [...ccw(h)].reverse())]);

export function union(...geoms: MultiPoly[]): MultiPoly {
  const gs = geoms.filter((g) => g.length);
  if (!gs.length) return [];
  return robust(
    (st) => pc.union(toPc(gs[0], st) as PcGeom, ...gs.slice(1).map((g) => toPc(g, st) as PcGeom)),
    () => gs.flat(),
  );
}

export function difference(a: MultiPoly, ...b: MultiPoly[]): MultiPoly {
  if (!a.length) return [];
  const bs = b.filter((g) => g.length);
  if (!bs.length) return a;
  return robust(
    (st) => pc.difference(toPc(a, st) as PcGeom, ...bs.map((g) => toPc(g, st) as PcGeom)),
    () => a,
  );
}

export function intersection(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (!a.length || !b.length) return [];
  return robust(
    (st) => pc.intersection(toPc(a, st) as PcGeom, toPc(b, st) as PcGeom),
    () => [],
  );
}

export const boxMulti = (b: Box): MultiPoly => [[boxRing(b)]];
export const ringMulti = (r: Ring): MultiPoly => [[ccw(r)]];

/** Drop duplicate and collinear points. */
export function cleanRing(ring: Ring, eps = 1e-7): Ring {
  const pts: Ring = [];
  for (const p of ring) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) pts.push(p);
  }
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) <= eps && Math.abs(f[1] - l[1]) <= eps) pts.pop();
  }
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) <= eps) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Clip a convex polygon by the half-plane a*x + b*y + c >= 0 (Sutherland–Hodgman). */
export function clipHalfPlane(ring: Ring, a: number, b: number, c: number): Ring {
  const out: Ring = [];
  const f = (p: Pt) => a * p[0] + b * p[1] + c;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Room outline (rect or poly) as a counter-clockwise ring. */
export function roomRing(room: { rect?: Rect; poly?: Pt[] }): Ring {
  if (room.poly && room.poly.length >= 3) return ccw(room.poly.map((p) => [p[0], p[1]] as Pt));
  if (room.rect) return rectRing(room.rect);
  return [];
}

export interface Edge {
  a: Pt;
  b: Pt;
}

export function ringEdges(ring: Ring): Edge[] {
  return ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }));
}

/** Distance from a point to a segment. */
export function distToSeg([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Largest axis-aligned rectangle inside a rectilinear region, preferring the widest span
 * (maximizes min(w, d), then area). Brute force over the coordinate grid; regions are small.
 */
export function largestRect(region: MultiPoly, score: (b: Box) => number = (b) => Math.min(boxW(b), boxD(b)) * 1e4 + boxArea(b)): Box | null {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const p of region)
    for (const r of p)
      for (const [x, y] of r) {
        xs.add(round6(x));
        ys.add(round6(y));
      }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const nx = X.length - 1;
  const ny = Y.length - 1;
  if (nx < 1 || ny < 1) return null;
  // occupancy of each grid cell, with 2D prefix sums
  const occ: number[][] = [];
  for (let i = 0; i < nx; i++) {
    occ.push([]);
    for (let j = 0; j < ny; j++) {
      const c: Pt = [(X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2];
      occ[i].push(pointInMulti(c, region) ? 1 : 0);
    }
  }
  const S: number[][] = Array.from({ length: nx + 1 }, () => new Array(ny + 1).fill(0));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) S[i + 1][j + 1] = occ[i][j] + S[i][j + 1] + S[i + 1][j] - S[i][j];
  const full = (i0: number, j0: number, i1: number, j1: number) =>
    S[i1][j1] - S[i0][j1] - S[i1][j0] + S[i0][j0] === (i1 - i0) * (j1 - j0);
  let best: Box | null = null;
  let bestScore = -Infinity;
  for (let i0 = 0; i0 < nx; i0++)
    for (let j0 = 0; j0 < ny; j0++) {
      if (!occ[i0][j0]) continue;
      for (let i1 = i0 + 1; i1 <= nx; i1++) {
        if (!full(i0, j0, i1, j0 + 1)) break;
        for (let j1 = j0 + 1; j1 <= ny; j1++) {
          if (!full(i0, j0, i1, j1)) break;
          const b = { x0: X[i0], y0: Y[j0], x1: X[i1], y1: Y[j1] };
          const s = score(b);
          if (s > bestScore) {
            bestScore = s;
            best = b;
          }
        }
      }
    }
  return best;
}

/** Decompose a rectilinear region into rectangles (largest first). */
export function decomposeRects(region: MultiPoly, minSize = 0.25): Box[] {
  const out: Box[] = [];
  let rest = region;
  for (let guard = 0; guard < 40 && multiArea(rest) > minSize * minSize; guard++) {
    const b = largestRect(rest);
    if (!b) break;
    out.push(b);
    rest = difference(rest, boxMulti(b));
  }
  return out;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
