import type { Roof, RoofForm, Side } from '../../model/schema';
import {
  type Box,
  type MultiPoly,
  type Ring,
  boxD,
  boxMulti,
  boxRing,
  boxW,
  boxesOverlap,
  clipHalfPlane,
  decomposeRects,
  difference,
  intersection,
  multiArea,
  multiBox,
  pointInMulti,
  ringArea,
  union,
} from '../polygon';

/**
 * Roofs as an analytic envelope.
 *
 * A roof is a set of masses. Each mass covers a plan region and carries a few planes; the mass
 * surface is the LOWEST of its planes (that is what makes ridges and hips). Across masses on the
 * same level, the HIGHEST surface wins (that is what makes valleys where wings meet). Visible faces
 * come from 2D polygon clipping, so ridges, hips, valleys and eaves are exact for drawings too.
 */

/** z = a*x + b*y + c */
export interface Plane {
  a: number;
  b: number;
  c: number;
}
export const planeZ = (p: Plane, x: number, y: number) => p.a * x + p.b * y + p.c;

export type MassKind = 'main' | 'wing' | 'lower' | 'porch';

export interface RoofMass {
  id: string;
  level: number;
  kind: MassKind;
  form: RoofForm;
  /** Bounding box of the wall lines it covers. */
  box: Box;
  /** Roofed extent including overhangs and extensions into a parent. */
  ext: MultiPoly;
  planes: Plane[];
  plate: number;
  ridge: 'x' | 'y' | null;
}

export interface RoofFace {
  id: string;
  mass: string;
  level: number;
  kind: MassKind;
  plane: Plane;
  /** The face's region within its mass before other masses hide parts of it. */
  full: MultiPoly;
  /** What is actually visible on top. */
  visible: MultiPoly;
  /** Unit vector pointing downhill on plan, or [0,0] for flat faces. */
  down: [number, number];
}

export interface RoofLevelInput {
  index: number;
  /** Outside-face footprint of the enclosed part of the level. */
  footprint: MultiPoly;
  /** Outside-face footprint of the level above (null at the top). */
  upper: MultiPoly | null;
  /** Elevation of the next floor up (to keep lower roofs below upper windows). */
  upperFloor: number | null;
  /** Height where the roof bears on the walls. */
  plate: number;
  /** Covered outdoor rooms at this level. */
  porches: { id: string; box: Box; floor: number }[];
}

export interface RoofResult {
  masses: RoofMass[];
  faces: RoofFace[];
  /** Vertical thickness of the roof build-up (for clipping walls under it). */
  thickness: number;
}

export const ROOF_THICKNESS = 0.6;
export const PORCH_BEAM = 8;
const MIN_PITCH = 1.5 / 12;

export function buildRoof(levels: RoofLevelInput[], roof: Roof, front: Side): RoofResult {
  const masses: RoofMass[] = [];
  let mid = 0;
  const nextId = () => `M${++mid}`;

  for (const L of levels) {
    const region = L.upper ? difference(L.footprint, L.upper) : L.footprint;
    const rects = decomposeRects(region, 0.5).filter((b) => boxW(b) >= 1 && boxD(b) >= 1);
    const isTop = !L.upper;
    const levelMasses: RoofMass[] = [];
    rects.forEach((b, i) => {
      const parent = i === 0 ? null : findParent(b, levelMasses);
      if (isTop && i === 0) levelMasses.push(mainMass(nextId(), L, b, roof, front));
      else if (isTop && parent) levelMasses.push(wingMass(nextId(), L, b, parent, roof));
      else levelMasses.push(lowerMass(nextId(), L, b, region, roof));
    });
    masses.push(...levelMasses);
    for (const comp of components(L.porches)) masses.push(...porchMasses(nextId, L, comp, roof, levelMasses));
  }

  return { masses, faces: envelope(masses, levels), thickness: ROOF_THICKNESS };
}

// --- helpers ------------------------------------------------------------------------------------

const slope = (pitch: number) => pitch / 12;
const ALL: Side[] = ['N', 'E', 'S', 'W'];
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const longSides = (axis: 'x' | 'y'): Side[] => (axis === 'x' ? ['S', 'N'] : ['W', 'E']);
const endSides = (axis: 'x' | 'y'): Side[] => (axis === 'x' ? ['W', 'E'] : ['S', 'N']);

