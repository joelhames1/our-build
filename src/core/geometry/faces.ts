import type { Project } from '../model/schema';
import { isEnclosed, isOutdoor } from '../model/schema';
import { FLOOR_STRUCTURE, type Resolved, type ResolvedLevel, roomAt } from '../resolve';
import type { ResolvedOpening } from './openings';
import { type Box, type MultiPoly, type Poly, type Ring, boxMulti, difference, intersection, multiArea, pointInMulti, ringArea, roomRing, union } from './polygon';
import { type RoofFace, planeZ, roofZAt } from './roof';
import { wallUnion } from './walls';

/**
 * Planar faces in plan coordinates (x east, y north, z up), each with a 2D frame so the viewer can
 * triangulate with earcut and texture in real-world feet. Drawings reuse the same faces.
 */
export type V3 = [number, number, number];

export type FaceTag =
  | 'wall_ext'
  | 'wall_int'
  | 'wall_cap'
  | 'reveal'
  | 'floor'
  | 'ceiling'
  | 'slab_edge'
  | 'slab_bottom'
  | 'foundation'
  | 'roof'
  | 'roof_under'
  | 'fascia'
  | 'porch_floor';

export interface Face3 {
  tag: FaceTag;
  /** Material key, e.g. 'siding', 'paint:#f3efe7', 'floor:oak', 'roof', 'trim'. */
  mat: string;
  /** Element id for picking (room, wall, roof face, level). */
  owner: string;
  level: number;
  origin: V3;
  u: V3;
  v: V3;
  /** Polygons (outer ring + holes) in the (s, t) frame: point = origin + s*u + t*v. */
  polys: Poly[];
  normal: V3;
}

export interface FaceOptions {
  /** Dollhouse: cut walls of this level index at `cutHeight` above its floor and hide what is above. */
  cutLevel?: number;
  cutHeight?: number;
}

const EPS = 1e-6;

export function buildFaces(res: Resolved, opts: FaceOptions = {}): Face3[] {
  const faces: Face3[] = [];
  const p = res.project;
  const lastLevel = opts.cutLevel ?? res.levels.length - 1;
  for (const rl of res.levels) {
    if (rl.index > lastLevel) break;
    const cut = opts.cutLevel === rl.index && opts.cutHeight !== undefined ? rl.elevation + opts.cutHeight : undefined;
    faces.push(...wallFaces(res, rl, p, cut));
    faces.push(...floorFaces(res, rl, p));
    if (cut === undefined) faces.push(...ceilingFaces(res, rl, p));
  }
  faces.push(...foundationFaces(res, p));
  const roof = roofFaces(res, p);
  // In a dollhouse cut, only roofs below the cut level stay.
  faces.push(...(opts.cutLevel === undefined ? roof : roof.filter((f) => f.level < opts.cutLevel!)));
  return faces;
}

// --- walls --------------------------------------------------------------------------------------

interface BoundaryEdge {
  axis: 'x' | 'y';
  coord: number;
  a: number;
  b: number;
  /** Outward normal direction along the perpendicular axis (+1/-1). */
  out: 1 | -1;
}

function polyEdges(m: MultiPoly): BoundaryEdge[] {
  const out: BoundaryEdge[] = [];
  for (const poly of m)
    poly.forEach((ring, ri) => {
      // Outer rings are CCW and holes CW, so in both cases the outward side is right of travel.
      void ri;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        if (Math.abs(y1 - y2) < EPS && Math.abs(x1 - x2) > EPS) out.push({ axis: 'x', coord: y1, a: Math.min(x1, x2), b: Math.max(x1, x2), out: x2 > x1 ? -1 : 1 });
        else if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) > EPS) out.push({ axis: 'y', coord: x1, a: Math.min(y1, y2), b: Math.max(y1, y2), out: y2 > y1 ? 1 : -1 });
      }
    });
  return out;
}

