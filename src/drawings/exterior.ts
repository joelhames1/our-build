import { MULLION } from '@/core/catalog/openings';
import { type Face3, type V3, buildFaces } from '@/core/geometry/faces';
import type { ResolvedOpening } from '@/core/geometry/openings';
import type { Poly } from '@/core/geometry/polygon';
import { type Box3, porchFrame } from '@/core/geometry/porch';
import { isDoorType } from '@/core/model/schema';
import type { Resolved, ResolvedLevel } from '@/core/resolve';
import type { Line3, Solid } from './hidden';
import type { Layer, Pen, Tone } from './ir';

/**
 * The outside of the building as planar polygons and detail lines for the hidden-line views:
 * walls, roofs, fascia, foundation and chimney from the shared faces; casings, glass, sashes,
 * grilles and door leaves from each opening; porch posts, beams and railings as boxes; and
 * material coursing (siding, battens, seams) drawn as fine lines on the surfaces.
 */
export interface ExteriorScene {
  solids: Solid[];
  lines: Line3[];
}

export interface ExteriorOptions {
  /** Feet per paper inch: coursing gets sparser at smaller scales. */
  scale?: number;
  /** Draw siding and roofing coursing. */
  texture?: boolean;
  /** Include the inside surfaces too (for sections). */
  interior?: boolean;
}

const KEEP = new Set(['wall_ext', 'slab_edge', 'foundation', 'roof', 'roof_under', 'fascia', 'porch_floor', 'chimney', 'reveal']);

export function exteriorScene(res: Resolved, opts: ExteriorOptions = {}): ExteriorScene {
  const scale = opts.scale ?? 4;
  const texture = opts.texture ?? true;
  const solids: Solid[] = [];
  const lines: Line3[] = [];
  const style = res.project.style;
  const exteriorIds = new Set(res.levels.flatMap((rl) => rl.openings.filter((o) => o.exterior).map((o) => o.id)));

  for (const f of buildFaces(res)) {
    if (!opts.interior && !KEEP.has(f.tag)) continue;
    if (!opts.interior && f.tag === 'reveal' && !exteriorIds.has(f.owner)) continue;
    const { fill, pen, layer } = look(f);
    const seam = `${f.tag === 'slab_edge' || f.tag === 'wall_ext' ? 'wall' : f.tag}:${f.mat}:${planeKey(f)}`;
    for (const poly of f.polys) solids.push({ rings: poly.map((r) => r.map(([s, t]) => lift(f, s, t))), fill, outline: { pen, layer }, seam, normal: f.normal });
    if (!texture) continue;
    const pattern = coursing(f, style, scale);
    if (pattern) for (const poly of f.polys) for (const [a, b] of hatchPoly(poly, pattern.gap, pattern.dir)) lines.push({ a: lift(f, ...a), b: lift(f, ...b), pen: 'fine', layer: 'A-ELEV-PATT', n: f.normal });
  }

  for (const rl of res.levels) {
    for (const o of rl.openings) {
      if (!o.exterior || o.type === 'open') continue;
      opening(solids, lines, o, rl, res);
    }
    for (const { posts, beams } of porchFrame(rl)) for (const b of [...posts, ...beams]) solids.push(...boxSolids(b, 'white', 'medium', 'A-ELEV', 'post'));
    railings(solids, rl);
  }
  return { solids, lines };
}

// --- faces --------------------------------------------------------------------------------------

const lift = (f: Face3, s: number, t: number): V3 => [f.origin[0] + s * f.u[0] + t * f.v[0], f.origin[1] + s * f.u[1] + t * f.v[1], f.origin[2] + s * f.u[2] + t * f.v[2]];

function planeKey(f: Face3): string {
  const n = f.normal;
  const k = n[0] * f.origin[0] + n[1] * f.origin[1] + n[2] * f.origin[2];
  return `${n.map((v) => v.toFixed(3)).join(',')}|${k.toFixed(3)}`;
}

function look(f: Face3): { fill: Tone; pen: Pen; layer: Layer } {
  switch (f.tag) {
    case 'roof':
      return { fill: 'tone', pen: 'medium', layer: 'A-ROOF' };
    case 'roof_under':
    case 'fascia':
      return { fill: 'white', pen: 'medium', layer: 'A-ROOF' };
    case 'foundation':
      return { fill: 'light', pen: 'medium', layer: 'A-ELEV' };
    case 'chimney':
      return { fill: 'light', pen: 'medium', layer: 'A-ELEV' };
    case 'slab_edge':
      return { fill: f.mat === 'foundation' ? 'light' : 'white', pen: 'medium', layer: 'A-ELEV' };
    case 'reveal':
      return { fill: 'white', pen: 'fine', layer: 'A-GLAZ' };
    default:
      return { fill: 'white', pen: 'medium', layer: 'A-ELEV' };
  }
}

