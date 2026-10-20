import type { V3 } from '@/core/geometry/faces';
import type { ResolvedOpening } from '@/core/geometry/openings';
import { pointInMulti, roomRing } from '@/core/geometry/polygon';
import { porchFrame } from '@/core/geometry/porch';
import { MULLION } from '@/core/catalog/openings';
import type { Project } from '@/core/model/schema';
import { isDoorType, isOutdoor } from '@/core/model/schema';
import type { Resolved, ResolvedLevel } from '@/core/resolve';
import { addFurniture } from './furniture';
import { BoxBatch, type MeshGroup } from './geometry';

/**
 * Windows, doors, stairs, porch posts and railings, built from boxes. Each box is placed in plan
 * coordinates via a local frame along its wall: u (along the wall), n (through the wall), z (up).
 */

interface Frame {
  axis: 'x' | 'y';
  coord: number;
  z0: number;
}

const at = (f: Frame, u: number, n: number, z: number): V3 => (f.axis === 'x' ? [u, f.coord + n, f.z0 + z] : [f.coord + n, u, f.z0 + z]);
const size = (f: Frame, du: number, dn: number, dz: number): V3 => (f.axis === 'x' ? [du, dn, dz] : [dn, du, dz]);

export interface PartsOptions {
  /** Show doors swung open (walk mode). */
  doorsOpen?: boolean;
  cutLevel?: number;
  cutHeight?: number;
}

export function buildParts(res: Resolved, opts: PartsOptions = {}): MeshGroup[] {
  const batch = new BoxBatch();
  const p = res.project;
  for (const rl of res.levels) {
    if (opts.cutLevel !== undefined && rl.index > opts.cutLevel) break;
    const cut = opts.cutLevel === rl.index ? opts.cutHeight : undefined;
    for (const o of rl.openings) {
      if (o.type === 'open') continue;
      if (cut !== undefined && o.sill >= cut) continue;
      if (isDoorType(o.type)) door(batch, o, rl, p, opts.doorsOpen ?? false, cut);
      else if (o.type === 'cased_opening') casing(batch, o, rl, 'both', cut);
      else windowUnit(batch, o, rl, p, cut);
    }
    for (const s of rl.stairs) {
      for (const step of s.steps) {
        const h = step.top;
        if (cut !== undefined && h > cut + 2) continue;
        const b = step.box;
        batch.add('stair', s.id, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, rl.elevation + h / 2], [b.x1 - b.x0, b.y1 - b.y0, h]);
      }
      for (const l of s.landings) {
        const b = l.box;
        batch.add('stair', s.id, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, rl.elevation + l.z / 2], [b.x1 - b.x0, b.y1 - b.y0, l.z]);
      }
    }
    railings(batch, rl, cut);
    porchPosts(batch, rl, res, cut);
    addFurniture(batch, rl.fixtures, cut === undefined ? undefined : rl.elevation + cut);
  }
  return batch.build();
}

function frameOf(o: ResolvedOpening, rl: ResolvedLevel): Frame {
  return { axis: o.axis, coord: o.wall.coord, z0: rl.elevation };
}

/** Sign (+1/-1 along the wall normal axis) that points outside, or toward the host room for interior walls. */
function outSign(o: ResolvedOpening): 1 | -1 {
  if (o.wall.kind === 'exterior') return o.wall.outside === 0 ? 1 : o.wall.outside;
  return (-o.hostSign) as 1 | -1;
}

function casing(batch: BoxBatch, o: ResolvedOpening, rl: ResolvedLevel, faces: 'both' | 'out' | 'in', cut?: number, matOut = 'trim', matIn = 'trim_int') {
  const f = frameOf(o, rl);
  const top = cut ?? Infinity;
  const t = o.wall.thickness;
  const w = 0.3;
  const d = 0.05;
  const sgn = outSign(o);
  const sides: [number, string][] = [];
  if (faces !== 'in') sides.push([sgn, o.exterior ? matOut : matIn]);
  if (faces !== 'out') sides.push([-sgn, matIn]);
  for (const [sd, mat] of sides) {
    const n = sd * (t / 2 + d / 2);
    const head = o.exterior && sd === sgn ? 0.45 : w;
    const z0 = o.sill > 0.05 ? o.sill - 0.08 : 0;
    const z1 = Math.min(o.head + head, top);
    if (z1 > z0) {
      batch.add(mat, o.id, at(f, o.u0 - w / 2, n, (z0 + z1) / 2), size(f, w, d, z1 - z0));
      batch.add(mat, o.id, at(f, o.u1 + w / 2, n, (z0 + z1) / 2), size(f, w, d, z1 - z0));
    }
    if (o.head + head <= top) batch.add(mat, o.id, at(f, (o.u0 + o.u1) / 2, n, o.head + head / 2), size(f, o.u1 - o.u0 + 2 * w + 0.1, d * 1.6, head));
    if (o.sill > 0.05) batch.add(mat, o.id, at(f, (o.u0 + o.u1) / 2, sd * (t / 2 + 0.08), o.sill - 0.08), size(f, o.u1 - o.u0 + 2 * w, 0.22, 0.16));
  }
}

