import { type V3, buildFaces } from '@/core/geometry/faces';
import { type MultiPoly, type Poly, pointInMulti, union } from '@/core/geometry/polygon';
import { planeZ, roofZAt } from '@/core/geometry/roof';
import { wallUnion } from '@/core/geometry/walls';
import { isOutdoor } from '@/core/model/schema';
import { FLOOR_STRUCTURE, type Resolved } from '@/core/resolve';
import { datums } from './elevation';
import { boxSolids, exteriorScene } from './exterior';
import { type Line3, type Solid, type View, hiddenLines } from './hidden';
import { type Drawing, Pad } from './ir';

/**
 * A building section: the plane `axis = at` slices the house, everything it cuts is solid poché
 * (walls, floors, roof, foundations, the stair), and what lies beyond is drawn with hidden lines
 * removed. Rooms the cut passes through are named.
 */
export interface SectionCut {
  /** The plane is x = at (axis 'x') or y = at (axis 'y'). */
  axis: 'x' | 'y';
  at: number;
  /** Looking toward +axis (1) or -axis (-1). */
  look: 1 | -1;
}

export function sectionView(cut: SectionCut): View {
  if (cut.axis === 'x') return cut.look < 0 ? { R: [0, 1, 0], U: [0, 0, 1], D: [-1, 0, 0] } : { R: [0, -1, 0], U: [0, 0, 1], D: [1, 0, 0] };
  return cut.look > 0 ? { R: [1, 0, 0], U: [0, 0, 1], D: [0, 1, 0] } : { R: [-1, 0, 0], U: [0, 0, 1], D: [0, -1, 0] };
}

/**
 * Across the main ridge (so the roof reads in profile), through the stair when there is one. With
 * `cross`, the other way: along the ridge, through the middle of the house.
 */
export function chooseCut(res: Resolved, cross = false): SectionCut {
  const b = res.bounds;
  const main = res.roof.masses.find((m) => m.kind === 'main');
  const across: 'x' | 'y' = main?.ridge ? main.ridge : b.x1 - b.x0 >= b.y1 - b.y0 ? 'x' : 'y';
  const axis: 'x' | 'y' = cross ? (across === 'x' ? 'y' : 'x') : across;
  const lo = axis === 'x' ? b.x0 : b.y0;
  const hi = axis === 'x' ? b.x1 : b.y1;
  const stair = cross ? undefined : res.levels.find((rl) => rl.stairs.length)?.stairs[0];
  const target = stair ? (axis === 'x' ? (stair.footprint.x0 + stair.footprint.x1) / 2 : (stair.footprint.y0 + stair.footprint.y1) / 2) : (lo + hi) / 2;
  // Stay clear of walls lying in the plane and of the edges of openings.
  const clear = (c: number) =>
    res.levels.every(
      (rl) =>
        rl.walls.every((w) => w.axis === axis || w.kind === 'none' || Math.abs(w.coord - c) > w.thickness / 2 + 0.4) &&
        rl.openings.every((o) => o.axis !== axis || (Math.abs(o.u0 - c) > 0.4 && Math.abs(o.u1 - c) > 0.4)),
    );
  let at = target;
  for (let k = 0; k <= 24; k++) {
    const c = target + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
    if (c > lo + 1 && c < hi - 1 && clear(c)) {
      at = c;
      break;
    }
  }
  return { axis, at, look: at - lo > hi - at ? -1 : 1 };
}

