import type { Issue } from '../model/issues';
import type { Level, Room, Side, Stair } from '../model/schema';
import { roomEdges } from './openings';
import { type Box, boxD, boxW, ringBox, roomRing } from './polygon';

export const MAX_RISER = 7.75 / 12;
export const TREAD = 10 / 12;

export interface Flight {
  /** Box of the flight on plan. */
  box: Box;
  /** Unit vector of travel going up. */
  dx: number;
  dy: number;
  /** Plan coordinate (along travel) where the flight starts. */
  start: number;
  treads: number;
  z0: number;
  z1: number;
}

export interface ResolvedStair {
  id: string;
  room: string;
  shape: Stair['shape'];
  dir: Side;
  width: number;
  risers: number;
  riser: number;
  tread: number;
  rise: number;
  footprint: Box;
  flights: Flight[];
  landings: { box: Box; z: number }[];
  /** Each tread: plan box and top surface height (relative to the floor below). */
  steps: { box: Box; top: number }[];
  /** Edge of the footprint where you step off at the top. */
  arrival: Side;
}

const V: Record<Side, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
const LEFT: Record<Side, Side> = { N: 'W', W: 'S', S: 'E', E: 'N' };
const RIGHT: Record<Side, Side> = { N: 'E', E: 'S', S: 'W', W: 'N' };
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function riserCount(rise: number) {
  return Math.max(2, Math.ceil(rise / MAX_RISER - 1e-9));
}

/** Plan size of a stair (along travel, across travel) for a total rise. */
export function stairSize(shape: Stair['shape'], rise: number, width: number): { along: number; across: number } {
  const n = riserCount(rise);
  if (shape === 'straight') return { along: (n - 1) * TREAD, across: width };
  const k1 = Math.ceil((n - 2) / 2);
  const k2 = n - 2 - k1;
  if (shape === 'L') return { along: k1 * TREAD + width, across: width + k2 * TREAD };
  return { along: Math.max(k1, k2) * TREAD + width, across: 2 * width };
}

/**
 * Lay out a stair inside its room. Coordinates are plan feet; heights are relative to the
 * floor the stair starts on and end at `rise` (the next floor up).
 */