/** Plane rising inward at slope s from the line on side `side` of b, at height z0 on that line. */
function eavePlane(b: Box, side: Side, s: number, z0: number): Plane {
  switch (side) {
    case 'S':
      return { a: 0, b: s, c: z0 - s * b.y0 };
    case 'N':
      return { a: 0, b: -s, c: z0 + s * b.y1 };
    case 'W':
      return { a: s, b: 0, c: z0 - s * b.x0 };
    case 'E':
      return { a: -s, b: 0, c: z0 + s * b.x1 };
  }
}

/** Plane rising inward from an arbitrary axis-aligned line. */
function linePlane(axis: 'x' | 'y', coord: number, inward: 1 | -1, s: number, z0: number): Plane {
  // axis 'x': horizontal line y = coord; inward +1 means toward +y.
  return axis === 'x' ? { a: 0, b: s * inward, c: z0 - s * inward * coord } : { a: s * inward, b: 0, c: z0 - s * inward * coord };
}

function extend(b: Box, by: Partial<Record<Side, number>>): Box {
  return { x0: b.x0 - (by.W ?? 0), x1: b.x1 + (by.E ?? 0), y0: b.y0 - (by.S ?? 0), y1: b.y1 + (by.N ?? 0) };
}
const extendM = (b: Box, by: Partial<Record<Side, number>>): MultiPoly => boxMulti(extend(b, by));

function formPlanes(form: RoofForm, b: Box, axis: 'x' | 'y', s: number, plate: number, planeSides: Side[]): Plane[] {
  const has = (sd: Side) => planeSides.includes(sd);
  if (form === 'flat') return [{ a: 0, b: 0, c: plate + 0.4 }];
  if (form === 'shed') return planeSides.map((sd) => eavePlane(b, sd, s, plate));
  const planes: Plane[] = [];
  if (form === 'gambrel') {
    const depth = axis === 'x' ? boxD(b) : boxW(b);
    const steep = Math.max(1.6, s * 2.4);
    const shallow = Math.max(s * 0.6, 0.35);
    const d0 = depth * 0.2;
    for (const sd of longSides(axis)) {
      if (!has(sd)) continue;
      planes.push(eavePlane(b, sd, steep, plate));
      planes.push(eavePlane(b, sd, shallow, plate + (steep - shallow) * d0));
    }
    return planes;
  }
  for (const sd of longSides(axis)) if (has(sd)) planes.push(eavePlane(b, sd, s, plate));
  if (form === 'hip') for (const sd of endSides(axis)) if (has(sd)) planes.push(eavePlane(b, sd, s, plate));
  return planes;
}

function mainMass(id: string, L: RoofLevelInput, b: Box, roof: Roof, front: Side): RoofMass {
  let axis: 'x' | 'y' = boxW(b) >= boxD(b) ? 'x' : 'y';
  const frontAxis: 'x' | 'y' = front === 'N' || front === 'S' ? 'x' : 'y';
  if (roof.ridge === 'parallel_to_front') axis = frontAxis;
  if (roof.ridge === 'perpendicular_to_front') axis = frontAxis === 'x' ? 'y' : 'x';
  const form = roof.form;
  const s = slope(roof.pitch);
  const ov = roof.overhang;
  let planeSides: Side[] = [...ALL];
  const by: Partial<Record<Side, number>> = {};
  if (form === 'shed') {
    const low = roof.low ?? (axis === 'x' ? (front === 'N' ? 'N' : 'S') : front === 'E' ? 'E' : 'W');
    planeSides = [low];
    by[low] = ov;
    by[OPP[low]] = ov * 0.6;
    for (const e of ALL) if (e !== low && e !== OPP[low]) by[e] = roof.rake;
  } else if (form === 'flat') {
    for (const e of ALL) by[e] = Math.min(ov, 1.5);
  } else {
    for (const sd of longSides(axis)) by[sd] = ov;
    for (const sd of endSides(axis)) by[sd] = form === 'hip' ? ov : roof.rake;
  }
  return { id, level: L.index, kind: 'main', form, box: b, ext: extendM(b, by), planes: formPlanes(form, b, axis, s, L.plate, planeSides), plate: L.plate, ridge: form === 'flat' || form === 'shed' ? null : axis };
}