/** Coursing for a surface: spacing in feet and whether lines run along s (0) or t (1) = const. */
function coursing(f: Face3, style: Resolved['project']['style'], scale: number): { gap: number; dir: 's' | 't' } | null {
  const k = Math.max(1, scale / 4);
  if (f.tag === 'wall_ext' || (f.tag === 'slab_edge' && f.mat === 'siding')) {
    switch (style.wall) {
      case 'lap_siding':
        return { gap: 0.5 * k, dir: 't' };
      case 'shingle':
        return { gap: 0.6 * k, dir: 't' };
      case 'log':
        return { gap: 0.8 * k, dir: 't' };
      case 'brick':
        return { gap: 0.34 * k, dir: 't' };
      case 'board_and_batten':
        return { gap: 1.25 * k, dir: 's' };
      case 'vertical_wood':
        return { gap: 0.5 * k, dir: 's' };
      case 'panel':
        return { gap: 4, dir: 's' };
      default:
        return null;
    }
  }
  if (f.tag === 'chimney' && f.mat === 'brick') return { gap: 0.34 * k, dir: 't' };
  if (f.tag === 'roof') {
    switch (style.roofMaterial) {
      case 'standing_seam':
        return { gap: 1.5 * k, dir: 's' };
      case 'cedar_shake':
        return { gap: 0.8 * k, dir: 't' };
      case 'slate':
        return { gap: 0.7 * k, dir: 't' };
      case 'clay_tile':
        return { gap: 0.9 * k, dir: 's' };
      default:
        return null;
    }
  }
  return null;
}

/** Lines across a polygon (outer ring + holes) at a fixed spacing, clipped to its inside. */
export function hatchPoly(poly: Poly, gap: number, dir: 's' | 't'): [[number, number], [number, number]][] {
  const out: [[number, number], [number, number]][] = [];
  const c = dir === 't' ? 1 : 0; // the coordinate held constant
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of poly) for (const p of r) {
    lo = Math.min(lo, p[c]);
    hi = Math.max(hi, p[c]);
  }
  for (let v = Math.ceil((lo + 1e-6) / gap) * gap; v < hi - 1e-6; v += gap) {
    const xs: number[] = [];
    for (const r of poly)
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        if (p[c] <= v !== q[c] <= v) xs.push(p[1 - c] + ((v - p[c]) / (q[c] - p[c])) * (q[1 - c] - p[1 - c]));
      }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 0.05) continue;
      out.push(c === 1 ? [[xs[i], v], [xs[i + 1], v]] : [[v, xs[i]], [v, xs[i + 1]]]);
    }
  }
  return out;
}

// --- boxes --------------------------------------------------------------------------------------

export function boxSolids(b: Box3, fill: Tone, pen: Pen, layer: Layer, seam?: string): Solid[] {
  const { x0, x1, y0, y1, z0, z1 } = b;
  const quad = (pts: V3[]): Solid => ({ rings: [pts], fill, outline: { pen, layer }, seam: seam ? `${seam}:${pts.map((p) => p.join()).join()}` : undefined });
  return [
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]), // -y
    quad([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]), // +y
    quad([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]), // -x
    quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]), // +x
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]), // top
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]), // bottom
  ];
}

function railings(solids: Solid[], rl: ResolvedLevel) {
  for (const w of rl.walls) {
    if (w.kind !== 'railing') continue;
    const z0 = rl.elevation - (w.pos && w.neg ? 0 : 0.33);
    const box = (a: number, b: number, half: number, za: number, zb: number): Box3 =>
      w.axis === 'x' ? { x0: a, x1: b, y0: w.coord - half, y1: w.coord + half, z0: z0 + za, z1: z0 + zb } : { y0: a, y1: b, x0: w.coord - half, x1: w.coord + half, z0: z0 + za, z1: z0 + zb };
    solids.push(...boxSolids(box(w.a, w.b, 0.15, 2.8, 3), 'white', 'medium', 'A-ELEV'));
    solids.push(...boxSolids(box(w.a, w.b, 0.1, 0.28, 0.43), 'white', 'fine', 'A-ELEV'));
    const len = w.b - w.a;
    const n = Math.max(1, Math.round(len / 0.4));
    for (let i = 1; i < n; i++) {
      const u = w.a + (len * i) / n;
      solids.push(...boxSolids(box(u - 0.05, u + 0.05, 0.05, 0.43, 2.8), 'white', 'fine', 'A-ELEV'));
    }
  }
}