function windowUnit(batch: BoxBatch, o: ResolvedOpening, rl: ResolvedLevel, p: Project, cut?: number) {
  const f = frameOf(o, rl);
  const t = o.wall.thickness;
  const sgn = outSign(o);
  const n0 = sgn * (t / 2 - 0.2); // set the unit toward the outside face
  const fw = 0.14;
  const depth = 0.28;
  const head = cut !== undefined ? Math.min(o.head, cut) : o.head;
  const h = head - o.sill;
  const style = p.style.windows;
  for (let k = 0; k < o.count; k++) {
    const u0 = o.u0 + k * (o.unitWidth + MULLION);
    const u1 = u0 + o.unitWidth;
    const uc = (u0 + u1) / 2;
    const w = u1 - u0;
    batch.add('window_frame', o.id, at(f, u0 + fw / 2, n0, o.sill + h / 2), size(f, fw, depth, h));
    batch.add('window_frame', o.id, at(f, u1 - fw / 2, n0, o.sill + h / 2), size(f, fw, depth, h));
    if (head === o.head) batch.add('window_frame', o.id, at(f, uc, n0, head - fw / 2), size(f, w, depth, fw));
    batch.add('window_frame', o.id, at(f, uc, n0, o.sill + fw / 2), size(f, w, depth, fw));
    batch.add('glass', o.id, at(f, uc, n0, o.sill + h / 2), size(f, w - fw * 2, 0.04, h - fw * 2));
    if (o.type === 'transom' || o.type === 'picture_window') continue;
    if (style === 'double_hung' && head === o.head) {
      batch.add('window_frame', o.id, at(f, uc, n0 + sgn * 0.04, o.sill + h / 2), size(f, w - fw, depth * 0.6, 0.12));
    } else if (style === 'casement' && w > 2.6) {
      batch.add('window_frame', o.id, at(f, uc, n0, o.sill + h / 2), size(f, 0.12, depth, h));
    }
    if (head === o.head) grilles(batch, o, f, n0 + sgn * 0.03, u0 + fw, u1 - fw, o.sill + fw, head - fw, p.style.grilles, style);
    if (k < o.count - 1) batch.add('window_frame', o.id, at(f, u1 + MULLION / 2, n0, o.sill + h / 2), size(f, MULLION, depth, h));
  }
  casing(batch, o, rl, 'both', cut);
}

function grilles(batch: BoxBatch, o: ResolvedOpening, f: Frame, n: number, u0: number, u1: number, z0: number, z1: number, kind: Project['style']['grilles'], style: Project['style']['windows']) {
  if (kind === 'none') return;
  const bar = 0.05;
  const mid = (z0 + z1) / 2;
  const sashes: [number, number][] = style === 'double_hung' ? (kind === 'cottage' ? [[mid, z1]] : [[z0, mid], [mid, z1]]) : [[z0, z1]];
  for (const [a, b] of sashes) {
    if (kind === 'prairie') {
      const i = 0.35;
      batch.add('window_frame', o.id, at(f, (u0 + u1) / 2, n, b - i), size(f, u1 - u0, 0.04, bar));
      if (style !== 'double_hung') batch.add('window_frame', o.id, at(f, (u0 + u1) / 2, n, a + i), size(f, u1 - u0, 0.04, bar));
      batch.add('window_frame', o.id, at(f, u0 + i, n, (a + b) / 2), size(f, bar, 0.04, b - a));
      batch.add('window_frame', o.id, at(f, u1 - i, n, (a + b) / 2), size(f, bar, 0.04, b - a));
      continue;
    }
    const cols = Math.max(2, Math.round((u1 - u0) / 1.0));
    const rows = Math.max(2, Math.round((b - a) / 1.1));
    for (let c = 1; c < cols; c++) batch.add('window_frame', o.id, at(f, u0 + ((u1 - u0) * c) / cols, n, (a + b) / 2), size(f, bar, 0.04, b - a));
    for (let r = 1; r < rows; r++) batch.add('window_frame', o.id, at(f, (u0 + u1) / 2, n, a + ((b - a) * r) / rows), size(f, u1 - u0, 0.04, bar));
  }
}