interface Attach {
  parent: RoofMass;
  /** Side of the child box that touches the parent. */
  side: Side;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function findParent(b: Box, masses: RoofMass[]): Attach | null {
  let best: Attach | null = null;
  let bestLen = 0.5;
  for (const m of masses) {
    const p = m.box;
    const tries: [Side, number][] = [
      ['N', Math.abs(b.y1 - p.y0) < 1e-6 ? overlap(b.x0, b.x1, p.x0, p.x1) : 0],
      ['S', Math.abs(b.y0 - p.y1) < 1e-6 ? overlap(b.x0, b.x1, p.x0, p.x1) : 0],
      ['E', Math.abs(b.x1 - p.x0) < 1e-6 ? overlap(b.y0, b.y1, p.y0, p.y1) : 0],
      ['W', Math.abs(b.x0 - p.x1) < 1e-6 ? overlap(b.y0, b.y1, p.y0, p.y1) : 0],
    ];
    for (const [side, len] of tries)
      if (len > bestLen) {
        bestLen = len;
        best = { parent: m, side };
      }
  }
  return best;
}

function wingMass(id: string, L: RoofLevelInput, b: Box, at: Attach, roof: Roof): RoofMass {
  const P = at.parent;
  const s = slope(roof.pitch);
  const form: RoofForm = roof.wings === 'match' ? P.form : roof.wings;
  const ov = roof.overhang;

  if (form === 'flat') {
    const by: Partial<Record<Side, number>> = {};
    for (const sd of ALL) if (sd !== at.side) by[sd] = Math.min(ov, 1.5);
    return { id, level: L.index, kind: 'wing', form, box: b, ext: extendM(b, by), planes: [{ a: 0, b: 0, c: L.plate + 0.4 }], plate: L.plate, ridge: null };
  }

  // Cross wing: ridge perpendicular to the attaching side, as long as it stays below the parent ridge.
  const cross: 'x' | 'y' = at.side === 'N' || at.side === 'S' ? 'y' : 'x';
  const width = cross === 'y' ? boxW(b) : boxD(b);
  const parentSpan = P.ridge === 'x' ? boxD(P.box) : P.ridge === 'y' ? boxW(P.box) : Math.min(boxW(P.box), boxD(P.box));
  const crossOk = form !== 'shed' && width < parentSpan - 0.8;

  if (crossOk) {
    const by: Partial<Record<Side, number>> = {};
    for (const sd of longSides(cross)) by[sd] = ov;
    by[OPP[at.side]] = form === 'hip' ? ov : roof.rake;
    // Run into the parent up to its ridge line (or middle) so the planes meet in clean valleys.
    const mid = (axis: 'x' | 'y') => (axis === 'x' ? (P.box.y0 + P.box.y1) / 2 : (P.box.x0 + P.box.x1) / 2);
    const into =
      at.side === 'N' ? mid('x') - b.y1 : at.side === 'S' ? b.y0 - mid('x') : at.side === 'E' ? mid('y') - b.x1 : b.x0 - mid('y');
    by[at.side] = Math.max(0, into);
    const planeSides = form === 'hip' ? ALL.filter((x) => x !== at.side) : longSides(cross);
    return { id, level: L.index, kind: 'wing', form, box: b, ext: extendM(b, by), planes: formPlanes(form, b, cross, s, L.plate, planeSides), plate: L.plate, ridge: cross };
  }

  // Wide, shallow wing: its own roof with the ridge parallel to the parent wall.
  const axis: 'x' | 'y' = cross === 'x' ? 'y' : 'x';
  const by: Partial<Record<Side, number>> = {};
  for (const sd of longSides(axis)) by[sd] = sd === at.side ? 0 : ov;
  for (const sd of endSides(axis)) by[sd] = form === 'hip' ? ov : roof.rake;
  const planeSides = form === 'shed' ? [OPP[at.side]] : form === 'hip' ? ALL : longSides(axis);
  return { id, level: L.index, kind: 'wing', form, box: b, ext: extendM(b, by), planes: formPlanes(form, b, axis, s, L.plate, planeSides), plate: L.plate, ridge: form === 'shed' ? null : axis };
}

/** Which sides of box b touch a region (sampled just outside each side). */
function touching(b: Box, region: MultiPoly | null): Side[] {
  if (!region || !region.length) return [];
  const out: Side[] = [];
  const e = 0.05;
  for (const sd of ALL) {
    let hits = 0;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = sd === 'E' ? b.x1 + e : sd === 'W' ? b.x0 - e : b.x0 + (b.x1 - b.x0) * t;
      const y = sd === 'N' ? b.y1 + e : sd === 'S' ? b.y0 - e : b.y0 + (b.y1 - b.y0) * t;
      if (pointInMulti([x, y], region)) hits++;
    }
    if (hits >= 3) out.push(sd);
  }
  return out;
}

