import { fixtureSpec } from '../catalog/fixtures';
import { OPPOSITE, ROTATION_BY_FACING, type ResolvedFixture, type SideFrame, footprint, sideFrame } from '../geometry/fixtures';
import type { ResolvedOpening } from '../geometry/openings';
import { type Box, pointInRing, ringEdges } from '../geometry/polygon';
import { wallUnion } from '../geometry/walls';
import type { Fixture, Room, Side } from '../model/schema';
import { isDoorType, isPassable } from '../model/schema';
import type { ResolvedLevel, RoomInfo } from '../resolve';

export const SIDES: Side[] = ['N', 'E', 'S', 'W'];
export type Interval = [number, number];

const round = (v: number) => Math.round(v * 12) / 12;
const overlaps = (a: Box, b: Box, eps = 1e-6) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;

/** Remove [a, b] from a sorted list of intervals. */
export function subtract(list: Interval[], a: number, b: number): Interval[] {
  const out: Interval[] = [];
  for (const [x, y] of list) {
    if (b <= x || a >= y) out.push([x, y]);
    else {
      if (a > x) out.push([x, a]);
      if (b < y) out.push([b, y]);
    }
  }
  return out;
}

export interface Placed {
  box: Box;
  z0: number;
  z1: number;
  /** Set for pieces placed by this pass (pinned ones have none and are never taken back). */
  id?: string;
  floating?: boolean;
}

/** A spot found against a wall: which side, the center along it, and the footprint. */
export interface Slot {
  side: Side;
  u: number;
  box: Box;
}

/**
 * Everything a furniture recipe needs about one room: clear floor, which stretches of each side are
 * real wall, what opens where, what must stay clear, and what is already placed. Recipes call
 * `wall()` and `float()` to place things; the results come out as auto fixtures.
 */
export class RoomCtx {
  readonly room: Room;
  readonly info: RoomInfo;
  readonly rl: ResolvedLevel;
  readonly inner: Box;
  /** Openings in the walls around this room, with the side as seen from this room. */
  readonly openings: (ResolvedOpening & { here: Side })[];
  /** Floor that has to stay clear: in front of doors, around stairs, beside beds. */
  readonly keep: Box[] = [];
  readonly placed: Placed[] = [];
  readonly out: Fixture[] = [];
  private readonly skip: Set<string>;

  constructor(rl: ResolvedLevel, info: RoomInfo, opts: { pinned: ResolvedFixture[]; skip: Set<string> }) {
    this.rl = rl;
    this.info = info;
    this.room = info.room;
    this.inner = info.inner;
    this.skip = opts.skip;
    this.openings = rl.openings
      .filter((o) => o.room === this.room.id || o.other === this.room.id)
      .map((o) => ({ ...o, here: o.room === this.room.id ? o.side : OPPOSITE[o.side] }));
    for (const f of opts.pinned) this.placed.push({ box: f.box, z0: f.z0 - rl.elevation, z1: f.z0 - rl.elevation + f.h });

    // In front of every way in or out: room to step through, and to swing the door.
    for (const o of this.openings) {
      // An open connection is a whole wall's worth of opening, not a doorway to keep clear.
      if (!isPassable(o.type) || o.type === 'garage_door' || o.type === 'open') continue;
      const sf = this.frame(o.here);
      if (!sf) continue;
      // swingTo points at the wall's pos side, which is this room when the wall is its S or W side.
      const roomIsPos = o.here === 'S' || o.here === 'W';
      const swingsHere = isDoorType(o.type) && o.type !== 'slider' && o.type !== 'pocket_door' && (roomIsPos ? o.swingTo === 1 : o.swingTo === -1);
      // Small rooms (baths, closets) are arranged around a door that swings past their fixtures.
      const small = ['bath', 'half_bath', 'closet', 'walk_in_closet', 'pantry', 'laundry'].includes(this.room.type);
      const depth = small ? 2 : Math.max(2.5, swingsHere ? o.unitWidth + 0.25 : 0);
      this.keep.push(this.strip(sf, o.u0 - 0.25, o.u1 + 0.25, 0, depth));
    }
    // Stairs and stair openings, with a landing at each end.
    for (const s of [...rl.stairs.filter((x) => x.room === this.room.id), ...rl.stairHoles]) {
      const f = s.footprint;
      if (!overlaps(f, this.inner)) continue;
      this.keep.push({ x0: f.x0 - 0.4, x1: f.x1 + 0.4, y0: f.y0 - 0.4, y1: f.y1 + 0.4 });
      for (const fl of [s.flights[0], s.flights[s.flights.length - 1]]) {
        if (!fl) continue;
        const b = fl.box;
        const land = 3.2;
        // Before the first flight and past the last one.
        if (fl === s.flights[0]) this.keep.push(fl.dx > 0 ? { ...b, x1: b.x0, x0: b.x0 - land } : fl.dx < 0 ? { ...b, x0: b.x1, x1: b.x1 + land } : fl.dy > 0 ? { ...b, y1: b.y0, y0: b.y0 - land } : { ...b, y0: b.y1, y1: b.y1 + land });
        if (fl === s.flights[s.flights.length - 1]) this.keep.push(fl.dx > 0 ? { ...b, x0: b.x1, x1: b.x1 + land } : fl.dx < 0 ? { ...b, x1: b.x0, x0: b.x0 - land } : fl.dy > 0 ? { ...b, y0: b.y1, y1: b.y1 + land } : { ...b, y1: b.y0, y0: b.y0 - land });
      }
    }
  }