/** Piecewise-linear top of a wall face along its line. */
function topProfile(res: Resolved, rl: ResolvedLevel, e: BoundaryEdge, exteriorLine: boolean, cut?: number): [number, number][] {
  const roofFaces = res.roof.faces.filter((f) => f.level === rl.roofLevel);
  const above = rl.hasFloorAbove ? res.levels[rl.index + 1] : undefined;
  const ceilingTop = rl.elevation + rl.level.ceiling;
  const lineOff = e.out * 0.01; // sample just inside the solid to stay on the face's own side
  const at = (u: number): [number, number] => (e.axis === 'x' ? [u, e.coord - lineOff] : [e.coord - lineOff, u]);
  const topAt = (u: number): number => {
    const [x, y] = at(u);
    let top: number;
    const covered = above && pointInMulti([x, y], above.footprint);
    const rz = roofZAt(roofFaces, rl.roofLevel, x, y);
    if (exteriorLine) {
      if (covered) top = ceilingTop;
      else if (rz !== null) top = rz - res.roof.thickness;
      else top = rl.plate;
    } else {
      // Interior partitions stop at the ceiling, or under a sloped roof where it is lower.
      top = ceilingTop;
      const info = roomAt(rl, x + (e.axis === 'y' ? e.out * 0.3 : 0), y + (e.axis === 'x' ? e.out * 0.3 : 0));
      const vaulted = info?.room.ceiling === 'vaulted' && !covered;
      if (rz !== null && !covered) top = vaulted ? rz - res.roof.thickness : Math.min(top, rz - res.roof.thickness);
    }
    if (cut !== undefined) top = Math.min(top, cut);
    return top;
  };
  // Breakpoints: ends, roof face edges and upper-footprint edges crossing this line.
  const us = new Set<number>([e.a, e.b]);
  const addCross = (ring: Ring) => {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      const c = e.coord - lineOff;
      if (e.axis === 'x') {
        if ((y1 - c) * (y2 - c) <= 0 && Math.abs(y2 - y1) > EPS) {
          const u = x1 + ((c - y1) / (y2 - y1)) * (x2 - x1);
          if (u > e.a && u < e.b) us.add(u);
        }
      } else if ((x1 - c) * (x2 - c) <= 0 && Math.abs(x2 - x1) > EPS) {
        const u = y1 + ((c - x1) / (x2 - x1)) * (y2 - y1);
        if (u > e.a && u < e.b) us.add(u);
      }
    }
  };
  for (const f of roofFaces) for (const poly of f.visible) for (const ring of poly) addCross(ring);
  if (above) for (const poly of above.footprint) for (const ring of poly) addCross(ring);
  const sorted = [...us].sort((a, b) => a - b);
  const pts: [number, number][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    if (i > 0) pts.push([u, topAt(u - 1e-4)]);
    if (i < sorted.length - 1) pts.push([u, topAt(u + 1e-4)]);
  }
  // Collapse duplicates and nearly collinear points.
  const out: [number, number][] = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-6 && Math.abs(last[1] - q[1]) < 1e-6) continue;
    out.push(q);
  }
  return out;
}

