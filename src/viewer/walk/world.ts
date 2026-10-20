import { type Box, pointInRing, ringEdges } from '@/core/geometry/polygon';
import { type ResolvedStair, stairHeightAt } from '@/core/geometry/stairs';
import { wallUnion } from '@/core/geometry/walls';
import { isOutdoor, isDoorType } from '@/core/model/schema';
import type { Resolved } from '@/core/resolve';

/** A 2D collision segment on plan. */
export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface WalkLevel {
  index: number;
  elevation: number;
  segs: Seg[];
  floors: { ring: [number, number][]; z: number; room: string; name: string }[];
  /** Stairs that start on this level. */
  stairs: ResolvedStair[];
  /** Stairs from the level below that open a hole in this floor. */
  holes: ResolvedStair[];
}

export interface WalkWorld {
  levels: WalkLevel[];
  spawn: { x: number; y: number; level: number; yaw: number };
  bounds: Box;
}

export const RADIUS = 0.9;
export const EYE = 5.4;
const STEP = 2.7;

/** Everything walk mode needs to know: walls to bump into, floors to stand on, stairs to climb. */
export function buildWalkWorld(res: Resolved): WalkWorld {
  const levels: WalkLevel[] = res.levels.map((rl) => {
    // Walls cut at knee height: doors and openings are passable, windows are not.
    const holes: Box[] = rl.openings
      .filter((o) => o.type !== 'open' && o.sill < 1)
      .map((o) => (o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: o.wall.coord - 2, y1: o.wall.coord + 2 } : { y0: o.u0, y1: o.u1, x0: o.wall.coord - 2, x1: o.wall.coord + 2 }));
    const solid = wallUnion(rl.walls, holes);
    const segs: Seg[] = [];
    for (const poly of solid) for (const ring of poly) for (const e of ringEdges(ring)) segs.push({ ax: e.a[0], ay: e.a[1], bx: e.b[0], by: e.b[1] });
    for (const w of rl.walls) {
      if (w.kind !== 'railing') continue;
      segs.push(w.axis === 'x' ? { ax: w.a, ay: w.coord, bx: w.b, by: w.coord } : { ax: w.coord, ay: w.a, bx: w.coord, by: w.b });
    }
    // Guard the stair openings in this floor, except the edge you step off at the top, and the edge
    // where a flight stacked right above starts (its treads cover the opening).
    for (const s of rl.stairHoles) {
      const f = s.footprint;
      const open = new Set<string>([s.arrival]);
      for (const up of rl.stairs) if (overlaps(up.footprint, f) && up.flights[0]) open.add(startSide(up.flights[0]));
      const edges: [string, Seg][] = [
        ['S', { ax: f.x0, ay: f.y0, bx: f.x1, by: f.y0 }],
        ['N', { ax: f.x0, ay: f.y1, bx: f.x1, by: f.y1 }],
        ['W', { ax: f.x0, ay: f.y0, bx: f.x0, by: f.y1 }],
        ['E', { ax: f.x1, ay: f.y0, bx: f.x1, by: f.y1 }],
      ];
      for (const [side, seg] of edges) if (!open.has(side)) segs.push(seg);
    }
    // Stairs can only be entered at the bottom.
    for (const s of rl.stairs) {
      for (const fl of s.flights) {
        const b = fl.box;
        if (fl.dx !== 0) {
          segs.push({ ax: b.x0, ay: b.y0, bx: b.x1, by: b.y0 }, { ax: b.x0, ay: b.y1, bx: b.x1, by: b.y1 });
        } else {
          segs.push({ ax: b.x0, ay: b.y0, bx: b.x0, by: b.y1 }, { ax: b.x1, ay: b.y0, bx: b.x1, by: b.y1 });
        }
      }
    }
    const floors = [...rl.rooms.values()]
      .filter((i) => i.room.type !== 'open_to_below')
      .map((i) => ({ ring: i.ring as [number, number][], z: isOutdoor(i.room.type) ? rl.elevation - 0.33 : rl.elevation, room: i.room.id, name: i.room.name }));
    return { index: rl.index, elevation: rl.elevation, segs, floors, stairs: rl.stairs, holes: rl.stairHoles };
  });
  return { levels, spawn: spawnPoint(res), bounds: res.bounds };
}