export function section(res: Resolved, cut: SectionCut, scale: number): Drawing {
  const view = sectionView(cut);
  const pad = new Pad(scale);
  /** Plan point on the cut line at `s` (the across-coordinate). */
  const plan = (s: number): [number, number] => (cut.axis === 'x' ? [cut.at, s] : [s, cut.at]);
  /** Picture-plane u for an across-coordinate. */
  const U = (s: number) => {
    const [x, y] = plan(s);
    return view.R[0] * x + view.R[1] * y;
  };

  // --- what the plane cuts ----------------------------------------------------------------------
  const solid: MultiPoly[] = [];
  const stairs: MultiPoly[] = [];
  const rect = (s0: number, s1: number, z0: number, z1: number): MultiPoly => {
    const a = U(s0);
    const b = U(s1);
    const [u0, u1] = a < b ? [a, b] : [b, a];
    return z1 - z0 < 1e-4 || u1 - u0 < 1e-4
      ? []
      : [
          [
            [
              [u0, z0],
              [u1, z0],
              [u1, z1],
              [u0, z1],
            ],
          ],
        ];
  };
  for (const rl of res.levels) {
    const above = res.levels[rl.index + 1];
    const covered = (s: number) => !!above && rl.hasFloorAbove && pointInMulti(plan(s), above.footprint);
    // Walls crossing the plane.
    for (const [s0, s1] of crossings(wallUnion(rl.walls), cut)) {
      const mid = (s0 + s1) / 2;
      const [x, y] = plan(mid);
      const w = rl.walls.find((w) => w.axis === cut.axis && Math.abs(w.coord - mid) <= w.thickness / 2 + 0.05 && w.a - 0.6 <= (cut.axis === 'x' ? x : y) && (cut.axis === 'x' ? x : y) <= w.b + 0.6);
      const exterior = w?.kind === 'exterior';
      const rz = roofZAt(res.roof.faces, rl.roofLevel, x, y);
      let top = rl.elevation + rl.level.ceiling;
      if (!covered(mid)) {
        if (rz !== null) top = exterior ? rz - res.roof.thickness : Math.min(Math.max(top, rl.elevation + 1), rz - res.roof.thickness);
        else if (exterior) top = rl.plate;
      }
      const open = rl.openings.find((o) => o.axis === cut.axis && Math.abs(o.wall.coord - mid) < 0.05 && o.u0 < cut.at && cut.at < o.u1 && o.type !== 'open');
      if (open) {
        solid.push(rect(s0, s1, rl.elevation, rl.elevation + open.sill), rect(s0, s1, rl.elevation + open.head, top));
        if (open.sill > 0.05 && !open.type.includes('door')) {
          // Glass in the cut: a thin line down the middle of the wall.
          const m = U(mid);
          pad.seg([m, rl.elevation + open.sill], [m, rl.elevation + open.head], 'medium', 'A-GLAZ');
          pad.seg([U(s0), rl.elevation + open.sill], [U(s1), rl.elevation + open.sill], 'fine', 'A-GLAZ');
        }
      } else solid.push(rect(s0, s1, rl.elevation, top));
      // Foundation walls and footings under the ground floor's outside walls.
      if (rl.index === 0 && exterior) {
        solid.push(rect(s0, s1, -1, rl.elevation - FLOOR_STRUCTURE));
        solid.push(rect(s0 - 0.5, s1 + 0.5, -1.8, -1));
      }
    }
    // Floor structure over the enclosed footprint, open at stair holes.
    const holes = union(...rl.stairHoles.map((s) => [[ringOf(s.footprint)]] as MultiPoly));
    for (const [s0, s1] of crossings(rl.footprint, cut))
      for (const [a, b] of subtract([s0, s1], crossings(holes, cut))) solid.push(rect(a, b, rl.elevation - FLOOR_STRUCTURE, rl.elevation));
    // Porch and deck floors.
    for (const info of rl.rooms.values()) {
      if (!isOutdoor(info.room.type)) continue;
      for (const [s0, s1] of crossings([[ringOf(roomBox(info.room))]], cut)) solid.push(rect(s0, s1, rl.index === 0 ? Math.max(0, rl.elevation - 1.33) : rl.elevation - 1.13, rl.elevation - 0.33));
    }
    // The stair, where the plane runs through it.
    for (const st of rl.stairs) {
      const parts: MultiPoly[] = [];
      for (const step of st.steps) if (spans(step.box, cut)) parts.push(rect(cut.axis === 'x' ? step.box.y0 : step.box.x0, cut.axis === 'x' ? step.box.y1 : step.box.x1, rl.elevation + Math.max(0, step.top - 1.2), rl.elevation + step.top));
      for (const l of st.landings) if (spans(l.box, cut)) parts.push(rect(cut.axis === 'x' ? l.box.y0 : l.box.x0, cut.axis === 'x' ? l.box.y1 : l.box.x1, rl.elevation + Math.max(0, l.z - 1), rl.elevation + l.z));
      if (parts.length) stairs.push(union(...parts));
    }
  }
  // Flat ceilings (already trimmed to where the roof leaves room for them).
  for (const f of buildFaces(res)) {
    if (f.tag !== 'ceiling') continue;
    for (const [s0, s1] of crossings(f.polys, cut)) solid.push(rect(s0, s1, f.origin[2], f.origin[2] + 0.15));
  }
  // The roof planes, as a band as thick as the roof build-up.
  for (const f of res.roof.faces)
    for (const [s0, s1] of crossings(f.visible, cut)) {
      const [x0, y0] = plan(s0);
      const [x1, y1] = plan(s1);
      const z0 = planeZ(f.plane, x0, y0);
      const z1 = planeZ(f.plane, x1, y1);
      const t = res.roof.thickness;
      solid.push([
        [
          orientCCW([
            [U(s0), z0],
            [U(s1), z1],
            [U(s1), z1 - t],
            [U(s0), z0 - t],
          ]),
        ],
      ]);
    }
  // A chimney the plane passes through.
  for (const blk of res.chimney?.blocks ?? []) if (spans(blk.box, cut)) solid.push(rect(cut.axis === 'x' ? blk.box.y0 : blk.box.x0, cut.axis === 'x' ? blk.box.y1 : blk.box.x1, blk.z0, blk.z1));

  const poche = union(...solid);
  const stairCut = union(...stairs);

  // --- what lies beyond -------------------------------------------------------------------------
  const sc = exteriorScene(res, { scale, texture: false, interior: true });
  for (const rl of res.levels)
    for (const st of rl.stairs) {
      for (const step of st.steps) sc.solids.push(...boxSolids({ ...step.box, z0: rl.elevation + Math.max(0, step.top - 1.2), z1: rl.elevation + step.top }, 'white', 'fine', 'A-FLOR-STRS'));
      for (const l of st.landings) sc.solids.push(...boxSolids({ ...l.box, z0: rl.elevation + Math.max(0, l.z - 1), z1: rl.elevation + l.z }, 'white', 'fine', 'A-FLOR-STRS'));
    }
  const D = view.D;
  const cutDepth = cut.look * cut.at;
  const beyond: Solid[] = [];
  for (const s of sc.solids) {
    const rings = s.rings.map((r) => clipRing(r, D, cutDepth)).filter((r) => r.length >= 3);
    if (rings.length && rings[0].length >= 3) beyond.push({ ...s, rings, fill: undefined });
  }
  const lines: Line3[] = [];
  for (const l of sc.lines) {
    const c = clipSeg(l.a, l.b, D, cutDepth);
    if (c) lines.push({ ...l, a: c[0], b: c[1] });
  }
  // The cut itself hides whatever is behind it.
  const onPlane = (u: number, z: number): V3 => {
    const across = view.R[0] !== 0 ? u / view.R[0] : u / view.R[1];
    const [x, y] = plan(across);
    return [x, y, z];
  };
  for (const m of [poche, stairCut]) for (const poly of m) beyond.push({ rings: poly.map((r) => r.map(([u, z]) => onPlane(u, z))), normal: [-D[0], -D[1], -D[2]] });
  const hl = hiddenLines(beyond, lines, view);
  pad.items.push(...hl.lines);

  for (const poly of poche) {
    pad.fill(poly as [number, number][][], 'poche', 'A-SECT-MCUT');
    for (const ring of poly) pad.line(ring as [number, number][], 'cut', 'A-SECT-MCUT', true);
  }
  for (const poly of stairCut) {
    pad.fill(poly as [number, number][][], 'tone', 'A-SECT-MCUT');
    for (const ring of poly) pad.line(ring as [number, number][], 'cut', 'A-SECT-MCUT', true);
  }

  // Grade, labels, datums.
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const it of pad.items)
    if (it.t === 'line')
      for (const [u] of it.pts) {
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
      }
  if (Number.isFinite(u0)) {
    const g0 = u0 - pad.p(0.5);
    const g1 = u1 + pad.p(0.5);
    // Earth under the poché, so footings read in front of it.
    pad.items.unshift({
      t: 'fill',
      rings: [
        [
          [g0, 0],
          [g1, 0],
          [g1, -pad.p(0.07)],
          [g0, -pad.p(0.07)],
        ],
      ],
      tone: 'tone',
      layer: 'A-SITE',
    });
    pad.seg([g0, 0], [g1, 0], 'cut', 'A-SITE');
    datums(pad, res, u1);
  }
  for (const rl of res.levels)
    for (const info of rl.rooms.values()) {
      if (info.room.type === 'open_to_below' || isOutdoor(info.room.type)) continue;
      const i = info.inner;
      const [a, b] = cut.axis === 'x' ? [i.x0, i.x1] : [i.y0, i.y1];
      if (!(a < cut.at && cut.at < b)) continue;
      const [s0, s1] = cut.axis === 'x' ? [i.y0, i.y1] : [i.x0, i.x1];
      if (s1 - s0 < pad.p(0.5)) continue;
      pad.text([U((s0 + s1) / 2), rl.elevation + Math.min(4, rl.level.ceiling / 2)], info.room.name.toUpperCase(), 0.1, 'A-AREA-IDEN', { align: 'center', font: 'serif' });
    }
  return { id: 'section', title: 'Building Section', scale, items: pad.items };
}