function lowerMass(id: string, L: RoofLevelInput, b: Box, region: MultiPoly, roof: Roof): RoofMass {
  const butt = touching(b, L.upper);
  const internal = touching(b, difference(region, boxMulti(b))).filter((s) => !butt.includes(s));
  const free = ALL.filter((s) => !butt.includes(s) && !internal.includes(s));
  const s0 = slope(roof.pitch);
  const ov = roof.overhang;

  if (roof.form === 'flat') {
    const by: Partial<Record<Side, number>> = {};
    for (const sd of free) by[sd] = Math.min(ov, 1.5);
    return { id, level: L.index, kind: 'lower', form: 'flat', box: b, ext: extendM(b, by), planes: [{ a: 0, b: 0, c: L.plate + 0.4 }], plate: L.plate, ridge: null };
  }

  if (butt.length === 1) {
    const bs = butt[0];
    const depth = bs === 'N' || bs === 'S' ? boxD(b) : boxW(b);
    const along = bs === 'N' || bs === 'S' ? boxW(b) : boxD(b);
    const want = roof.lower === 'auto' ? (depth >= 10 && along <= depth * 2.2 ? 'gable' : 'shed') : roof.lower;
    if (want === 'gable' || want === 'hip') {
      const axis: 'x' | 'y' = bs === 'N' || bs === 'S' ? 'y' : 'x';
      const by: Partial<Record<Side, number>> = {};
      for (const sd of longSides(axis)) by[sd] = free.includes(sd) ? ov : 0;
      for (const sd of endSides(axis)) by[sd] = sd === bs ? 0 : free.includes(sd) ? (want === 'hip' ? ov : roof.rake) : 0;
      const planeSides = want === 'hip' ? ALL.filter((x) => x !== bs && free.includes(x)) : longSides(axis).filter((x) => free.includes(x));
      return { id, level: L.index, kind: 'lower', form: want, box: b, ext: extendM(b, by), planes: formPlanes(want, b, axis, s0, L.plate, planeSides), plate: L.plate, ridge: axis };
    }
    // Shed sloping away from the upper wall, kept below the upper floor's windows.
    const low = OPP[bs];
    const cap = L.upperFloor !== null ? L.upperFloor + 2 : Infinity;
    const s = Math.max(MIN_PITCH, Math.min(s0, 4 / 12, (cap - L.plate) / Math.max(depth, 1)));
    const by: Partial<Record<Side, number>> = { [low]: ov };
    for (const sd of ALL) if (sd !== low && sd !== bs && free.includes(sd)) by[sd] = roof.rake;
    return { id, level: L.index, kind: 'lower', form: 'shed', box: b, ext: extendM(b, by), planes: [eavePlane(b, low, s, L.plate)], plate: L.plate, ridge: null };
  }

  // Corners or detached pieces: planes on every free side (a hipped lean-to).
  const by: Partial<Record<Side, number>> = {};
  for (const sd of free) by[sd] = ov;
  const s = butt.length ? Math.min(s0, 4 / 12) : s0;
  const planes = free.map((sd) => eavePlane(b, sd, s, L.plate));
  return { id, level: L.index, kind: 'lower', form: butt.length ? 'shed' : 'hip', box: b, ext: extendM(b, by), planes: planes.length ? planes : [{ a: 0, b: 0, c: L.plate + 0.4 }], plate: L.plate, ridge: null };
}

// --- porches ------------------------------------------------------------------------------------

type PorchIn = RoofLevelInput['porches'][number];