  get w() {
    return this.inner.x1 - this.inner.x0;
  }
  get d() {
    return this.inner.y1 - this.inner.y0;
  }
  get cx() {
    return (this.inner.x0 + this.inner.x1) / 2;
  }
  get cy() {
    return (this.inner.y0 + this.inner.y1) / 2;
  }
  /** Clear distance between this side's wall and the one across. */
  across(side: Side) {
    return side === 'N' || side === 'S' ? this.d : this.w;
  }

  frame(side: Side): SideFrame | null {
    return sideFrame(this.info.edges, side, this.inner);
  }

  /** A box hugging a side: from `n0` to `n1` feet out from the wall face, between `a` and `b` along it. */
  strip(sf: SideFrame, a: number, b: number, n0: number, n1: number): Box {
    const p0 = sf.face + sf.into * n0;
    const p1 = sf.face + sf.into * n1;
    const [lo, hi] = p0 < p1 ? [p0, p1] : [p1, p0];
    return sf.axis === 'x' ? { x0: a, x1: b, y0: lo, y1: hi } : { y0: a, y1: b, x0: lo, x1: hi };
  }

  /** Stretches along a side where a real wall stands (not open to the next room, not a railing). */
  solid(side: Side): Interval[] {
    const sf = this.frame(side);
    if (!sf) return [];
    const edge = this.info.edges.filter((e) => e.side === side);
    const out: Interval[] = [];
    for (const w of this.rl.walls) {
      if (w.kind !== 'exterior' && w.kind !== 'interior') continue;
      if (w.pos !== this.room.id && w.neg !== this.room.id) continue;
      if (!edge.some((e) => e.axis === w.axis && Math.abs(e.coord - w.coord) < 1e-6)) continue;
      // Only the edge that the inner box actually sits against.
      const onFace = Math.abs(w.coord + sf.into * (w.thickness / 2) - sf.face) < 0.05 || Math.abs(w.coord - sf.face) < w.thickness;
      if (!onFace) continue;
      const a = Math.max(w.a, sf.a);
      const b = Math.min(w.b, sf.b);
      if (b - a > 1e-6) out.push([a, b]);
    }
    out.sort((p, q) => p[0] - q[0]);
    // Merge touching pieces.
    const merged: Interval[] = [];
    for (const iv of out) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    return merged;
  }