// --- helpers ------------------------------------------------------------------------------------

const ringOf = (b: { x0: number; y0: number; x1: number; y1: number }): [number, number][] => [
  [b.x0, b.y0],
  [b.x1, b.y0],
  [b.x1, b.y1],
  [b.x0, b.y1],
];

function roomBox(room: { rect?: [number, number, number, number]; poly?: [number, number][] }) {
  if (room.rect) return { x0: room.rect[0], y0: room.rect[1], x1: room.rect[0] + room.rect[2], y1: room.rect[1] + room.rect[3] };
  const xs = room.poly!.map((p) => p[0]);
  const ys = room.poly!.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const spans = (b: { x0: number; y0: number; x1: number; y1: number }, cut: SectionCut) => (cut.axis === 'x' ? b.x0 < cut.at && cut.at < b.x1 : b.y0 < cut.at && cut.at < b.y1);

/** Intervals (in the across-coordinate) where the cut line runs inside a region. */
export function crossings(m: MultiPoly, cut: SectionCut): [number, number][] {
  const c = cut.axis === 'x' ? 0 : 1; // plan coordinate held at cut.at
  const out: [number, number][] = [];
  for (const poly of m) {
    const xs: number[] = [];
    for (const ring of poly as Poly)
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        if (p[c] <= cut.at !== q[c] <= cut.at) xs.push(p[1 - c] + ((cut.at - p[c]) / (q[c] - p[c])) * (q[1 - c] - p[1 - c]));
      }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-4) out.push([xs[i], xs[i + 1]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function subtract([a, b]: [number, number], cuts: [number, number][]): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) parts = parts.flatMap(([p0, p1]) => (c1 <= p0 || c0 >= p1 ? [[p0, p1]] : ([[p0, c0], [c1, p1]] as [number, number][]).filter(([x, y]) => y - x > 1e-4)));
  return parts;
}

function orientCCW(r: [number, number][]): [number, number][] {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return a >= 0 ? r : [...r].reverse();
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Keep the part of a ring with depth (P·D) at or beyond `d0`. */
function clipRing(ring: V3[], D: V3, d0: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const fp = dot(p, D) - d0;
    const fq = dot(q, D) - d0;
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  return out;
}

function clipSeg(a: V3, b: V3, D: V3, d0: number): [V3, V3] | null {
  const fa = dot(a, D) - d0;
  const fb = dot(b, D) - d0;
  if (fa < 0 && fb < 0) return null;
  if (fa >= 0 && fb >= 0) return [a, b];
  const t = fa / (fa - fb);
  const m: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return fa >= 0 ? [a, m] : [m, b];
}