/** Group porch rectangles that touch into connected components (a wraparound is one porch). */
function components(porches: PorchIn[]): PorchIn[][] {
  const out: PorchIn[][] = [];
  const seen = new Set<number>();
  const touches = (a: Box, b: Box) =>
    (Math.abs(a.x1 - b.x0) < 1e-6 || Math.abs(b.x1 - a.x0) < 1e-6 ? overlap(a.y0, a.y1, b.y0, b.y1) > 0.1 : false) ||
    (Math.abs(a.y1 - b.y0) < 1e-6 || Math.abs(b.y1 - a.y0) < 1e-6 ? overlap(a.x0, a.x1, b.x0, b.x1) > 0.1 : false) ||
    boxesOverlap(a, b);
  porches.forEach((p, i) => {
    if (seen.has(i)) return;
    const comp: PorchIn[] = [];
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(porches[k]);
      porches.forEach((q, j) => {
        if (!seen.has(j) && touches(porches[k].box, q.box)) {
          seen.add(j);
          stack.push(j);
        }
      });
    }
    out.push(comp);
  });
  return out;
}

interface OutlineEdge {
  axis: 'x' | 'y';
  coord: number;
  a: number;
  b: number;
  /** +1 if the region lies on the + side of the line. */
  inward: 1 | -1;
  side: Side;
}

function outlineEdges(region: MultiPoly): OutlineEdge[] {
  const out: OutlineEdge[] = [];
  for (const poly of region)
    for (const ring of poly) {
      const ccwRing = ringArea(ring) > 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        // Interior is on the left of travel for CCW rings, right for CW (holes).
        const left = ccwRing ? 1 : -1;
        if (Math.abs(y1 - y2) < 1e-9 && Math.abs(x1 - x2) > 1e-9) {
          const inward = ((x2 > x1 ? 1 : -1) * left) as 1 | -1;
          out.push({ axis: 'x', coord: y1, a: Math.min(x1, x2), b: Math.max(x1, x2), inward, side: inward === 1 ? 'S' : 'N' });
        } else if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) > 1e-9) {
          const inward = ((y2 > y1 ? -1 : 1) * left) as 1 | -1;
          out.push({ axis: 'y', coord: x1, a: Math.min(y1, y2), b: Math.max(y1, y2), inward, side: inward === 1 ? 'W' : 'E' });
        }
      }
    }
  return out;
}

function edgeTouches(e: OutlineEdge, region: MultiPoly): boolean {
  let hits = 0;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = e.a + ((i + 0.5) / n) * (e.b - e.a);
    const off = -e.inward * 0.05;
    const pt: [number, number] = e.axis === 'x' ? [t, e.coord + off] : [e.coord + off, t];
    if (pointInMulti(pt, region)) hits++;
  }
  return hits > n / 2;
}

/** Overhang strip outside an edge; ends extend only where they meet another overhanging edge. */
function edgeStrip(e: OutlineEdge, by: number, endBy: number, others: OutlineEdge[] = []): MultiPoly {
  const o = -e.inward * by;
  const lo = Math.min(e.coord, e.coord + o);
  const hi = Math.max(e.coord, e.coord + o);
  const endPt = (u: number): [number, number] => (e.axis === 'x' ? [u, e.coord] : [e.coord, u]);
  const meets = (u: number) =>
    others.some((f) => {
      if (f === e || f.axis === e.axis) return false;
      const [px, py] = endPt(u);
      const fp0: [number, number] = f.axis === 'x' ? [f.a, f.coord] : [f.coord, f.a];
      const fp1: [number, number] = f.axis === 'x' ? [f.b, f.coord] : [f.coord, f.b];
      return (Math.abs(fp0[0] - px) < 1e-6 && Math.abs(fp0[1] - py) < 1e-6) || (Math.abs(fp1[0] - px) < 1e-6 && Math.abs(fp1[1] - py) < 1e-6);
    });
  const ea = !others.length || meets(e.a) ? endBy : 0;
  const eb = !others.length || meets(e.b) ? endBy : 0;
  return e.axis === 'x' ? boxMulti({ x0: e.a - ea, x1: e.b + eb, y0: lo, y1: hi }) : boxMulti({ y0: e.a - ea, y1: e.b + eb, x0: lo, x1: hi });
}

