import type { Rect, RoomType } from '../../model/schema';
import { snap } from '../../model/units';
import type { Box } from '../../geometry/polygon';

export const DEFAULT_AREA: Record<RoomType, number> = {
  living: 260,
  family: 240,
  great_room: 380,
  dining: 150,
  kitchen: 180,
  pantry: 30,
  bedroom: 140,
  primary_bedroom: 220,
  nursery: 110,
  bath: 55,
  half_bath: 25,
  closet: 18,
  walk_in_closet: 50,
  hall: 60,
  foyer: 70,
  stair_hall: 110,
  laundry: 50,
  mudroom: 60,
  office: 120,
  library: 160,
  studio: 200,
  loft: 200,
  bonus: 250,
  gym: 180,
  media: 220,
  garage: 480,
  workshop: 240,
  mechanical: 40,
  storage: 40,
  sunroom: 160,
  porch: 200,
  screened_porch: 200,
  deck: 200,
  patio: 200,
  balcony: 60,
  open_to_below: 120,
};

export const MIN_WIDTH: Partial<Record<RoomType, number>> = {
  bedroom: 10.5,
  primary_bedroom: 12.5,
  nursery: 9.5,
  bath: 5.5,
  half_bath: 4.5,
  closet: 3.5,
  walk_in_closet: 5,
  hall: 3.5,
  living: 12,
  family: 12,
  great_room: 14,
  dining: 10,
  kitchen: 9,
  garage: 11,
  office: 8,
  laundry: 5.5,
  pantry: 4,
};

export const HALL_W = 3.5;

export interface PackRoom {
  id?: string;
  name: string;
  type: RoomType;
  area?: number;
}

export interface Placed<T extends PackRoom = PackRoom> {
  spec: T;
  rect: Rect;
}

const WET: ReadonlySet<RoomType> = new Set(['bath', 'half_bath', 'laundry', 'closet', 'walk_in_closet', 'pantry', 'mechanical', 'storage']);

