import type { Level, Room, RoomType, Style } from '../model/schema';
import { isEnclosed, isOutdoor, isVoid, PRIVATE_TYPES } from '../model/schema';
import { type Box, type MultiPoly, type Ring, boxMulti, difference, pointInMulti, roomRing, union } from './polygon';

/**
 * A line on the plan: axis 'x' = horizontal line (y = coord) running along x;
 * axis 'y' = vertical line (x = coord) running along y.
 * 'pos' is the room on the north (x lines) or east (y lines) side, 'neg' the other.
 */
export interface BoundarySpan {
  axis: 'x' | 'y';
  coord: number;
  a: number;
  b: number;
  pos: string | null;
  neg: string | null;
}

export type WallKind = 'exterior' | 'interior' | 'railing' | 'none';

export interface WallSeg extends BoundarySpan {
  id: string;
  kind: WallKind;
  thickness: number;
  /** For exterior walls: +1 if the outside is on the pos side, -1 if on the neg side. */
  outside: 1 | -1 | 0;
}

export interface BoundaryIssue {
  kind: 'overlap';
  rooms: [string, string];
  at: { axis: 'x' | 'y'; coord: number; a: number; b: number };
}

const K = (v: number) => Math.round(v * 1000) / 1000;

const EXTERIOR_THICKNESS: Record<Style['wall'], number> = {
  lap_siding: 0.55,
  board_and_batten: 0.55,
  shingle: 0.55,
  vertical_wood: 0.55,
  panel: 0.55,
  stucco: 0.6,
  log: 0.8,
  brick: 0.9,
  stone: 1.0,
};
export const INTERIOR_THICKNESS = 0.375;
export const RAILING_THICKNESS = 0.15;
export const exteriorThickness = (style: Pick<Style, 'wall'>) => EXTERIOR_THICKNESS[style.wall] ?? 0.55;