function porchMasses(nextId: () => string, L: RoofLevelInput, comp: PorchIn[], roof: Roof, houseMasses: RoofMass[]): RoofMass[] {
  const region = union(...comp.map((p) => boxMulti(p.box)));
  const box = multiBox(region);
  const floor = Math.min(...comp.map((p) => p.floor));
  const beam = floor + PORCH_BEAM;
  const ov = Math.min(roof.overhang, 1);
  const edges = outlineEdges(region);
  const house = L.footprint;
  const butt = edges.filter((e) => edgeTouches(e, house));
  const free = edges.filter((e) => !butt.includes(e));
  const single = comp.length === 1;

  if (roof.porch === 'flat' || !butt.length) {
    if (!butt.length && roof.porch !== 'flat') {
      // A free-standing pavilion: a simple hip.
      const s = slope(Math.max(roof.porchPitch, 6));
      const planes = free.map((e) => linePlane(e.axis, e.coord, e.inward, s, beam));
      return [{ id: nextId(), level: L.index, kind: 'porch', form: 'hip', box, ext: union(region, ...free.map((e) => edgeStrip(e, ov, ov, free))), planes, plate: beam, ridge: null }];
    }
    return [{ id: nextId(), level: L.index, kind: 'porch', form: 'flat', box, ext: union(region, ...free.map((e) => edgeStrip(e, ov, ov, free))), planes: [{ a: 0, b: 0, c: beam + 0.5 }], plate: beam, ridge: null }];
  }

  // The main slope runs away from the longest house wall.
  const mainButt = butt.reduce((p, q) => (q.b - q.a > p.b - p.a ? q : p));
  const depthOf = (e: OutlineEdge) => (e.axis === 'x' ? boxD(box) : boxW(box));
  const depth = single ? depthOf(mainButt) : Math.min(...comp.map((p) => Math.min(boxW(p.box), boxD(p.box))));

  const houseMass = houseMasses.find((m) => m.kind === 'main' || m.kind === 'wing' ? boxesOverlap(m.box, { x0: box.x0 - 0.5, x1: box.x1 + 0.5, y0: box.y0 - 0.5, y1: box.y1 + 0.5 }) : false);
  const eaveSide = !!houseMass && houseMass.ridge !== null && houseMass.ridge === mainButt.axis;
  const oneStory = !L.upper || !edgeTouches(mainButt, L.upper);
  const catslide = single && eaveSide && oneStory;

  let s = slope(roof.porchPitch);
  if (!catslide) {
    const cap = L.upper ? (L.upperFloor ?? Infinity) + 1.5 : (houseMass?.plate ?? beam + 3) - 0.35;
    s = Math.max(MIN_PITCH, Math.min(s, (cap - beam) / Math.max(depth, 1)));
  }

  // Which free edges get a sloped plane?
  let planeEdges: OutlineEdge[];
  if (single && roof.porch === 'gable') planeEdges = free.filter((e) => e.axis !== mainButt.axis);
  else if (single && roof.porch === 'shed') planeEdges = free.filter((e) => e.axis === mainButt.axis);
  else planeEdges = free; // hip, and every wraparound
  if (!planeEdges.length) planeEdges = free;
  const planes = planeEdges.map((e) => linePlane(e.axis, e.coord, e.inward, single && roof.porch === 'gable' ? slope(Math.max(roof.porchPitch, 8)) : s, beam));

  const strips: MultiPoly[] = free.map((e) => edgeStrip(e, planeEdges.includes(e) || !single ? ov : roof.rake, ov, free));
  let ext = union(region, ...strips);
  if (catslide && houseMass) {
    // Carry the porch slope into the house up to the main ridge, where it meets the main roof.
    const hb = houseMass.box;
    const mid = mainButt.axis === 'x' ? (hb.y0 + hb.y1) / 2 : (hb.x0 + hb.x1) / 2;
    // Span the porch roof's full width, overhangs included, so its ends line up with the main rakes.
    const eb = multiBox(ext);
    const ext2 =
      mainButt.axis === 'x'
        ? boxMulti({ x0: eb.x0, x1: eb.x1, y0: Math.min(mainButt.coord, mid), y1: Math.max(mainButt.coord, mid) })
        : boxMulti({ y0: eb.y0, y1: eb.y1, x0: Math.min(mainButt.coord, mid), x1: Math.max(mainButt.coord, mid) });
    ext = union(ext, ext2);
  }
  return [{ id: nextId(), level: L.index, kind: 'porch', form: single && roof.porch === 'gable' ? 'gable' : 'shed', box, ext, planes, plate: beam, ridge: single && roof.porch === 'gable' ? (mainButt.axis === 'x' ? 'y' : 'x') : null }];
}

// --- envelope -----------------------------------------------------------------------------------