/** Lay rooms side by side along an axis, widths proportional to area, filling the box. */
export function row<T extends PackRoom>(box: Box, rooms: T[], axis: 'x' | 'y'): Placed<T>[] {
  if (!rooms.length) return [];
  const len = axis === 'x' ? box.x1 - box.x0 : box.y1 - box.y0;
  const depth = axis === 'x' ? box.y1 - box.y0 : box.x1 - box.x0;
  const mins = rooms.map((r) => Math.min(MIN_WIDTH[r.type] ?? 3, len / rooms.length));
  const want = rooms.map((r, i) => Math.max((r.area ?? DEFAULT_AREA[r.type]) / Math.max(depth, 1), mins[i]));
  // Scale to fit, but never squeeze a room below its minimum width.
  const widths = [...want];
  const pinned = new Set<number>();
  for (let pass = 0; pass < rooms.length; pass++) {
    const fixedLen = [...pinned].reduce((s, i) => s + mins[i], 0);
    const freeWant = widths.reduce((s, w, i) => (pinned.has(i) ? s : s + want[i]), 0);
    const scale = (len - fixedLen) / Math.max(freeWant, 1e-6);
    let changed = false;
    rooms.forEach((_, i) => {
      if (pinned.has(i)) return (widths[i] = mins[i]);
      widths[i] = want[i] * scale;
      if (widths[i] < mins[i] - 1e-6) {
        pinned.add(i);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const out: Placed<T>[] = [];
  let cursor = axis === 'x' ? box.x0 : box.y0;
  rooms.forEach((r, i) => {
    const end = i === rooms.length - 1 ? (axis === 'x' ? box.x1 : box.y1) : snap(cursor + widths[i]);
    const rect: Rect = axis === 'x' ? [cursor, box.y0, end - cursor, box.y1 - box.y0] : [box.x0, cursor, box.x1 - box.x0, end - cursor];
    out.push({ spec: r, rect });
    cursor = end;
  });
  return out.filter((p) => p.rect[2] >= 1 && p.rect[3] >= 1);
}

/** Order a strip so wet/small rooms sit in the middle and the big rooms take the corners. */
function stripOrder<T extends PackRoom>(rooms: T[]): T[] {
  const big = rooms.filter((r) => !WET.has(r.type)).sort((a, b) => (b.area ?? DEFAULT_AREA[b.type]) - (a.area ?? DEFAULT_AREA[a.type]));
  const small = rooms.filter((r) => WET.has(r.type));
  if (big.length <= 1) return [...big, ...small];
  return [big[0], ...big.slice(2), ...small, big[1]];
}

export interface CorridorOptions {
  /** Axis the hall runs along. Default: the long axis of the box. */
  axis?: 'x' | 'y';
  /** A cross-axis coordinate the hall must include (e.g. the stair landing). */
  through?: number;
  mode?: 'auto' | 'yes' | 'no';
  /** Hall width (wider where it carries a stair landing). */
  width?: number;
}

/**
 * Pack rooms into a box along a hall: double-loaded when deep enough, single-loaded when not,
 * and just a row when there's no room (or no need) for a hall.
 */
export function packAlongHall<T extends PackRoom>(box: Box, rooms: T[], opts: CorridorOptions = {}): { placed: Placed<T>[]; hall: Rect | null } {
  const w = box.x1 - box.x0;
  const d = box.y1 - box.y0;
  const axis = opts.axis ?? (w >= d ? 'x' : 'y');
  const depth = axis === 'x' ? d : w;
  const lo = axis === 'x' ? box.y0 : box.x0;
  const hi = axis === 'x' ? box.y1 : box.x1;
  const needHall = opts.mode === 'yes' || (opts.mode !== 'no' && rooms.length >= 3);
  const HW = opts.width ?? HALL_W;
  if (!needHall || depth < 8 + HW) return { placed: row(box, rooms, axis), hall: null };

  const sub = (a: number, b: number): Box => (axis === 'x' ? { x0: box.x0, x1: box.x1, y0: a, y1: b } : { x0: a, x1: b, y0: box.y0, y1: box.y1 });
  const hallRect = (a: number): Rect => (axis === 'x' ? [box.x0, a, w, HW] : [a, box.y0, HW, d]);

  if (depth >= 2 * 9 + HW) {
    // Double-loaded: hall roughly in the middle, nudged to pass through the required point.
    let h0 = snap(lo + (depth - HW) / 2);
    if (opts.through !== undefined && (opts.through < h0 + 1 || opts.through > h0 + HW - 1)) {
      h0 = snap(Math.min(Math.max(lo + 9, opts.through - HW / 2), hi - 9 - HW));
    }
    const sideA = sub(lo, h0);
    const sideB = sub(h0 + HW, hi);
    // Balance the two strips by area.
    const capA = (h0 - lo) / (depth - HW);
    const sorted = [...rooms].sort((a, b) => (b.area ?? DEFAULT_AREA[b.type]) - (a.area ?? DEFAULT_AREA[a.type]));
    const A: T[] = [];
    const B: T[] = [];
    let aa = 0;
    let bb = 0;
    for (const r of sorted) {
      const ar = r.area ?? DEFAULT_AREA[r.type];
      if (aa / capA <= bb / (1 - capA)) {
        A.push(r);
        aa += ar;
      } else {
        B.push(r);
        bb += ar;
      }
    }
    return { placed: [...row(sideA, stripOrder(A), axis), ...row(sideB, stripOrder(B), axis)], hall: hallRect(h0) };
  }
  // Single-loaded: hall along the side nearest the required point (or the low side).
  const hallLow = opts.through === undefined ? false : opts.through - lo < hi - opts.through;
  const h0 = hallLow ? lo : hi - HW;
  const strip = hallLow ? sub(lo + HW, hi) : sub(lo, hi - HW);
  return { placed: row(strip, stripOrder(rooms), axis), hall: hallRect(h0) };
}

/** Size a box for a set of rooms: about `depth` deep, long enough for their area. */
export function boxFor(rooms: PackRoom[], depth: number, extra = 0): { len: number; depth: number } {
  const area = rooms.reduce((s, r) => s + (r.area ?? DEFAULT_AREA[r.type]), 0) + extra;
  return { len: snap(Math.max(area / depth, 8)), depth };
}