/** Out in the yard, looking at the front door. */
export function spawnPoint(res: Resolved): WalkWorld['spawn'] {
  const rl = res.levels[0];
  const outdoorish = (id: string | null) => id === null || isOutdoor(rl.rooms.get(id)?.room.type ?? 'hall');
  const doors = rl.openings.filter((o) => isDoorType(o.type) && o.type !== 'garage_door' && outdoorish(o.other));
  const front = doors.find((o) => o.side === res.project.site.front) ?? doors[0];
  const b = res.bounds;
  if (!front) return { x: (b.x0 + b.x1) / 2, y: b.y0 - 20, level: 0, yaw: 0 };
  const out = front.wall.outside || -front.hostSign;
  const mid = (front.u0 + front.u1) / 2;
  // Far enough back to take in the front of the house, past any porch.
  const d = 22;
  const x = front.axis === 'x' ? mid : front.wall.coord + out * d;
  const y = front.axis === 'x' ? front.wall.coord + out * d : mid;
  // Face back toward the door.
  // yaw 0 looks north; forward on plan is (-sin yaw, cos yaw).
  const yaw = front.axis === 'x' ? (out > 0 ? Math.PI : 0) : out > 0 ? Math.PI / 2 : -Math.PI / 2;
  return { x, y, level: 0, yaw };
}

/**
 * Height of whatever you'd be standing on at (x, y) on a level, or null if there's nothing. Surfaces can
 * overlap (a stair over a floor, a flight stacked over the opening of the one below); `z` picks the one you
 * can actually step onto: the highest within a step of where you are. Without `z`, stairs win.
 */
export function floorAt(w: WalkWorld, level: number, x: number, y: number, z?: number): { z: number; level: number } | null {
  const L = w.levels[level];
  if (!L) return null;
  const found: { z: number; level: number }[] = [];
  // Under the low end of a stair there's no headroom: that floor is off limits.
  let underLow = false;
  for (const s of L.stairs) {
    const h = stairHeightAt(s, x, y);
    if (h !== null) found.push({ z: L.elevation + h, level });
    if (h !== null && h < 7) underLow = true;
  }
  let overHole = false;
  for (const s of L.holes) {
    const f = s.footprint;
    const h = stairHeightAt(s, x, y);
    if (h !== null) found.push({ z: w.levels[level - 1].elevation + h, level: level - 1 });
    if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) {
      overHole = true;
      if (h === null) found.push({ z: w.levels[level - 1].elevation, level: level - 1 });
    }
  }
  if (!overHole && !underLow) {
    const fl = L.floors.find((f) => pointInRing([x, y], f.ring));
    if (fl) found.push({ z: fl.z, level });
    else if (level === 0) found.push({ z: 0, level: 0 });
  }
  if (!found.length) return null;
  if (z === undefined || found.length === 1) return found[0];
  const reachable = found.filter((f) => f.z <= z + STEP);
  return reachable.length ? reachable.reduce((a, b) => (b.z > a.z ? b : a)) : found.reduce((a, b) => (b.z < a.z ? b : a));
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 - 0.1 && b.x0 < a.x1 - 0.1 && a.y0 < b.y1 - 0.1 && b.y0 < a.y1 - 0.1;
const startSide = (f: { dx: number; dy: number }) => (f.dx > 0 ? 'W' : f.dx < 0 ? 'E' : f.dy > 0 ? 'S' : 'N');

/** Move a circle by (dx, dy), sliding along walls. */
export function slide(segs: Seg[], x: number, y: number, dx: number, dy: number, r = RADIUS): [number, number] {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (r * 0.4)));
  let px = x;
  let py = y;
  for (let s = 0; s < steps; s++) {
    px += dx / steps;
    py += dy / steps;
    for (let it = 0; it < 3; it++) {
      let pushed = false;
      for (const g of segs) {
        const vx = g.bx - g.ax;
        const vy = g.by - g.ay;
        const l2 = vx * vx + vy * vy;
        if (l2 < 1e-9) continue;
        let t = ((px - g.ax) * vx + (py - g.ay) * vy) / l2;
        t = Math.max(0, Math.min(1, t));
        const cx = g.ax + vx * t;
        const cy = g.ay + vy * t;
        const ox = px - cx;
        const oy = py - cy;
        const d = Math.hypot(ox, oy);
        if (d < r && d > 1e-9) {
          px = cx + (ox / d) * r;
          py = cy + (oy / d) * r;
          pushed = true;
        }
      }
      if (!pushed) break;
    }
  }
  return [px, py];
}