function wallFaces(res: Resolved, rl: ResolvedLevel, p: Project, cut?: number): Face3[] {
  const faces: Face3[] = [];
  const solid = rl.walls.filter((w) => w.kind === 'exterior' || w.kind === 'interior');
  if (!solid.length) return faces;
  const uni = wallUnion(rl.walls);
  const z0 = rl.elevation;
  const interiorPaint = p.style.interiorWall;

  for (const e of polyEdges(uni)) {
    // Which wall line does this face belong to?
    const wall = solid.find((w) => w.axis === e.axis && Math.abs(Math.abs(e.coord - w.coord) - w.thickness / 2) < 1e-4 && Math.min(e.b, w.b + w.thickness) - Math.max(e.a, w.a - w.thickness) > EPS);
    const exteriorLine = solid.some((w) => w.kind === 'exterior' && w.axis === e.axis && Math.abs(Math.abs(e.coord - w.coord) - w.thickness / 2) < 1e-4 && Math.min(e.b, w.b) - Math.max(e.a, w.a) > EPS);
    // What is in front of this face?
    const mid = (e.a + e.b) / 2;
    const probe: [number, number] = e.axis === 'x' ? [mid, e.coord + e.out * 0.05] : [e.coord + e.out * 0.05, mid];
    const front = roomAt(rl, probe[0], probe[1]);
    const outside = !front || isOutdoor(front.room.type);
    const mat = outside ? 'siding' : `paint:${front!.room.wallColor ?? interiorPaint}`;
    const tag = outside ? 'wall_ext' : 'wall_int';

    const profile = topProfile(res, rl, e, exteriorLine || outside, cut);
    if (profile.length < 2) continue;
    // Face polygon in (u, z): along the wall from a to b, up to the profile.
    const outline: Ring = [[e.a, z0], [e.b, z0], ...[...profile].reverse().map(([u, z]) => [u, Math.max(z, z0 + 0.01)] as [number, number])];
    let shape: MultiPoly = [[cleanUZ(outline)]];
    if (Math.abs(ringArea(shape[0][0])) < 1e-4) continue;
    // Openings through this wall line.
    const holes: MultiPoly = [];
    for (const o of rl.openings) {
      if (o.type === 'open' || o.axis !== e.axis) continue;
      if (Math.abs(o.wall.coord - e.coord) > o.wall.thickness / 2 + 1e-4) continue;
      const u0 = Math.max(o.u0, e.a);
      const u1 = Math.min(o.u1, e.b);
      if (u1 - u0 < EPS) continue;
      holes.push([[[u0, z0 + o.sill], [u1, z0 + o.sill], [u1, z0 + o.head], [u0, z0 + o.head]]]);
    }
    if (holes.length) shape = difference(shape, union(holes));
    if (!shape.length) continue;
    faces.push(frameFace(tag, mat, wall?.id ?? `${rl.level.id}:wall`, rl.index, e, shape));
  }

  // Reveals: the inside surfaces of each opening through the wall thickness.
  for (const o of rl.openings) {
    if (o.type === 'open') continue;
    const top = cut !== undefined ? Math.min(z0 + o.head, cut) : z0 + o.head;
    if (z0 + o.sill >= top) continue;
    faces.push(...revealFaces(o, z0, top, rl.index));
  }

  if (cut !== undefined && rl.level.kind === 'full') {
    // Solid tops on cut walls (the dollhouse poché). Half stories rely on dark wall backs instead.
    const cutRel = cut - z0;
    const holes: Box[] = rl.openings
      .filter((o) => o.type !== 'open' && o.sill < cutRel && o.head > cutRel)
      .map((o) => (o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: o.wall.coord - o.wall.thickness, y1: o.wall.coord + o.wall.thickness } : { y0: o.u0, y1: o.u1, x0: o.wall.coord - o.wall.thickness, x1: o.wall.coord + o.wall.thickness }));
    const capPoly = wallUnion(rl.walls, holes);
    if (capPoly.length) faces.push({ tag: 'wall_cap', mat: 'cap', owner: `${rl.level.id}:cap`, level: rl.index, origin: [0, 0, cut], u: [1, 0, 0], v: [0, 1, 0], polys: capPoly, normal: [0, 0, 1] });
  }
  return faces;
}

function cleanUZ(r: Ring): Ring {
  const out: Ring = [];
  for (const q of r) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-7 && Math.abs(last[1] - q[1]) < 1e-7) continue;
    out.push(q);
  }
  if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-7 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-7) out.pop();
  return out;
}

/** A vertical face along a boundary edge; frame s = along the axis, t = z. */
function frameFace(tag: FaceTag, mat: string, owner: string, level: number, e: BoundaryEdge, shape: MultiPoly): Face3 {
  const origin: V3 = e.axis === 'x' ? [0, e.coord, 0] : [e.coord, 0, 0];
  const u: V3 = e.axis === 'x' ? [1, 0, 0] : [0, 1, 0];
  const normal: V3 = e.axis === 'x' ? [0, e.out, 0] : [e.out, 0, 0];
  return { tag, mat, owner, level, origin, u, v: [0, 0, 1], polys: shape, normal };
}

function revealFaces(o: ResolvedOpening, z0: number, top: number, level: number): Face3[] {
  const t = o.wall.thickness;
  const c = o.wall.coord;
  const faces: Face3[] = [];
  const sill = z0 + o.sill;
  const mat = 'trim';
  // Jambs
  for (const [u, n] of [
    [o.u0, 1],
    [o.u1, -1],
  ] as const) {
    if (o.axis === 'x') faces.push({ tag: 'reveal', mat, owner: o.id, level, origin: [u, 0, 0], u: [0, 1, 0], v: [0, 0, 1], polys: [[[[c - t / 2, sill], [c + t / 2, sill], [c + t / 2, top], [c - t / 2, top]]]], normal: [n, 0, 0] });
    else faces.push({ tag: 'reveal', mat, owner: o.id, level, origin: [0, u, 0], u: [1, 0, 0], v: [0, 0, 1], polys: [[[[c - t / 2, sill], [c + t / 2, sill], [c + t / 2, top], [c - t / 2, top]]]], normal: [0, n, 0] });
  }
  // Head (facing down) and sill (facing up)
  const span: Ring = o.axis === 'x' ? [[o.u0, c - t / 2], [o.u1, c - t / 2], [o.u1, c + t / 2], [o.u0, c + t / 2]] : [[c - t / 2, o.u0], [c + t / 2, o.u0], [c + t / 2, o.u1], [c - t / 2, o.u1]];
  if (top >= z0 + o.head - 1e-6) faces.push({ tag: 'reveal', mat, owner: o.id, level, origin: [0, 0, top], u: [1, 0, 0], v: [0, 1, 0], polys: [[span]], normal: [0, 0, -1] });
  if (o.sill > 0.01) faces.push({ tag: 'reveal', mat: 'sill', owner: o.id, level, origin: [0, 0, sill], u: [1, 0, 0], v: [0, 1, 0], polys: [[span]], normal: [0, 0, 1] });
  return faces;
}