  /**
   * Where along a side a piece w wide, d deep and h tall (its underside `mount` above the floor) can back
   * onto the wall: real wall only, clear of doors, clear of windows it would cover, clear of keep-out
   * floor and of what's already placed.
   */
  freeAlong(side: Side, d: number, h: number, mount = 0, extraKeep: Box[] = [], clear = 0): Interval[] {
    const sf = this.frame(side);
    if (!sf) return [];
    let free = this.solid(side);
    for (const o of this.openings) {
      if (o.here !== side) continue;
      if (isPassable(o.type)) free = subtract(free, o.u0 - 0.3, o.u1 + 0.3);
      else if (mount + h > o.sill - 0.05 && mount < o.head) free = subtract(free, o.u0 - 0.15, o.u1 + 0.15);
    }
    const lo = sf.axis === 'x' ? 'x0' : 'y0';
    const hi = sf.axis === 'x' ? 'x1' : 'y1';
    // The piece itself stays off doorway landings; the floor in front of it only has to be free of furniture.
    const band = this.strip(sf, sf.a, sf.b, 0, d);
    const blockers: Box[] = [...this.placed.filter((p) => p.z0 < mount + h && mount < p.z1).map((p) => p.box), ...(mount < 4 ? this.keep : []), ...extraKeep];
    for (const k of blockers) if (overlaps(k, band)) free = subtract(free, k[lo], k[hi]);
    if (clear > 0) {
      const front = this.strip(sf, sf.a, sf.b, d, d + clear);
      for (const p of this.placed) if (p.z0 < 3 && overlaps(p.box, front)) free = subtract(free, p.box[lo], p.box[hi]);
      // And it has to fit in the room.
      if (this.across(side) < d + clear - 1e-6) return [];
    }
    return free;
  }

  /** The best spot for a w-wide piece against a side, as close to `prefer` (default: the middle) as it can get. */
  wallSlot(side: Side, w: number, d: number, h: number, opts: { prefer?: number; mount?: number; extraKeep?: Box[]; clear?: number } = {}): Slot | null {
    const sf = this.frame(side);
    if (!sf) return null;
    const want = opts.prefer ?? (sf.a + sf.b) / 2;
    let best: number | null = null;
    for (const [a, b] of this.freeAlong(side, d, h, opts.mount ?? 0, opts.extraKeep, opts.clear ?? 0)) {
      if (b - a < w - 1e-6) continue;
      const c = Math.min(Math.max(want, a + w / 2), b - w / 2);
      if (best === null || Math.abs(c - want) < Math.abs(best - want)) best = c;
    }
    if (best === null) return null;
    return { side, u: best, box: this.strip(sf, best - w / 2, best + w / 2, 0, d) };
  }

  /** Inside the room and clear of keep-out floor and other pieces. */
  fits(box: Box, opts: { keep?: boolean; z0?: number; z1?: number } = {}): boolean {
    const i = this.inner;
    if (box.x0 < i.x0 - 1e-6 || box.x1 > i.x1 + 1e-6 || box.y0 < i.y0 - 1e-6 || box.y1 > i.y1 + 1e-6) return false;
    const z0 = opts.z0 ?? 0;
    const z1 = opts.z1 ?? 3;
    if (this.placed.some((p) => p.z0 < z1 && z0 < p.z1 && overlaps(p.box, box))) return false;
    if (opts.keep !== false && this.keep.some((k) => overlaps(k, box))) return false;
    return true;
  }

  /** Is this floor clear of placed pieces and keep-out? (For checking walk-around space.) */
  clear(box: Box): boolean {
    return this.fits(box, { z0: 0, z1: 3 });
  }

  /**
   * Place a piece against a wall at `u` along it. Returns its footprint, or null if it would run into
   * something already there (a pinned piece, say) or leave the room.
   */
  wall(id: string, kind: string, side: Side, u: number, size?: [number, number]): Box | null {
    const sf = this.frame(side);
    if (!sf) return null;
    const spec = fixtureSpec(kind);
    // Snap to the inch first so what's stored is exactly what was checked.
    const offset = round(u - sf.mid);
    const sz = size ? ([round(size[0]), round(size[1])] as [number, number]) : undefined;
    const [w, d] = sz ?? [spec.w, spec.d];
    const at = sf.mid + offset;
    const box = this.strip(sf, at - w / 2, at + w / 2, 0, d);
    if (!this.take(id, spec.mount ?? 0, spec.h, box, spec.solid !== false, false)) return null;
    this.out.push({ id, kind, room: this.room.id, wall: side, align: 'center', offset, ...(sz ? { size: sz } : {}), auto: true });
    return box;
  }