function door(batch: BoxBatch, o: ResolvedOpening, rl: ResolvedLevel, p: Project, open: boolean, cut?: number) {
  const f = frameOf(o, rl);
  const t = o.wall.thickness;
  const sgn = outSign(o);
  const leafT = 0.15;
  const ext = o.exterior;
  const leafMat = ext ? 'door' : 'door_int';
  const h = Math.min(o.head, cut ?? Infinity) - o.sill;
  const w = o.u1 - o.u0;
  const uc = (o.u0 + o.u1) / 2;
  const full = h >= o.head - o.sill - 1e-6;
  // Jambs
  batch.add('trim_int', o.id, at(f, o.u0 + 0.06, 0, h / 2), size(f, 0.12, t, h));
  batch.add('trim_int', o.id, at(f, o.u1 - 0.06, 0, h / 2), size(f, 0.12, t, h));
  if (full) batch.add('trim_int', o.id, at(f, uc, 0, h - 0.06), size(f, w, t, 0.12));
  const nLeaf = ext ? -sgn * (t / 2 - leafT / 2 - 0.05) : 0;
  const glassy = o.type === 'french_door' || o.type === 'slider';
  if (o.type === 'garage_door') {
    batch.add('door', o.id, at(f, uc, sgn * (t / 2 - 0.15), h / 2), size(f, w - 0.1, 0.12, h - 0.05));
    for (let i = 1; i < 4; i++) if ((o.head * i) / 4 < h) batch.add('trim', o.id, at(f, uc, sgn * (t / 2 - 0.08), (o.head * i) / 4), size(f, w - 0.2, 0.04, 0.06));
    casing(batch, o, rl, 'out', cut);
    return;
  }
  const leaves = o.type === 'double_door' || o.type === 'french_door' || o.type === 'slider' ? 2 : 1;
  const lw = (w - 0.24) / leaves;
  for (let k = 0; k < leaves; k++) {
    const lu0 = o.u0 + 0.12 + k * lw;
    const luc = lu0 + lw / 2;
    if (open && !glassy && o.type !== 'pocket_door') {
      // Swing the leaf 90° into the room it opens toward, hinged at the jamb.
      const hingeU = leaves === 2 ? (k === 0 ? o.u0 + 0.12 : o.u1 - 0.12) : o.hinge === 'u0' ? o.u0 + 0.12 : o.u1 - 0.12;
      const swing = o.swingTo;
      const nCenter = swing * (t / 2 + lw / 2);
      batch.add(leafMat, o.id, at(f, hingeU + (hingeU < uc ? leafT / 2 : -leafT / 2), nCenter, h / 2 - 0.03), size(f, leafT, lw, h - 0.1));
      continue;
    }
    if (o.type === 'pocket_door' && open) continue;
    if (glassy) {
      batch.add('window_frame', o.id, at(f, luc, nLeaf + (o.type === 'slider' ? (k === 0 ? 0.08 : -0.08) * sgn : 0), h / 2 - 0.03), size(f, lw, leafT, h - 0.1));
      batch.add('glass', o.id, at(f, luc, nLeaf + sgn * 0.09, h / 2), size(f, lw - 0.5, 0.03, h - 0.7));
    } else {
      batch.add(leafMat, o.id, at(f, luc, nLeaf, h / 2 - 0.03), size(f, lw, leafT, h - 0.1));
      // Raised panels, and a small lite on exterior doors.
      for (const sd of [1, -1]) {
        if (ext && p.style.windows !== 'modern' && full) {
          batch.add('glass', o.id, at(f, luc, nLeaf + sd * 0.08, h * 0.72), size(f, lw * 0.55, 0.02, h * 0.3));
        }
        if (full) batch.add(leafMat, o.id, at(f, luc, nLeaf + sd * 0.085, h * 0.28), size(f, lw * 0.6, 0.02, h * 0.3));
      }
      batch.add('metal', o.id, at(f, k === 0 ? lu0 + lw - 0.25 : lu0 + 0.25, nLeaf + sgn * 0.12, 3.1), size(f, 0.1, 0.12, 0.1));
      batch.add('metal', o.id, at(f, k === 0 ? lu0 + lw - 0.25 : lu0 + 0.25, nLeaf - sgn * 0.12, 3.1), size(f, 0.1, 0.12, 0.1));
    }
  }
  casing(batch, o, rl, 'both', cut);
}

function railings(batch: BoxBatch, rl: ResolvedLevel, cut?: number) {
  for (const w of rl.walls) {
    if (w.kind !== 'railing') continue;
    const f: Frame = { axis: w.axis, coord: w.coord, z0: rl.elevation - (w.pos && w.neg ? 0 : 0.33) };
    const top = cut !== undefined ? Math.min(3, cut) : 3;
    const len = w.b - w.a;
    batch.add('trim', w.id, at(f, (w.a + w.b) / 2, 0, top - 0.1), size(f, len, 0.3, 0.2));
    batch.add('trim', w.id, at(f, (w.a + w.b) / 2, 0, 0.35), size(f, len, 0.2, 0.15));
    const n = Math.max(1, Math.round(len / 0.4));
    for (let i = 1; i < n; i++) batch.add('trim', w.id, at(f, w.a + (len * i) / n, 0, (top - 0.2 + 0.35) / 2), size(f, 0.1, 0.1, top - 0.45));
  }
}

function porchPosts(batch: BoxBatch, rl: ResolvedLevel, res: Resolved, cut?: number) {
  void res;
  for (const { owner, posts, beams } of porchFrame(rl, cut))
    for (const b of [...posts, ...beams]) batch.add('trim', owner, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2], [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0]);
}

function pointInRing([px, py]: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