// --- openings -----------------------------------------------------------------------------------

function opening(solids: Solid[], lines: Line3[], o: ResolvedOpening, rl: ResolvedLevel, res: Resolved) {
  const t = o.wall.thickness;
  const sgn = o.wall.outside === 0 ? 1 : o.wall.outside;
  const z0 = rl.elevation;
  const P = (u: number, n: number, z: number): V3 => (o.axis === 'x' ? [u, o.wall.coord + sgn * n, z0 + z] : [o.wall.coord + sgn * n, u, z0 + z]);
  const normal: V3 = o.axis === 'x' ? [0, sgn, 0] : [sgn, 0, 0];
  const rect = (u0: number, u1: number, za: number, zb: number, n: number): V3[] => [P(u0, n, za), P(u1, n, za), P(u1, n, zb), P(u0, n, zb)];
  const seg = (ua: number, za: number, ub: number, zb: number, n: number, pen: Pen = 'fine', layer: Layer = 'A-GLAZ') => lines.push({ a: P(ua, n, za), b: P(ub, n, zb), pen, layer, n: normal });
  const box = (u0: number, u1: number, za: number, zb: number, n: number, pen: Pen = 'fine', layer: Layer = 'A-GLAZ') => {
    seg(u0, za, u1, za, n, pen, layer);
    seg(u1, za, u1, zb, n, pen, layer);
    seg(u1, zb, u0, zb, n, pen, layer);
    seg(u0, zb, u0, za, n, pen, layer);
  };
  const style = res.project.style;
  const modern = style.windows === 'modern';
  const face = t / 2;
  const door = isDoorType(o.type);
  const layer: Layer = door ? 'A-DOOR' : 'A-GLAZ';

  // Casing proud of the wall: a frame around the opening, with a sill nose under windows.
  const cw = modern ? 0.12 : 0.3;
  const ch = modern ? 0.12 : 0.45;
  const cz0 = o.sill > 0.05 ? o.sill - 0.08 : 0;
  const outer: V3[] = rect(o.u0 - cw, o.u1 + cw, cz0, o.head + ch, face + 0.05);
  if (o.sill > 0.05) solids.push({ rings: [outer, rect(o.u0, o.u1, o.sill, o.head, face + 0.05).reverse()], fill: 'white', outline: { pen: 'fine', layer }, normal });
  else solids.push({ rings: [[P(o.u0 - cw, face + 0.05, 0), P(o.u0, face + 0.05, 0), P(o.u0, face + 0.05, o.head), P(o.u1, face + 0.05, o.head), P(o.u1, face + 0.05, 0), P(o.u1 + cw, face + 0.05, 0), P(o.u1 + cw, face + 0.05, o.head + ch), P(o.u0 - cw, face + 0.05, o.head + ch)]], fill: 'white', outline: { pen: 'fine', layer }, normal });
  if (o.sill > 0.05 && !modern) solids.push(...boxSolids(toBox(P, o.u0 - cw - 0.08, o.u1 + cw + 0.08, o.sill - 0.24, o.sill - 0.08, face, face + 0.2), 'white', 'fine', layer));

  if (o.type === 'cased_opening') return;
  const nGlass = face - 0.2;
  const nFrame = face - 0.1;

  if (!door) {
    for (let k = 0; k < o.count; k++) {
      const u0 = o.u0 + k * (o.unitWidth + MULLION);
      const u1 = u0 + o.unitWidth;
      solids.push({ rings: [rect(u0, u1, o.sill, o.head, nGlass)], fill: 'glass', normal });
      if (k > 0) solids.push({ rings: [rect(u0 - MULLION, u0, o.sill, o.head, nFrame)], fill: 'white', outline: { pen: 'fine', layer }, normal });
      sash(u0, u1, o.sill, o.head);
    }
    return;
  }

  // Doors: leaves set back in the opening.
  const nLeaf = face - 0.3;
  const w = o.u1 - o.u0;
  const h = o.head;
  if (o.type === 'garage_door') {
    solids.push({ rings: [rect(o.u0 + 0.05, o.u1 - 0.05, 0, h - 0.05, nLeaf)], fill: 'light', outline: { pen: 'fine', layer }, normal });
    for (let i = 1; i < 4; i++) seg(o.u0 + 0.05, (h * i) / 4, o.u1 - 0.05, (h * i) / 4, nLeaf - 0.01, 'fine', layer);
    return;
  }
  const leaves = o.type === 'double_door' || o.type === 'french_door' || o.type === 'slider' ? 2 : 1;
  const lw = (w - 0.24) / leaves;
  const glassy = o.type === 'french_door' || o.type === 'slider';
  for (let k = 0; k < leaves; k++) {
    const a = o.u0 + 0.12 + k * lw;
    const b = a + lw;
    const top = h - 0.1;
    const n = o.type === 'slider' && k === 0 ? nLeaf + 0.08 : nLeaf;
    solids.push({ rings: [rect(a, b, 0, top, n)], fill: glassy ? 'glass' : 'light', outline: { pen: 'fine', layer }, normal });
    const nd = n + 0.01;
    if (glassy) {
      box(a + 0.25, b - 0.25, 0.6, top - 0.3, nd, 'fine', layer);
      if (style.grilles !== 'none') grilles(a + 0.25, b - 0.25, 0.6, top - 0.3, nd, false);
      continue;
    }
    if (modern) {
      seg(k === 0 && leaves === 2 ? b - 0.3 : a + 0.3, 2.5, k === 0 && leaves === 2 ? b - 0.3 : a + 0.3, 4.5, nd, 'medium', layer);
      continue;
    }
    const pw = lw * 0.6;
    const c = (a + b) / 2;
    box(c - pw / 2, c + pw / 2, h * 0.13, h * 0.43, nd, 'fine', layer);
    if (o.exterior) {
      box(c - lw * 0.275, c + lw * 0.275, h * 0.57, h * 0.87, nd, 'fine', layer);
      solids.push({ rings: [rect(c - lw * 0.275, c + lw * 0.275, h * 0.57, h * 0.87, n + 0.02)], fill: 'glass', normal });
    } else box(c - pw / 2, c + pw / 2, h * 0.52, h * 0.85, nd, 'fine', layer);
  }

  function sash(u0: number, u1: number, sill: number, head: number) {
    const fw = 0.14;
    const n = nFrame;
    box(u0, u1, sill, head, n);
    box(u0 + fw, u1 - fw, sill + fw, head - fw, n);
    if (o.type === 'transom' || o.type === 'picture_window') return;
    const mid = (sill + head) / 2;
    if (style.windows === 'double_hung') {
      seg(u0 + fw, mid - 0.06, u1 - fw, mid - 0.06, n);
      seg(u0 + fw, mid + 0.06, u1 - fw, mid + 0.06, n);
    } else if (style.windows === 'casement' && u1 - u0 > 2.6) {
      seg((u0 + u1) / 2 - 0.06, sill + fw, (u0 + u1) / 2 - 0.06, head - fw, n);
      seg((u0 + u1) / 2 + 0.06, sill + fw, (u0 + u1) / 2 + 0.06, head - fw, n);
    }
    grilles(u0 + fw, u1 - fw, sill + fw, head - fw, n, style.windows === 'double_hung');
  }

  function grilles(u0: number, u1: number, za: number, zb: number, n: number, hung: boolean) {
    const kind = style.grilles;
    if (kind === 'none') return;
    const mid = (za + zb) / 2;
    const sashes: [number, number][] = hung ? (kind === 'cottage' ? [[mid + 0.06, zb]] : [[za, mid - 0.06], [mid + 0.06, zb]]) : [[za, zb]];
    for (const [a, b] of sashes) {
      if (kind === 'prairie') {
        const i = 0.35;
        seg(u0, b - i, u1, b - i, n);
        if (!hung) seg(u0, a + i, u1, a + i, n);
        seg(u0 + i, a, u0 + i, b, n);
        seg(u1 - i, a, u1 - i, b, n);
        continue;
      }
      const cols = Math.max(2, Math.round((u1 - u0) / 1.0));
      const rows = Math.max(2, Math.round((b - a) / 1.1));
      for (let c = 1; c < cols; c++) seg(u0 + ((u1 - u0) * c) / cols, a, u0 + ((u1 - u0) * c) / cols, b, n);
      for (let r = 1; r < rows; r++) seg(u0, a + ((b - a) * r) / rows, u1, a + ((b - a) * r) / rows, n);
    }
  }
}

function toBox(P: (u: number, n: number, z: number) => V3, u0: number, u1: number, za: number, zb: number, n0: number, n1: number): Box3 {
  const a = P(u0, n0, za);
  const b = P(u1, n1, zb);
  return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), z0: Math.min(a[2], b[2]), z1: Math.max(a[2], b[2]) };
}