  /** Place a free-standing piece centered at (cx, cy) with its front facing `facing`. */
  float(id: string, kind: string, cx: number, cy: number, facing: Side, size?: [number, number]): Box | null {
    const spec = fixtureSpec(kind);
    const sz = size ? ([round(size[0]), round(size[1])] as [number, number]) : undefined;
    const [w, d] = sz ?? [spec.w, spec.d];
    const [x, y] = [round(cx), round(cy)];
    const box = footprint(x, y, w, d, facing);
    if (!this.take(id, spec.mount ?? 0, spec.h, box, spec.solid !== false, true)) return null;
    this.out.push({ id, kind, room: this.room.id, at: [x, y], rotation: ROTATION_BY_FACING[facing], align: 'center', offset: 0, ...(sz ? { size: sz } : {}), auto: true });
    return box;
  }

  /** Claim the space. Pieces that were removed or hand-edited are skipped (the edited ones already sit in `placed`). */
  private take(id: string, mount: number, h: number, box: Box, solid: boolean, floating: boolean): boolean {
    if (this.skip.has(id)) return false;
    const i = this.inner;
    if (box.x0 < i.x0 - 0.05 || box.x1 > i.x1 + 0.05 || box.y0 < i.y0 - 0.05 || box.y1 > i.y1 + 0.05) return false;
    if (solid && this.placed.some((p) => p.z0 < mount + h && mount < p.z1 && overlaps(p.box, box, 0.09))) return false;
    // Nothing that stands on the floor goes in front of a doorway or on the stairs.
    if (solid && mount < 2 && this.keep.some((k) => overlaps(k, box, 0.05))) return false;
    if (solid) this.placed.push({ box, z0: mount, z1: mount + h, id, floating });
    return true;
  }

  /** Can you still walk between every doorway of the room? */
  connected(): boolean {
    return regionConnected([this]);
  }

  /** Take pieces back out until every doorway connects again. */
  unblock() {
    unblockRegion([this]);
  }

  /** Corner spots for small things (plants, lamps): the first one that's clear. */
  corner(size: number): { x: number; y: number } | null {
    const i = this.inner;
    const m = 0.3 + size / 2;
    for (const [x, y] of [
      [i.x0 + m, i.y0 + m],
      [i.x1 - m, i.y0 + m],
      [i.x1 - m, i.y1 - m],
      [i.x0 + m, i.y1 - m],
    ]) {
      const box = { x0: x - size / 2, x1: x + size / 2, y0: y - size / 2, y1: y + size / 2 };
      if (this.fits(box)) return { x, y };
    }
    return null;
  }

  /** Point `n` feet out from a side's wall face, `u` along it. */
  point(side: Side, u: number, n: number): [number, number] {
    const sf = this.frame(side)!;
    const p = sf.face + sf.into * n;
    return sf.axis === 'x' ? [u, p] : [p, u];
  }

  /** Doors and openings on a side. */
  doorsOn(side: Side) {
    return this.openings.filter((o) => o.here === side && isPassable(o.type));
  }
  windowsOn(side: Side) {
    return this.openings.filter((o) => o.here === side && !isPassable(o.type));
  }
}

export { overlaps, round };