// --- floors, ceilings, slabs ----------------------------------------------------------------------

const stairHoleMulti = (rl: ResolvedLevel): MultiPoly => union(...rl.stairHoles.map((s) => boxMulti(s.footprint)));

function floorFaces(res: Resolved, rl: ResolvedLevel, p: Project): Face3[] {
  const faces: Face3[] = [];
  const holes = stairHoleMulti(rl);
  for (const info of rl.rooms.values()) {
    const r = info.room;
    if (r.type === 'open_to_below') continue;
    let shape: MultiPoly = [[roomRing(r)]];
    if (holes.length) shape = difference(shape, holes);
    if (!shape.length) continue;
    if (isOutdoor(r.type)) {
      const z = rl.elevation - 0.33;
      faces.push({ tag: 'porch_floor', mat: r.type === 'patio' ? 'floor:stone' : 'floor:deck', owner: r.id, level: rl.index, origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], polys: shape, normal: [0, 0, 1] });
      // Porch/deck edges down to grade (or a thin deck edge on upper levels).
      const bottom = rl.index === 0 ? 0 : z - 0.8;
      for (const e of polyEdges(shape)) {
        const probe: [number, number] = e.axis === 'x' ? [(e.a + e.b) / 2, e.coord + e.out * 0.05] : [e.coord + e.out * 0.05, (e.a + e.b) / 2];
        if (pointInMulti(probe, rl.footprint)) continue;
        faces.push(frameFace('slab_edge', rl.index === 0 ? 'foundation' : 'trim', r.id, rl.index, e, [[[[e.a, bottom], [e.b, bottom], [e.b, z], [e.a, z]]]]));
      }
      continue;
    }
    const mat = `floor:${r.floor ?? (r.type === 'bath' || r.type === 'half_bath' || r.type === 'laundry' || r.type === 'mudroom' ? 'tile' : r.type === 'garage' || r.type === 'mechanical' ? 'concrete' : p.style.floor)}`;
    faces.push({ tag: 'floor', mat, owner: r.id, level: rl.index, origin: [0, 0, rl.elevation], u: [1, 0, 0], v: [0, 1, 0], polys: shape, normal: [0, 0, 1] });
  }
  if (rl.index > 0) {
    // Slab edge band where this floor meets the outside, and the underside of any overhang.
    const below = res.levels[rl.index - 1];
    for (const e of polyEdges(rl.footprint)) {
      faces.push(frameFace('slab_edge', 'siding', `${rl.level.id}:slab`, rl.index, e, [[[[e.a, rl.elevation - FLOOR_STRUCTURE], [e.b, rl.elevation - FLOOR_STRUCTURE], [e.b, rl.elevation], [e.a, rl.elevation]]]]));
    }
    const over = difference(rl.footprint, below.footprint);
    if (over.length && multiArea(over) > 0.5) faces.push({ tag: 'slab_bottom', mat: 'trim', owner: `${rl.level.id}:slab`, level: rl.index, origin: [0, 0, rl.elevation - FLOOR_STRUCTURE], u: [1, 0, 0], v: [0, 1, 0], polys: over, normal: [0, 0, -1] });
  }
  return faces;
}