/** Exact boundary labeling of a level's rooms (no rasterizing). */
export function labelBoundaries(rooms: Room[]): { spans: BoundarySpan[]; issues: BoundaryIssue[] } {
  type E = { axis: 'x' | 'y'; coord: number; a: number; b: number; room: string; side: 1 | -1 };
  const groups = new Map<string, E[]>();
  for (const room of rooms) {
    const ring = roomRing(room);
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      let e: E | null = null;
      // Counter-clockwise ring: the interior is on the left of travel.
      if (Math.abs(y1 - y2) < 1e-9 && Math.abs(x1 - x2) > 1e-9)
        e = { axis: 'x', coord: y1, a: Math.min(x1, x2), b: Math.max(x1, x2), room: room.id, side: x2 > x1 ? 1 : -1 };
      else if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) > 1e-9)
        e = { axis: 'y', coord: x1, a: Math.min(y1, y2), b: Math.max(y1, y2), room: room.id, side: y2 > y1 ? -1 : 1 };
      if (!e) continue;
      const key = `${e.axis}:${K(e.coord)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  }

  const spans: BoundarySpan[] = [];
  const issues: BoundaryIssue[] = [];
  for (const edges of groups.values()) {
    const { axis, coord } = edges[0];
    const cuts = [...new Set(edges.flatMap((e) => [K(e.a), K(e.b)]))].sort((p, q) => p - q);
    let prev: BoundarySpan | null = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const mid = (a + b) / 2;
      let pos: string | null = null;
      let neg: string | null = null;
      for (const e of edges) {
        if (e.a > mid || e.b < mid) continue;
        if (e.side === 1) {
          if (pos && pos !== e.room) issues.push({ kind: 'overlap', rooms: [pos, e.room], at: { axis, coord, a, b } });
          pos = e.room;
        } else {
          if (neg && neg !== e.room) issues.push({ kind: 'overlap', rooms: [neg, e.room], at: { axis, coord, a, b } });
          neg = e.room;
        }
      }
      if (!pos && !neg) {
        prev = null;
        continue;
      }
      if (prev && prev.pos === pos && prev.neg === neg && Math.abs(prev.b - a) < 1e-6) {
        prev.b = b;
      } else {
        prev = { axis, coord, a, b, pos, neg };
        spans.push(prev);
      }
    }
  }
  spans.sort((s, t) => (s.axis === t.axis ? s.coord - t.coord || s.a - t.a : s.axis < t.axis ? -1 : 1));
  return { spans, issues };
}

export interface WallContext {
  level: Level;
  levelIndex: number;
  /** Floor height above grade (for railings on elevated porches). */
  floorAboveGrade: number;
  style: Pick<Style, 'wall'>;
  /** For loft levels: the footprint of the level below (edges inside it become railings). */
  loftOver?: MultiPoly;
}

/** Rooms explicitly joined by an 'open' opening lose the wall between them. */
function openPairs(level: Level): Set<string> {
  const s = new Set<string>();
  for (const o of level.openings) if (o.type === 'open' && o.to && o.to !== 'outside') s.add(pairKey(o.room, o.to));
  return s;
}
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function classify(span: BoundarySpan, ctx: WallContext, rooms: Map<string, Room>, open: Set<string>): { kind: WallKind; outside: 1 | -1 | 0 } {
  const P = span.pos ? rooms.get(span.pos) : undefined;
  const N = span.neg ? rooms.get(span.neg) : undefined;
  const cat = (r?: Room) => (!r ? 'outside' : isVoid(r.type) ? 'void' : isOutdoor(r.type) ? 'outdoor' : 'enclosed');
  const cp = cat(P);
  const cn = cat(N);
  const elevated = ctx.floorAboveGrade > 2.5;
  const linked = P && N && open.has(pairKey(P.id, N.id));

  const pair = (x: string, y: string) => (cp === x && cn === y) || (cp === y && cn === x);
  // Which side is the "outside" for an exterior-type wall: the side that is not enclosed.
  const outSide = (): 1 | -1 => (cp === 'enclosed' || (cp === 'void' && cn !== 'enclosed') ? -1 : 1);

  if (pair('enclosed', 'outside') || pair('enclosed', 'outdoor') || pair('void', 'outside') || pair('void', 'outdoor'))
    return { kind: 'exterior', outside: outSide() };
  if (cp === 'enclosed' && cn === 'enclosed') return { kind: linked ? 'none' : 'interior', outside: 0 };
  if (pair('enclosed', 'void')) {
    const enclosed = cp === 'enclosed' ? P! : N!;
    if (linked) return { kind: 'railing', outside: 0 };
    return { kind: PRIVATE_TYPES.has(enclosed.type) ? 'interior' : 'railing', outside: 0 };
  }
  if (pair('outdoor', 'outside')) return { kind: elevated ? 'railing' : 'none', outside: 0 };
  return { kind: 'none', outside: 0 };
}

/** Derive the walls of a level from its rooms. */
export function deriveWalls(ctx: WallContext): { walls: WallSeg[]; issues: BoundaryIssue[] } {
  const { spans, issues } = labelBoundaries(ctx.level.rooms);
  const rooms = new Map(ctx.level.rooms.map((r) => [r.id, r]));
  const open = openPairs(ctx.level);
  const tExt = exteriorThickness(ctx.style);
  const walls: WallSeg[] = spans.map((s) => {
    let { kind, outside } = classify(s, ctx, rooms, open);
    if (ctx.loftOver && kind === 'exterior') {
      // A loft edge only gets a wall where it meets the outside wall below; elsewhere it overlooks the room.
      const mid = (s.a + s.b) / 2;
      const off = outside * 0.6;
      const probe: [number, number] = s.axis === 'x' ? [mid, s.coord + off] : [s.coord + off, mid];
      if (pointInMulti(probe, ctx.loftOver)) {
        kind = 'railing';
        outside = 0;
      }
    }
    const thickness = kind === 'exterior' ? tExt : kind === 'interior' ? INTERIOR_THICKNESS : kind === 'railing' ? RAILING_THICKNESS : 0;
    return { ...s, kind, outside, thickness, id: wallId(ctx.level.id, s) };
  });
  return { walls, issues };
}

export const wallId = (levelId: string, s: Pick<BoundarySpan, 'axis' | 'coord' | 'a' | 'b'>) =>
  `${levelId}:${s.axis === 'x' ? 'y' : 'x'}@${K(s.coord)}:${K(s.a)}-${K(s.b)}`;

const solid = (w: WallSeg) => w.kind === 'exterior' || w.kind === 'interior';

/** How far each end of a wall should extend to close joints with perpendicular walls. */
export function wallExtents(w: WallSeg, walls: WallSeg[]): { a: number; b: number } {
  let ea = 0;
  let eb = 0;
  for (const o of walls) {
    if (o === w || !solid(o) || o.axis === w.axis) continue;
    // o is perpendicular: o runs along the other axis at coordinate o.coord.
    const crossesLine = o.a - 1e-6 <= w.coord && w.coord <= o.b + 1e-6;
    if (!crossesLine) continue;
    if (Math.abs(o.coord - w.a) < 1e-6) ea = Math.max(ea, o.thickness / 2);
    if (Math.abs(o.coord - w.b) < 1e-6) eb = Math.max(eb, o.thickness / 2);
  }
  return { a: ea, b: eb };
}

/** Plan rectangle of a wall, including end extensions. */
export function wallBox(w: WallSeg, ext: { a: number; b: number }): Box {
  const h = w.thickness / 2;
  return w.axis === 'x'
    ? { x0: w.a - ext.a, x1: w.b + ext.b, y0: w.coord - h, y1: w.coord + h }
    : { x0: w.coord - h, x1: w.coord + h, y0: w.a - ext.a, y1: w.b + ext.b };
}

/** Union of all solid walls on a level (used for plan poché, footprints and collisions). */
export function wallUnion(walls: WallSeg[], cut: Box[] = []): MultiPoly {
  const boxes = walls.filter(solid).map((w) => boxMulti(wallBox(w, wallExtents(w, walls))));
  const u = union(...boxes);
  return cut.length ? difference(u, ...cut.map(boxMulti)) : u;
}

/** Outer footprint of the enclosed part of a level (to the outside face of exterior walls). */
export function enclosedFootprint(level: Level, walls: WallSeg[]): MultiPoly {
  const enclosedRooms = level.rooms.filter((r) => isEnclosed(r.type) || isVoid(r.type));
  const ringsM: MultiPoly = enclosedRooms.map((r) => [roomRing(r)] as Ring[]).filter((p) => p[0].length >= 3);
  const ext = walls.filter((w) => w.kind === 'exterior').map((w) => boxMulti(wallBox(w, wallExtents(w, walls))));
  return union(ringsM, ...ext);
}

export function roomsOfType(level: Level, pred: (t: RoomType) => boolean) {
  return level.rooms.filter((r) => pred(r.type));
}