const R = 0.85;

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** The level's walls as line segments, with doorways cut out (the same walls walking bumps into). */
const segCache = new WeakMap<ResolvedLevel, Seg[]>();
function levelSegs(rl: ResolvedLevel): Seg[] {
  const hit = segCache.get(rl);
  if (hit) return hit;
  const holes: Box[] = rl.openings
    .filter((o) => o.type !== 'open' && o.sill < 1)
    .map((o) => (o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: o.wall.coord - 2, y1: o.wall.coord + 2 } : { y0: o.u0, y1: o.u1, x0: o.wall.coord - 2, x1: o.wall.coord + 2 }));
  const segs: Seg[] = [];
  for (const poly of wallUnion(rl.walls, holes)) for (const ring of poly) for (const e of ringEdges(ring)) segs.push({ ax: e.a[0], ay: e.a[1], bx: e.b[0], by: e.b[1] });
  for (const w of rl.walls) if (w.kind === 'railing') segs.push(w.axis === 'x' ? { ax: w.a, ay: w.coord, bx: w.b, by: w.coord } : { ax: w.coord, ay: w.a, bx: w.coord, by: w.b });
  segCache.set(rl, segs);
  return segs;
}

const segDist = (g: Seg, x: number, y: number) => {
  const vx = g.bx - g.ax;
  const vy = g.by - g.ay;
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - g.ax) * vx + (y - g.ay) * vy) / l2));
  return Math.hypot(x - g.ax - vx * t, y - g.ay - vy * t);
};
const boxDist = (b: Box, x: number, y: number) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

/**
 * Can you walk (0.85' clear of walls, stairs and furniture) between every doorway of a set of rooms that
 * open into each other? Open connections inside the set are just floor; doorways out of it must connect.
 */