export function resolveStair(s: Stair, level: Level, rise: number, inset = 0.25): { stair?: ResolvedStair; issues: Issue[] } {
  const issues: Issue[] = [];
  const room = level.rooms.find((r) => r.id === s.room);
  if (!room) {
    return { issues: [{ rule: 'stair.orphan', severity: 'warning', message: `Stairs ${s.id} belong to a room that no longer exists.`, level: level.id, ids: [s.id], fix: [{ op: 'remove_stairs', stairs: s.id }] }] };
  }
  const rb = ringBox(roomRing(room));
  const n = riserCount(rise);
  const riser = rise / n;
  const w = s.width ?? 3.5;
  const size = stairSize(s.shape, rise, w);
  const [dx, dy] = V[s.dir];
  const turn: Side = s.shape === 'straight' ? s.dir : s.turn === 'right' ? RIGHT[s.dir] : LEFT[s.dir];

  // Footprint in a local frame: u along travel, v toward the turn side.
  // Place the footprint box in plan coordinates.
  const alongX = dx !== 0;
  const fw = alongX ? size.along : size.across; // extent in x
  const fd = alongX ? size.across : size.along; // extent in y
  let x0: number;
  let y0: number;

  const wallSide = s.wall ?? pickWall(room, s.dir, turn, alongX ? fd : fw);
  if (s.at) {
    // `at` is the center of the bottom step's leading edge.
    const [ax, ay] = s.at;
    const [tx, ty] = V[turn];
    if (alongX) {
      x0 = dx > 0 ? ax : ax - fw;
      y0 = s.shape === 'straight' ? ay - w / 2 : ty > 0 ? ay - w / 2 : ay - fd + w / 2;
    } else {
      y0 = dy > 0 ? ay : ay - fd;
      x0 = s.shape === 'straight' ? ax - w / 2 : tx > 0 ? ax - w / 2 : ax - fw + w / 2;
    }
  } else {
    const cx = (rb.x0 + rb.x1) / 2;
    const cy = (rb.y0 + rb.y1) / 2;
    x0 = cx - fw / 2;
    y0 = cy - fd / 2;
    const ws = wallSide;
    if (ws === 'W') x0 = rb.x0 + inset;
    if (ws === 'E') x0 = rb.x1 - inset - fw;
    if (ws === 'S') y0 = rb.y0 + inset;
    if (ws === 'N') y0 = rb.y1 - inset - fd;
    // When the wall is perpendicular to travel and the stair would start against it, leave a landing.
    if (ws === OPP[s.dir]) {
      if (ws === 'W') x0 += 3;
      if (ws === 'E') x0 -= 3;
      if (ws === 'S') y0 += 3;
      if (ws === 'N') y0 -= 3;
    } else if (ws !== s.dir) {
      // Running along a side wall: a 3' landing at the bottom, and any spare room left at the top.
      const room0 = alongX ? rb.x0 : rb.y0;
      const room1 = alongX ? rb.x1 : rb.y1;
      const len = alongX ? fw : fd;
      const slack = room1 - room0 - 2 * inset - len;
      const bottom = Math.min(slack, 3);
      const start = (alongX ? dx : dy) > 0 ? room0 + inset + bottom : room1 - inset - bottom - len;
      if (slack > 0) {
        if (alongX) x0 = start;
        else y0 = start;
      }
    }
  }
  const footprint: Box = { x0, y0, x1: x0 + fw, y1: y0 + fd };

  if (footprint.x0 < rb.x0 - 1e-6 || footprint.x1 > rb.x1 + 1e-6 || footprint.y0 < rb.y0 - 1e-6 || footprint.y1 > rb.y1 + 1e-6) {
    issues.push({
      rule: 'stair.fit',
      severity: 'warning',
      message: `The stairs in ${room.name} need about ${Math.ceil(boxW(footprint))}' × ${Math.ceil(boxD(footprint))}' and don't fit inside the room.`,
      level: level.id,
      ids: [s.id, room.id],
    });
  }

  const flights: Flight[] = [];
  const landings: { box: Box; z: number }[] = [];
  const steps: { box: Box; top: number }[] = [];

  const addFlight = (box: Box, fdx: number, fdy: number, treads: number, zStart: number) => {
    const start = fdx > 0 ? box.x0 : fdx < 0 ? -box.x1 : fdy > 0 ? box.y0 : -box.y1;
    flights.push({ box, dx: fdx, dy: fdy, start, treads, z0: zStart, z1: zStart + treads * riser });
    for (let i = 0; i < treads; i++) {
      const t0 = i * TREAD;
      const t1 = (i + 1) * TREAD;
      let sb: Box;
      if (fdx > 0) sb = { x0: box.x0 + t0, x1: box.x0 + t1, y0: box.y0, y1: box.y1 };
      else if (fdx < 0) sb = { x0: box.x1 - t1, x1: box.x1 - t0, y0: box.y0, y1: box.y1 };
      else if (fdy > 0) sb = { y0: box.y0 + t0, y1: box.y0 + t1, x0: box.x0, x1: box.x1 };
      else sb = { y0: box.y1 - t1, y1: box.y1 - t0, x0: box.x0, x1: box.x1 };
      steps.push({ box: sb, top: zStart + (i + 1) * riser });
    }
  };

  let arrival: Side = s.dir;
  if (s.shape === 'straight') {
    addFlight(footprint, dx, dy, n - 1, 0);
  } else {
    const k1 = Math.ceil((n - 2) / 2);
    const k2 = n - 2 - k1;
    const [tx, ty] = V[turn];
    // Flight 1 runs along travel on the side away from the turn.
    const f1Len = k1 * TREAD;
    let f1: Box;
    let land: Box;
    let f2: Box;
    if (s.shape === 'L') {
      if (alongX) {
        const ys = ty > 0 ? [footprint.y0, footprint.y0 + w] : [footprint.y1 - w, footprint.y1];
        f1 = dx > 0 ? { x0: footprint.x0, x1: footprint.x0 + f1Len, y0: ys[0], y1: ys[1] } : { x0: footprint.x1 - f1Len, x1: footprint.x1, y0: ys[0], y1: ys[1] };
        land = dx > 0 ? { x0: f1.x1, x1: f1.x1 + w, y0: ys[0], y1: ys[1] } : { x0: f1.x0 - w, x1: f1.x0, y0: ys[0], y1: ys[1] };
        f2 = ty > 0 ? { x0: land.x0, x1: land.x1, y0: land.y1, y1: land.y1 + k2 * TREAD } : { x0: land.x0, x1: land.x1, y0: land.y0 - k2 * TREAD, y1: land.y0 };
      } else {
        const xs = tx > 0 ? [footprint.x0, footprint.x0 + w] : [footprint.x1 - w, footprint.x1];
        f1 = dy > 0 ? { y0: footprint.y0, y1: footprint.y0 + f1Len, x0: xs[0], x1: xs[1] } : { y0: footprint.y1 - f1Len, y1: footprint.y1, x0: xs[0], x1: xs[1] };
        land = dy > 0 ? { y0: f1.y1, y1: f1.y1 + w, x0: xs[0], x1: xs[1] } : { y0: f1.y0 - w, y1: f1.y0, x0: xs[0], x1: xs[1] };
        f2 = tx > 0 ? { y0: land.y0, y1: land.y1, x0: land.x1, x1: land.x1 + k2 * TREAD } : { y0: land.y0, y1: land.y1, x0: land.x0 - k2 * TREAD, x1: land.x0 };
      }
      addFlight(f1, dx, dy, k1, 0);
      landings.push({ box: land, z: (k1 + 1) * riser });
      addFlight(f2, tx, ty, k2, (k1 + 1) * riser);
      arrival = turn;
    } else {
      // U: flight 1 along travel, landing across the far end, flight 2 back the other way.
      if (alongX) {
        const ys1 = ty > 0 ? [footprint.y0, footprint.y0 + w] : [footprint.y1 - w, footprint.y1];
        const ys2 = ty > 0 ? [footprint.y0 + w, footprint.y1] : [footprint.y0, footprint.y1 - w];
        f1 = dx > 0 ? { x0: footprint.x0, x1: footprint.x0 + f1Len, y0: ys1[0], y1: ys1[1] } : { x0: footprint.x1 - f1Len, x1: footprint.x1, y0: ys1[0], y1: ys1[1] };
        land = dx > 0 ? { x0: footprint.x1 - w, x1: footprint.x1, y0: footprint.y0, y1: footprint.y1 } : { x0: footprint.x0, x1: footprint.x0 + w, y0: footprint.y0, y1: footprint.y1 };
        f2 = dx > 0 ? { x0: land.x0 - k2 * TREAD, x1: land.x0, y0: ys2[0], y1: ys2[1] } : { x0: land.x1, x1: land.x1 + k2 * TREAD, y0: ys2[0], y1: ys2[1] };
      } else {
        const xs1 = tx > 0 ? [footprint.x0, footprint.x0 + w] : [footprint.x1 - w, footprint.x1];
        const xs2 = tx > 0 ? [footprint.x0 + w, footprint.x1] : [footprint.x0, footprint.x1 - w];
        f1 = dy > 0 ? { y0: footprint.y0, y1: footprint.y0 + f1Len, x0: xs1[0], x1: xs1[1] } : { y0: footprint.y1 - f1Len, y1: footprint.y1, x0: xs1[0], x1: xs1[1] };
        land = dy > 0 ? { y0: footprint.y1 - w, y1: footprint.y1, x0: footprint.x0, x1: footprint.x1 } : { y0: footprint.y0, y1: footprint.y0 + w, x0: footprint.x0, x1: footprint.x1 };
        f2 = dy > 0 ? { y0: land.y0 - k2 * TREAD, y1: land.y0, x0: xs2[0], x1: xs2[1] } : { y0: land.y1, y1: land.y1 + k2 * TREAD, x0: xs2[0], x1: xs2[1] };
      }
      addFlight(f1, dx, dy, k1, 0);
      landings.push({ box: land, z: (k1 + 1) * riser });
      addFlight(f2, -dx, -dy, k2, (k1 + 1) * riser);
      arrival = OPP[s.dir];
    }
  }

  return {
    stair: { id: s.id, room: room.id, shape: s.shape, dir: s.dir, width: w, risers: n, riser, tread: TREAD, rise, footprint, flights, landings, steps, arrival },
    issues,
  };
}