export { STEP };

/**
 * Flood-fill the walkable space from the spawn point on a half-foot grid, using the same walls,
 * floors, step heights and stairs as walking does. Returns the rooms you can stand in, per level.
 */
export function walkableRooms(w: WalkWorld, cell = 0.5, debug?: (grid: { x0: number; y0: number; nx: number; ny: number; cell: number; clear: Uint8Array[]; seen: Uint8Array[] }) => void): Set<string>[] {
  const pad = 6;
  const b = w.bounds;
  const x0 = Math.min(b.x0, w.spawn.x) - pad;
  const y0 = Math.min(b.y0, w.spawn.y) - pad;
  const nx = Math.ceil((Math.max(b.x1, w.spawn.x) + pad - x0) / cell);
  const ny = Math.ceil((Math.max(b.y1, w.spawn.y) + pad - y0) / cell);
  const clear = w.levels.map((L) => {
    const ok = new Uint8Array(nx * ny);
    // Bucket the walls so each cell only checks the few nearby.
    const B = 4;
    const bx = Math.ceil((nx * cell) / B) + 1;
    const buckets = new Map<number, Seg[]>();
    for (const g of L.segs) {
      const r = RADIUS;
      for (let a = Math.floor((Math.min(g.ax, g.bx) - r - x0) / B); a <= Math.floor((Math.max(g.ax, g.bx) + r - x0) / B); a++)
        for (let c = Math.floor((Math.min(g.ay, g.by) - r - y0) / B); c <= Math.floor((Math.max(g.ay, g.by) + r - y0) / B); c++) {
          const k = c * bx + a;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(g);
        }
    }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const px = x0 + i * cell;
        const py = y0 + j * cell;
        let free = true;
        for (const g of buckets.get(Math.floor((py - y0) / B) * bx + Math.floor((px - x0) / B)) ?? []) {
          const vx = g.bx - g.ax;
          const vy = g.by - g.ay;
          const l2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((px - g.ax) * vx + (py - g.ay) * vy) / l2));
          if (Math.hypot(px - g.ax - vx * t, py - g.ay - vy * t) < RADIUS * 0.95) {
            free = false;
            break;
          }
        }
        ok[i * ny + j] = free ? 1 : 0;
      }
    return ok;
  });
  // Visited per level, cell and 4' height band: the same spot can be under a stair and on it.
  const visited = new Set<number>();
  const key = (lv: number, k: number, z: number) => (lv * nx * ny + k) * 64 + Math.max(0, Math.min(63, Math.floor(z / 4)));
  const seen = w.levels.map(() => new Uint8Array(nx * ny));
  const out = w.levels.map(() => new Set<string>());
  const si = Math.round((w.spawn.x - x0) / cell);
  const sj = Math.round((w.spawn.y - y0) / cell);
  const z0 = floorAt(w, w.spawn.level, w.spawn.x, w.spawn.y)?.z ?? 0;
  const queue: [number, number, number, number][] = [[w.spawn.level, si, sj, z0]];
  seen[w.spawn.level][si * ny + sj] = 1;
  visited.add(key(w.spawn.level, si * ny + sj, z0));
  while (queue.length) {
    const [lv, i, j, z] = queue.pop()!;
    const px = x0 + i * cell;
    const py = y0 + j * cell;
    const here = w.levels[lv].floors.find((f) => pointInRing([px, py], f.ring));
    if (here) out[lv].add(here.room);
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= ny || !clear[lv][a * ny + c]) continue;
      const fl = floorAt(w, lv, x0 + a * cell, y0 + c * cell, z);
      if (!fl || fl.z - z > STEP) continue;
      const up = w.levels[fl.level + 1];
      const nl = up && fl.z > up.elevation - 1.5 ? fl.level + 1 : fl.level;
      // Switching floors mid-stair only works if that spot is clear on the new floor too.
      if (nl !== lv && !clear[nl][a * ny + c]) continue;
      const k = key(nl, a * ny + c, fl.z);
      if (visited.has(k)) continue;
      visited.add(k);
      seen[nl][a * ny + c] = 1;
      queue.push([nl, a, c, fl.z]);
    }
  }
  debug?.({ x0, y0, nx, ny, cell, clear, seen });
  return out;
}