export function regionConnected(ctxs: RoomCtx[]): boolean {
  const ids = new Set(ctxs.map((c) => c.room.id));
  const rl = ctxs[0].rl;
  const portals: [number, number][][] = [];
  for (const c of ctxs) {
    for (const o of c.openings) {
      if (!isPassable(o.type) || o.type === 'garage_door') continue;
      const other = o.room === c.room.id ? o.other : o.room;
      if (o.type === 'open' && other && ids.has(other)) continue;
      const sf = c.frame(o.here);
      if (!sf) continue;
      const n = 1.3;
      const pts: [number, number][] = [c.point(o.here, (o.u0 + o.u1) / 2, n)];
      if (o.type === 'open') for (let u = o.u0 + 1; u <= o.u1 - 1; u += 2) pts.push(c.point(o.here, u, n));
      portals.push(pts);
    }
  }
  // Stairs are ways in and out too: the foot of each flight that starts here, the top of each that arrives here.
  const inZone = (pt: [number, number]) => ctxs.some((c) => pointInRing(pt, c.info.ring));
  const beyond = (b: Box, dx: number, dy: number, start: boolean): [number, number] => {
    const cxs = (b.x0 + b.x1) / 2;
    const cys = (b.y0 + b.y1) / 2;
    if (dx > 0) return [start ? b.x0 - 1.3 : b.x1 + 1.3, cys];
    if (dx < 0) return [start ? b.x1 + 1.3 : b.x0 - 1.3, cys];
    if (dy > 0) return [cxs, start ? b.y0 - 1.3 : b.y1 + 1.3];
    return [cxs, start ? b.y1 + 1.3 : b.y0 - 1.3];
  };
  for (const st of rl.stairs) {
    const f = st.flights[0];
    if (!f) continue;
    const pt = beyond(f.box, f.dx, f.dy, true);
    if (inZone(pt)) portals.push([pt]);
  }
  for (const st of rl.stairHoles) {
    const f = st.flights[st.flights.length - 1];
    if (!f) continue;
    const pt = beyond(f.box, f.dx, f.dy, false);
    if (inZone(pt)) portals.push([pt]);
  }
  if (portals.length < 2) return true;
  const box = {
    x0: Math.min(...ctxs.map((c) => c.info.box.x0)),
    x1: Math.max(...ctxs.map((c) => c.info.box.x1)),
    y0: Math.min(...ctxs.map((c) => c.info.box.y0)),
    y1: Math.max(...ctxs.map((c) => c.info.box.y1)),
  };
  const cell = 0.5;
  const nx = Math.max(1, Math.ceil((box.x1 - box.x0) / cell));
  const ny = Math.max(1, Math.ceil((box.y1 - box.y0) / cell));
  const blocks = [...ctxs.flatMap((c) => c.placed.filter((p) => p.z0 < 2).map((p) => p.box)), ...rl.stairs.map((s) => s.footprint), ...rl.stairHoles.map((s) => s.footprint)];
  const near = levelSegs(rl).filter((g) => Math.max(g.ax, g.bx) >= box.x0 - 2 && Math.min(g.ax, g.bx) <= box.x1 + 2 && Math.max(g.ay, g.by) >= box.y0 - 2 && Math.min(g.ay, g.by) <= box.y1 + 2);
  const free = (x: number, y: number) =>
    ctxs.some((c) => pointInRing([x, y], c.info.ring)) && near.every((g) => segDist(g, x, y) >= R) && blocks.every((b) => boxDist(b, x, y) >= R);
  const cx = (k: number) => box.x0 + (k + 0.5) * cell;
  const cy = (k: number) => box.y0 + (k + 0.5) * cell;
  const seen = new Uint8Array(nx * ny);
  const ok = new Int8Array(nx * ny).fill(-1);
  const isFree = (a: number, b: number) => {
    const k = a * ny + b;
    if (ok[k] < 0) ok[k] = free(cx(a), cy(b)) ? 1 : 0;
    return ok[k] === 1;
  };
  // A portal is its nearest free cells (within a cell of the sample point).
  const cellsNear = ([x, y]: [number, number]) => {
    const out: [number, number][] = [];
    const a0 = Math.floor((x - box.x0) / cell);
    const b0 = Math.floor((y - box.y0) / cell);
    for (let a = a0 - 1; a <= a0 + 1; a++) for (let b = b0 - 1; b <= b0 + 1; b++) if (a >= 0 && b >= 0 && a < nx && b < ny && isFree(a, b)) out.push([a, b]);
    return out;
  };
  const stack: [number, number][] = [];
  for (const pt of portals[0])
    for (const [a, b] of cellsNear(pt))
      if (!seen[a * ny + b]) {
        seen[a * ny + b] = 1;
        stack.push([a, b]);
      }
  while (stack.length) {
    const [a, b] = stack.pop()!;
    for (const [da, db] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const u = a + da;
      const v = b + db;
      if (u < 0 || v < 0 || u >= nx || v >= ny || seen[u * ny + v] || !isFree(u, v)) continue;
      seen[u * ny + v] = 1;
      stack.push([u, v]);
    }
  }
  return portals.every((pts) => pts.some((pt) => cellsNear(pt).some(([a, b]) => seen[a * ny + b] === 1)));
}

/**
 * Take pieces back out until every doorway connects again: first the one piece whose removal fixes it
 * (latest first), otherwise peel off free-standing pieces, then wall pieces, one at a time.
 */
export function unblockRegion(ctxs: RoomCtx[]) {
  const all = () => ctxs.flatMap((c) => c.placed.filter((p) => p.id && p.z0 < 2).map((p) => ({ c, p })));
  const drop = ({ c, p }: { c: RoomCtx; p: Placed }) => {
    c.placed.splice(c.placed.indexOf(p), 1);
    const k = c.out.findIndex((f) => f.id === p.id);
    if (k >= 0) c.out.splice(k, 1);
  };
  for (let guard = 0; guard < 40 && !regionConnected(ctxs); guard++) {
    const mine = all();
    if (!mine.length) return;
    let culprit: (typeof mine)[number] | undefined;
    for (const m of [...mine].reverse()) {
      const i = m.c.placed.indexOf(m.p);
      m.c.placed.splice(i, 1);
      const ok = regionConnected(ctxs);
      m.c.placed.splice(i, 0, m.p);
      if (ok) {
        culprit = m;
        break;
      }
    }
    drop(culprit ?? [...mine.filter((m) => !m.p.floating), ...mine.filter((m) => m.p.floating)].pop()!);
  }
}
