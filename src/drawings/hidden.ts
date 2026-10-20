import type { V3 } from '@/core/geometry/faces';
import { type MultiPoly, union } from '@/core/geometry/polygon';
import type { Item, Layer, Pen, Tone } from './ir';

/**
 * Hidden-line removal for orthographic views (elevations, sections, axonometrics). Planar polygons
 * in 3D are projected onto the picture plane; every edge and detail line is sampled, each sample
 * is tested against the polygons nearer the viewer, and the visible runs are refined by bisection.
 * The output is plain line work, so the PDF and the DXF get exactly the same drawing.
 */

/** Right, up and forward (into the scene) unit vectors of the picture plane. */
export interface View {
  R: V3;
  U: V3;
  D: V3;
}

/** A planar polygon (outer ring plus holes, or several disjoint rings) in model space. */
export interface Solid {
  rings: V3[][];
  /** Tone painted under the line work in SVG/PDF. */
  fill?: Tone;
  /** Draw its edges, and with which pen. */
  outline?: { pen: Pen; layer: Layer };
  /** Coplanar polygons sharing a seam key read as one surface: no line where they meet. */
  seam?: string;
  /** Outward normal; worked out from the first ring's winding when absent. */
  normal?: V3;
}

export interface Line3 {
  a: V3;
  b: V3;
  pen: Pen;
  layer: Layer;
  /** Normal of the surface the line is drawn on; skipped when that surface faces away. */
  n?: V3;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Occ {
  rings: Float64Array[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** depth = a*x + b*y + c */
  a: number;
  b: number;
  c: number;
  seam?: string;
  mid: number;
  solid: Solid;
}

const EDGE_ON = 0.02;
const DEPTH_EPS = 0.03;
const STEP = 0.2;
const CELL = 2;

export interface HiddenResult {
  /** Fills, far to near. */
  fills: Item[];
  lines: Item[];
  /** The outline of everything, for a heavier profile line. */
  silhouette: MultiPoly;
}

export function hiddenLines(solids: Solid[], lines: Line3[], view: View, opts: { silhouette?: boolean } = {}): HiddenResult {
  const { R, U, D } = view;
  const occs: Occ[] = [];
  for (const s of solids) {
    if (!s.rings.length || s.rings[0].length < 3) continue;
    const n = s.normal ?? newell(s.rings[0]);
    const nd = dot(n, D);
    // Edge-on or facing away: neither seen nor (for closed shapes) hiding anything.
    if (nd > -EDGE_ON) continue;
    const k = dot(n, s.rings[0][0]);
    const rings = s.rings.map((r) => {
      const f = new Float64Array(r.length * 2);
      r.forEach((p, i) => {
        f[i * 2] = dot(p, R);
        f[i * 2 + 1] = dot(p, U);
      });
      return f;
    });
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let sum = 0;
    let cnt = 0;
    for (const r of rings)
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]);
        x1 = Math.max(x1, r[i]);
        y0 = Math.min(y0, r[i + 1]);
        y1 = Math.max(y1, r[i + 1]);
      }
    for (const p of s.rings[0]) {
      sum += dot(p, D);
      cnt++;
    }
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) continue;
    occs.push({ rings, x0, y0, x1, y1, a: -dot(n, R) / nd, b: -dot(n, U) / nd, c: k / nd, seam: s.seam, mid: sum / cnt, solid: s });
  }

  // Bucket the polygons on a grid over the picture plane.
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (const o of occs) {
    gx0 = Math.min(gx0, o.x0);
    gy0 = Math.min(gy0, o.y0);
    gx1 = Math.max(gx1, o.x1);
    gy1 = Math.max(gy1, o.y1);
  }
  const nx = Number.isFinite(gx0) ? Math.max(1, Math.ceil((gx1 - gx0) / CELL)) : 1;
  const ny = Number.isFinite(gy0) ? Math.max(1, Math.ceil((gy1 - gy0) / CELL)) : 1;
  const grid: Occ[][] = Array.from({ length: nx * ny }, () => []);
  const cellOf = (x: number, y: number) => {
    const i = Math.floor((x - gx0) / CELL);
    const j = Math.floor((y - gy0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    return j * nx + i;
  };
  for (const o of occs) {
    const i0 = Math.max(0, Math.floor((o.x0 - gx0) / CELL));
    const i1 = Math.min(nx - 1, Math.floor((o.x1 - gx0) / CELL));
    const j0 = Math.max(0, Math.floor((o.y0 - gy0) / CELL));
    const j1 = Math.min(ny - 1, Math.floor((o.y1 - gy0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i].push(o);
  }

  const hidden = (x: number, y: number, d: number) => {
    const c = cellOf(x, y);
    if (c < 0) return false;
    for (const o of grid[c]) {
      if (x <= o.x0 || x >= o.x1 || y <= o.y0 || y >= o.y1) continue;
      if (o.a * x + o.b * y + o.c >= d - DEPTH_EPS) continue;
      if (insideStrict(o.rings, x, y)) return true;
    }
    return false;
  };
  const seamAt = (x: number, y: number, key: string, self: Occ) => {
    const c = cellOf(x, y);
    if (c < 0) return false;
    for (const o of grid[c]) {
      if (o === self || o.seam !== key) continue;
      if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) continue;
      if (inside(o.rings, x, y)) return true;
    }
    return false;
  };

  const out: Item[] = [];
  const seen = new Set<string>();
  const emit = (ax: number, ay: number, bx: number, by: number, pen: Pen, layer: Layer) => {
    if (Math.hypot(bx - ax, by - ay) < 0.02) return;
    const k1 = `${ax.toFixed(2)},${ay.toFixed(2)}`;
    const k2 = `${bx.toFixed(2)},${by.toFixed(2)}`;
    const key = `${layer}|${k1 < k2 ? k1 + k2 : k2 + k1}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ t: 'line', pts: [
      [ax, ay],
      [bx, by],
    ], pen, layer });
  };

  /** Sample a projected segment, keep what is visible (and not a seam), refine the ends. */
  const trace = (ax: number, ay: number, ad: number, bx: number, by: number, bd: number, pen: Pen, layer: Layer, seam?: { key: string; ox: number; oy: number; self: Occ }) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) return;
    const at = (t: number): [number, number, number] => [ax + (bx - ax) * t, ay + (by - ay) * t, ad + (bd - ad) * t];
    const ok = (t: number) => {
      const [x, y, d] = at(t);
      if (hidden(x, y, d)) return false;
      if (seam && seamAt(x + seam.ox, y + seam.oy, seam.key, seam.self)) return false;
      return true;
    };
    const n = Math.max(2, Math.ceil(len / STEP));
    const vis: boolean[] = [];
    for (let i = 0; i <= n; i++) vis.push(ok(i / n));
    const edge = (t0: number, t1: number, v0: boolean) => {
      // Bisect between a sample of state v0 at t0 and its opposite at t1.
      let lo = t0;
      let hi = t1;
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2;
        if (ok(m) === v0) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };
    const minRun = Math.min(0.1, len * 0.5);
    const run = (t0: number, t1: number) => {
      if ((t1 - t0) * len < minRun) return;
      const [x0, y0] = at(t0);
      const [x1, y1] = at(t1);
      emit(x0, y0, x1, y1, pen, layer);
    };
    let start = vis[0] ? 0 : -1;
    for (let i = 1; i <= n; i++) {
      if (vis[i] === vis[i - 1]) continue;
      const t = edge((i - 1) / n, i / n, vis[i - 1]);
      if (vis[i]) start = t;
      else if (start >= 0) {
        run(start, t);
        start = -1;
      }
    }
    if (start >= 0) run(start, 1);
  };

  for (const o of occs) {
    const s = o.solid;
    const ol = s.outline;
    if (!ol) continue;
    s.rings.forEach((ring) => {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        const ax = dot(p, R);
        const ay = dot(p, U);
        const bx = dot(q, R);
        const by = dot(q, U);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-4) continue;
        let seam: { key: string; ox: number; oy: number; self: Occ } | undefined;
        if (s.seam) {
          // Which side of the edge is outside this polygon?
          const lx = (-(by - ay) / len) * 0.02;
          const ly = ((bx - ax) / len) * 0.02;
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const leftIn = inside(o.rings, mx + lx, my + ly);
          seam = { key: s.seam, ox: leftIn ? -lx : lx, oy: leftIn ? -ly : ly, self: o };
        }
        trace(ax, ay, dot(p, D), bx, by, dot(q, D), ol.pen, ol.layer, seam);
      }
    });
  }
  for (const l of lines) {
    if (l.n && dot(l.n, D) > -EDGE_ON) continue;
    trace(dot(l.a, R), dot(l.a, U), dot(l.a, D), dot(l.b, R), dot(l.b, U), dot(l.b, D), l.pen, l.layer);
  }

  const fills: Item[] = paintOrder(occs.filter((o) => o.solid.fill), grid).map((o) => ({ t: 'fill', rings: o.rings.map((r) => ringPts(r)), tone: o.solid.fill!, layer: o.solid.outline?.layer ?? 'A-ELEV' }));

  let silhouette: MultiPoly = [];
  if (opts.silhouette && occs.length) silhouette = union(...occs.map((o) => o.rings.map((r) => ringPts(r))).map((rs) => [orient(rs[0])] as MultiPoly));
  return { fills, lines: out, silhouette };
}

/**
 * Far-to-near order for the tone fills. Average depth alone gets eaves wrong (a roof's middle is
 * behind the wall its overhang is in front of), so overlapping pairs are ordered by comparing
 * depths at a point inside both, then sorted topologically.
 */
function paintOrder(list: Occ[], grid: Occ[][]): Occ[] {
  const idx = new Map(list.map((o, i) => [o, i]));
  const after: number[][] = list.map(() => []);
  const indeg = list.map(() => 0);
  const done = new Set<string>();
  for (const cell of grid)
    for (let i = 0; i < cell.length; i++)
      for (let j = i + 1; j < cell.length; j++) {
        const A = cell[i];
        const B = cell[j];
        const ia = idx.get(A);
        const ib = idx.get(B);
        if (ia === undefined || ib === undefined) continue;
        const key = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
        if (done.has(key)) continue;
        done.add(key);
        const x0 = Math.max(A.x0, B.x0);
        const x1 = Math.min(A.x1, B.x1);
        const y0 = Math.max(A.y0, B.y0);
        const y1 = Math.min(A.y1, B.y1);
        if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) continue;
        let order = 0;
        for (let sy = 0; sy < 7 && !order; sy++)
          for (let sx = 0; sx < 7 && !order; sx++) {
            const x = x0 + ((sx + 0.5) / 7) * (x1 - x0);
            const y = y0 + ((sy + 0.5) / 7) * (y1 - y0);
            if (!inside(A.rings, x, y) || !inside(B.rings, x, y)) continue;
            const da = A.a * x + A.b * y + A.c;
            const db = B.a * x + B.b * y + B.c;
            if (Math.abs(da - db) > 1e-4) order = da > db ? 1 : -1;
          }
        if (!order) continue;
        // The farther one is painted first.
        const [far, near] = order > 0 ? [ia, ib] : [ib, ia];
        after[far].push(near);
        indeg[near]++;
      }
  const out: Occ[] = [];
  const left = new Set(list.map((_, i) => i));
  while (left.size) {
    // Of everything ready, the farthest by average depth; on a cycle, the farthest of what's left.
    let pick = -1;
    for (const i of left) if (indeg[i] === 0 && (pick < 0 || list[i].mid > list[pick].mid)) pick = i;
    if (pick < 0) for (const i of left) if (pick < 0 || list[i].mid > list[pick].mid) pick = i;
    left.delete(pick);
    out.push(list[pick]);
    for (const n of after[pick]) indeg[n]--;
  }
  return out;
}

function ringPts(r: Float64Array): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  return pts;
}

function orient(r: [number, number][]): [number, number][][] {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return [a >= 0 ? r : [...r].reverse()];
}

function newell(ring: V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1, z1] = ring[i];
    const [x2, y2, z2] = ring[(i + 1) % ring.length];
    x += (y1 - y2) * (z1 + z2);
    y += (z1 - z2) * (x1 + x2);
    z += (x1 - x2) * (y1 + y2);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function inside(rings: Float64Array[], px: number, py: number): boolean {
  let c = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2];
      const yi = r[i * 2 + 1];
      const xj = r[j * 2];
      const yj = r[j * 2 + 1];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Inside and not within a hair of any edge, so lines along a nearer polygon's border stay visible. */
function insideStrict(rings: Float64Array[], px: number, py: number): boolean {
  if (!inside(rings, px, py)) return false;
  const m2 = 0.005 * 0.005;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[j * 2];
      const ay = r[j * 2 + 1];
      const bx = r[i * 2];
      const by = r[i * 2 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + dx * t - px;
      const ey = ay + dy * t - py;
      if (ex * ex + ey * ey < m2) return false;
    }
  }
  return true;
}