/** Choose the wall to run a stair along: the longest side parallel to travel. */
function pickWall(room: Room, dir: Side, turn: Side, acrossNeeded: number): Side {
  const parallel: Side[] = dir === 'N' || dir === 'S' ? ['W', 'E'] : ['S', 'N'];
  const edges = roomEdges(room);
  const len = (side: Side) => edges.filter((e) => e.side === side).reduce((m, e) => Math.max(m, e.b - e.a), 0);
  // Prefer the side away from the turn so an L or U turns into the room.
  const preferred = parallel.find((p) => p === OPP[turn]);
  if (preferred && len(preferred) >= acrossNeeded) return preferred;
  return parallel.sort((a, b) => len(b) - len(a))[0];
}

/** Height of the stair surface at a plan point, or null if not on the stair. */
export function stairHeightAt(s: ResolvedStair, x: number, y: number): number | null {
  for (const l of s.landings) if (x >= l.box.x0 && x <= l.box.x1 && y >= l.box.y0 && y <= l.box.y1) return l.z;
  for (const f of s.flights) {
    const b = f.box;
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    const pos = f.dx > 0 ? x - b.x0 : f.dx < 0 ? b.x1 - x : f.dy > 0 ? y - b.y0 : b.y1 - y;
    if (f.treads <= 0) continue;
    const len = f.treads * TREAD;
    const t = Math.max(0, Math.min(1, pos / len));
    // A smooth ramp from the floor at the first riser to the next landing (one riser above the last tread).
    const riser = (f.z1 - f.z0) / f.treads;
    return f.z0 + t * (f.treads + 1) * riser;
  }
  return null;
}
