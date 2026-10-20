import type { Level, Pt, Rect, Room } from '../model/schema';
import { snap } from '../model/units';
import { type Box, type MultiPoly, type Ring, boxMulti, ccw, cleanRing, difference, intersection, multiArea, polyArea, rectToBox, ringArea, ringBox, roomRing, union } from '../geometry/polygon';

export class OpError extends Error {}

export const roomMulti = (r: Room): MultiPoly => {
  const ring = roomRing(r);
  return ring.length >= 3 ? [[ring]] : [];
};

export const roomBox = (r: Room): Box => ringBox(roomRing(r));

/** Set a room's shape from a region. Keeps the largest piece; returns what was left over. */
export function setRoomShape(room: Room, region: MultiPoly): MultiPoly {
  const pieces = region.filter((p) => polyArea(p) > 0.5).sort((a, b) => polyArea(b) - polyArea(a));
  if (!pieces.length) {
    room.rect = [0, 0, 0, 0];
    delete room.poly;
    return [];
  }
  const main = pieces[0];
  const ring = cleanRing(ccw(main[0])).map(([x, y]) => [snap(x), snap(y)] as Pt);
  const clean = cleanRing(ring);
  const b = ringBox(clean);
  const isRect = clean.length === 4 && Math.abs(Math.abs(ringArea(clean)) - (b.x1 - b.x0) * (b.y1 - b.y0)) < 1e-6;
  if (isRect) {
    room.rect = [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
    delete room.poly;
  } else {
    room.poly = clean;
    delete room.rect;
  }
  return pieces.slice(1);
}

export const rectOk = (r: Rect) => r[2] >= 1 && r[3] >= 1;
export const snapRect = (r: Rect): Rect => {
  const x0 = snap(r[0]);
  const y0 = snap(r[1]);
  return [x0, y0, snap(r[0] + r[2]) - x0, snap(r[1] + r[3]) - y0];
};

export const roomArea = (r: Room) => Math.abs(ringArea(roomRing(r)));

/** Rooms on the level overlapping a region by more than a sliver. */
export function overlapping(level: Level, region: MultiPoly, except: string[] = []): { room: Room; area: number }[] {
  const out: { room: Room; area: number }[] = [];
  for (const r of level.rooms) {
    if (except.includes(r.id)) continue;
    const a = multiArea(intersection(roomMulti(r), region));
    if (a > 0.05) out.push({ room: r, area: a });
  }
  return out;
}

/** Subtract a region from every other room on the level; returns rooms that vanished. */
export function carve(level: Level, region: MultiPoly, except: string[] = []): { shrunk: string[]; removed: string[] } {
  const shrunk: string[] = [];
  const removed: string[] = [];
  for (const { room } of overlapping(level, region, except)) {
    const left = difference(roomMulti(room), region);
    if (multiArea(left) < 4) {
      removed.push(room.id);
      continue;
    }
    setRoomShape(room, left);
    shrunk.push(room.id);
  }
  if (removed.length) level.rooms = level.rooms.filter((r) => !removed.includes(r.id));
  return { shrunk, removed };
}

/** Length of the boundary two rooms share. */
export function sharedLength(a: Room, b: Room): number {
  const ra = roomRing(a);
  const rb = roomRing(b);
  let len = 0;
  for (let i = 0; i < ra.length; i++) {
    const p1 = ra[i];
    const p2 = ra[(i + 1) % ra.length];
    for (let j = 0; j < rb.length; j++) {
      const q1 = rb[j];
      const q2 = rb[(j + 1) % rb.length];
      len += collinearOverlap(p1, p2, q1, q2);
    }
  }
  return len;
}

function collinearOverlap(p1: Pt, p2: Pt, q1: Pt, q2: Pt): number {
  const horiz = Math.abs(p1[1] - p2[1]) < 1e-9 && Math.abs(q1[1] - q2[1]) < 1e-9 && Math.abs(p1[1] - q1[1]) < 1e-6;
  const vert = Math.abs(p1[0] - p2[0]) < 1e-9 && Math.abs(q1[0] - q2[0]) < 1e-9 && Math.abs(p1[0] - q1[0]) < 1e-6;
  if (horiz) return Math.max(0, Math.min(Math.max(p1[0], p2[0]), Math.max(q1[0], q2[0])) - Math.max(Math.min(p1[0], p2[0]), Math.min(q1[0], q2[0])));
  if (vert) return Math.max(0, Math.min(Math.max(p1[1], p2[1]), Math.max(q1[1], q2[1])) - Math.max(Math.min(p1[1], p2[1]), Math.min(q1[1], q2[1])));
  return 0;
}

export function neighbors(level: Level, room: Room): { room: Room; shared: number }[] {
  return level.rooms
    .filter((r) => r !== room)
    .map((r) => ({ room: r, shared: sharedLength(room, r) }))
    .filter((n) => n.shared > 0.5)
    .sort((a, b) => b.shared - a.shared);
}

/** Union of enclosed (and void) rooms at centerlines. */
export function levelFootprint(level: Level, pred: (r: Room) => boolean = () => true): MultiPoly {
  return union(...level.rooms.filter(pred).map(roomMulti));
}

export function shiftCoord(c: number, at: number, by: number, dir: 1 | -1): number {
  if (dir === 1) {
    if (by >= 0) return c >= at - 1e-9 ? c + by : c;
    return c >= at - 1e-9 ? c + by : c > at + by ? at + by : c;
  }
  // dir -1: coordinates at or below `at` move down by `by`
  if (by >= 0) return c <= at + 1e-9 ? c - by : c;
  return c <= at + 1e-9 ? c - by : c < at - by ? at - by : c;
}

/**
 * Stretch levels along an axis: everything at/beyond `at` (dir +1) or at/before it (dir -1)
 * moves by `by`. Rooms crossing the line get longer (or shorter). Returns rooms that collapsed.
 */
export function stretchLevels(levels: Level[], axis: 'x' | 'y', at: number, by: number, dir: 1 | -1 = 1): string[] {
  const collapsed: string[] = [];
  const k = axis === 'x' ? 0 : 1;
  for (const level of levels) {
    for (const r of level.rooms) {
      if (r.rect) {
        const b = rectToBox(r.rect);
        const lo = shiftCoord(axis === 'x' ? b.x0 : b.y0, at, by, dir);
        const hi = shiftCoord(axis === 'x' ? b.x1 : b.y1, at, by, dir);
        if (axis === 'x') r.rect = [lo, b.y0, hi - lo, b.y1 - b.y0];
        else r.rect = [b.x0, lo, b.x1 - b.x0, hi - lo];
      } else if (r.poly) {
        r.poly = r.poly.map((p) => {
          const q: Pt = [p[0], p[1]];
          q[k] = shiftCoord(p[k], at, by, dir);
          return q;
        });
        const ring = cleanRing(r.poly as Ring);
        if (ring.length < 4 || Math.abs(ringArea(ring)) < 1) collapsed.push(r.id);
        else r.poly = ring;
      }
      if (r.rect && (r.rect[2] < 0.5 || r.rect[3] < 0.5)) collapsed.push(r.id);
    }
    for (const f of level.fixtures) if (f.at) f.at[k] = shiftCoord(f.at[k], at, by, dir);
    for (const s of level.stairs) if (s.at) s.at[k] = shiftCoord(s.at[k], at, by, dir);
    level.rooms = level.rooms.filter((r) => !collapsed.includes(r.id));
  }
  return collapsed;
}

export const boxRect = (b: Box): Rect => [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
export { boxMulti, difference, intersection, union, multiArea };