function ceilingFaces(res: Resolved, rl: ResolvedLevel, p: Project): Face3[] {
  const faces: Face3[] = [];
  const above = res.levels[rl.index + 1];
  if (rl.level.kind === 'loft') return faces;
  const z = rl.elevation + rl.level.ceiling;
  for (const info of rl.rooms.values()) {
    const r = info.room;
    if (!isEnclosed(r.type)) continue;
    let shape: MultiPoly = [[roomRing(r)]];
    if (above) {
      // Under the next floor: a flat ceiling (minus stair openings into the floor above).
      const holes = stairHoleMulti(above);
      if (holes.length) shape = difference(shape, holes);
      const covered = intersection(shape, above.footprint);
      const uncovered = difference(shape, above.footprint);
      if (covered.length) faces.push({ tag: 'ceiling', mat: 'ceiling', owner: r.id, level: rl.index, origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], polys: covered, normal: [0, 0, -1] });
      shape = uncovered;
    }
    if (!shape.length || r.ceiling === 'vaulted') continue;
    // Under the roof: flat ceiling only where the roof is high enough above it.
    if (above?.level.kind === 'loft') continue;
    const roofFaces = res.roof.faces.filter((f) => f.level === rl.roofLevel);
    const ok: MultiPoly[] = [];
    for (const f of roofFaces) {
      const region = clipAbove(f, z + res.roof.thickness);
      if (!region.length) continue;
      const part = intersection(shape, region);
      if (part.length) ok.push(part);
    }
    const flat = union(...ok);
    if (flat.length) faces.push({ tag: 'ceiling', mat: 'ceiling', owner: r.id, level: rl.index, origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], polys: flat, normal: [0, 0, -1] });
  }
  void p;
  return faces;
}

/** The part of a roof face's visible region that is at least `z` high. */
function clipAbove(f: RoofFace, z: number): MultiPoly {
  const { a, b, c } = f.plane;
  const parts: MultiPoly = [];
  for (const poly of f.visible) {
    // a*x + b*y + c - z >= 0
    const r = clipHalf(poly[0], a, b, c - z);
    if (r.length >= 3) parts.push([r, ...poly.slice(1)]);
  }
  return parts.length ? union(parts) : [];
}

function clipHalf(ring: Ring, a: number, b: number, c: number): Ring {
  const out: Ring = [];
  const f = (q: [number, number]) => a * q[0] + b * q[1] + c;
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % ring.length];
    const f0 = f(p0);
    const f1 = f(p1);
    if (f0 >= 0) out.push(p0);
    if ((f0 >= 0) !== (f1 >= 0)) {
      const t = f0 / (f0 - f1);
      out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
    }
  }
  return out;
}

function foundationFaces(res: Resolved, p: Project): Face3[] {
  const L1 = res.levels[0];
  if (!L1) return [];
  const mat = p.style.foundation === 'stone_plinth' ? 'stone' : 'foundation';
  return polyEdges(L1.footprint).map((e) => frameFace('foundation', mat, 'foundation', 0, e, [[[[e.a, 0], [e.b, 0], [e.b, L1.elevation], [e.a, L1.elevation]]]]));
}

// --- roof ---------------------------------------------------------------------------------------

function roofFaces(res: Resolved, p: Project): Face3[] {
  const faces: Face3[] = [];
  const t = res.roof.thickness;
  void p;
  for (const f of res.roof.faces) {
    const { a, b, c } = f.plane;
    // Frame lifted onto the plane, oriented so t runs up the slope (shingle courses follow the eaves).
    const swap = Math.abs(a) > Math.abs(b);
    const polys = swap ? f.visible.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x] as [number, number]))) : f.visible;
    const u: V3 = swap ? [0, 1, b] : [1, 0, a];
    const v: V3 = swap ? [1, 0, a] : [0, 1, b];
    faces.push({ tag: 'roof', mat: 'roof', owner: f.id, level: f.level, origin: [0, 0, c], u, v, polys, normal: normalize([-a, -b, 1]) });
    faces.push({ tag: 'roof_under', mat: 'soffit', owner: f.id, level: f.level, origin: [0, 0, c - t], u, v, polys, normal: normalize([a, b, -1]) });
    // Fascia along every outline edge (hidden ones sit inside neighboring roof volume).
    for (const poly of f.visible)
      for (const ring of poly) {
        const ccwRing = ringArea(ring) > 0;
        for (let i = 0; i < ring.length; i++) {
          const p0 = ring[i];
          const p1 = ring[(i + 1) % ring.length];
          const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          if (len < 1e-4) continue;
          const z0 = planeZ(f.plane, p0[0], p0[1]);
          const z1 = planeZ(f.plane, p1[0], p1[1]);
          const dx = (p1[0] - p0[0]) / len;
          const dy = (p1[1] - p0[1]) / len;
          // Outward normal on plan: right of travel for CCW rings.
          const n: V3 = ccwRing ? [dy, -dx, 0] : [-dy, dx, 0];
          faces.push({ tag: 'fascia', mat: 'trim', owner: f.id, level: f.level, origin: [p0[0], p0[1], 0], u: [dx, dy, 0], v: [0, 0, 1], polys: [[[[0, z0 - t], [len, z1 - t], [len, z1], [0, z0]]]], normal: n });
        }
      }
  }
  return faces;
}

const normalize = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const _test = { polyEdges, topProfile };