/** Region of a mass where plane i is the lowest (the mass surface is the min of its planes). */
function faceRegion(m: RoofMass, i: number): MultiPoly {
  const bb = multiBox(m.ext);
  let ring: Ring = boxRing({ x0: bb.x0 - 1, y0: bb.y0 - 1, x1: bb.x1 + 1, y1: bb.y1 + 1 });
  const p = m.planes[i];
  for (let j = 0; j < m.planes.length && ring.length >= 3; j++) {
    if (j === i) continue;
    const q = m.planes[j];
    // Keep where q >= p. Ties go to the lower index so faces never overlap.
    ring = clipHalfPlane(ring, q.a - p.a, q.b - p.b, q.c - p.c + (j < i ? -1e-7 : 1e-7));
  }
  if (ring.length < 3) return [];
  return intersection(m.ext, [[ring]]);
}

function envelope(masses: RoofMass[], levels: RoofLevelInput[]): RoofFace[] {
  const raw: RoofFace[] = [];
  let fid = 0;
  for (const m of masses) {
    m.planes.forEach((p, i) => {
      const full = faceRegion(m, i);
      if (!full.length || multiArea(full) < 1e-3) return;
      const len = Math.hypot(p.a, p.b);
      raw.push({ id: `${m.id}.${++fid}`, mass: m.id, level: m.level, kind: m.kind, plane: p, full, visible: [], down: len > 1e-9 ? [-p.a / len, -p.b / len] : [0, 0] });
    });
  }

  const byLevel = new Map<number, RoofLevelInput>(levels.map((l) => [l.index, l]));
  for (const r of raw) {
    let vis: MultiPoly = r.full;
    const p = r.plane;
    const rb = multiBox(r.full);
    for (const o of raw) {
      if (o === r || o.mass === r.mass || o.level !== r.level) continue;
      if (!boxesOverlap(rb, multiBox(o.full))) continue;
      const q = o.plane;
      // Where o is higher than r, o hides r. Coplanar overlaps: the earlier mass wins.
      const tie = Math.abs(q.a - p.a) < 1e-9 && Math.abs(q.b - p.b) < 1e-9 && Math.abs(q.c - p.c) < 1e-6;
      if (tie && o.mass > r.mass) continue;
      for (const poly of o.full) {
        const hi = clipHalfPlane(poly[0], q.a - p.a, q.b - p.b, q.c - p.c - (tie ? -1 : 1e-6));
        if (hi.length < 3 || Math.abs(ringArea(hi)) < 1e-5) continue;
        vis = difference(vis, [[hi]]);
        if (!vis.length) break;
      }
      if (!vis.length) break;
    }
    const lvl = byLevel.get(r.level);
    if (vis.length && lvl?.upper) vis = difference(vis, lvl.upper);
    r.visible = vis.filter((poly) => multiArea([poly]) > 1e-3);
  }
  return raw.filter((f) => f.visible.length);
}

/** Height of the visible roof surface at (x, y) for a level, or null when nothing covers it. */
export function roofZAt(faces: RoofFace[], level: number, x: number, y: number): number | null {
  let z: number | null = null;
  for (const f of faces) {
    if (f.level !== level) continue;
    if (!f.visible.some((p) => pointInRingLoose([x, y], p[0]) && !p.slice(1).some((h) => pointInRingStrict([x, y], h)))) continue;
    const h = planeZ(f.plane, x, y);
    if (z === null || h > z) z = h;
  }
  return z;
}

function pointInRingStrict([px, py]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inclusive of edges (within 1e-6), so wall lines on face borders still find a roof. */
function pointInRingLoose(pt: [number, number], ring: Ring): boolean {
  const [px, py] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const len = Math.hypot(xj - xi, yj - yi);
    if (len < 1e-12) continue;
    const cross = Math.abs((xj - xi) * (py - yi) - (yj - yi) * (px - xi)) / len;
    if (cross < 1e-6 && px >= Math.min(xi, xj) - 1e-6 && px <= Math.max(xi, xj) + 1e-6 && py >= Math.min(yi, yj) - 1e-6 && py <= Math.max(yi, yj) + 1e-6) return true;
  }
  return pointInRingStrict(pt, ring);
}

/** The highest roof point. */
export function roofPeak(r: RoofResult): number {
  let z = 0;
  for (const f of r.faces) for (const p of f.visible) for (const [x, y] of p[0]) z = Math.max(z, planeZ(f.plane, x, y));
  return z;
}
