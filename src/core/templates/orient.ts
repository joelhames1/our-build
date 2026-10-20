import type { Align, Opening, Project, Side } from '../model/schema';
import { isEnclosed } from '../model/schema';
import { roomRing } from '../geometry/polygon';

/** Quarter turns counter-clockwise that take a south-facing plan to face `front`. */
const TURNS: Record<Side, number> = { S: 0, E: 1, N: 2, W: 3 };
const CCW: Record<Side, Side> = { N: 'W', W: 'S', S: 'E', E: 'N' };
const flipsAlong = (s: Side) => s === 'E' || s === 'W';
const swapAlign = (a: Align): Align => (a === 'start' ? 'end' : a === 'end' ? 'start' : a);
const swapSwing = (s: Opening['swing']): Opening['swing'] => (s === 'left' ? 'right' : s === 'right' ? 'left' : s === 'out_left' ? 'out_right' : s === 'out_right' ? 'out_left' : s);

/** Rotate a plan so its front faces `front`, then move it back so the house starts at the origin. */
export function orient(p: Project, front: Side): Project {
  const turns = TURNS[front];
  for (let i = 0; i < turns; i++) rotate(p);
  p.site.front = front;
  normalizeOrigin(p);
  return p;
}

function rotate(p: Project) {
  const pt = ([x, y]: [number, number]): [number, number] => [-y, x];
  for (const level of p.levels) {
    for (const r of level.rooms) {
      if (r.rect) {
        const [x, y, w, d] = r.rect;
        r.rect = [-(y + d), x, d, w];
      }
      if (r.poly) r.poly = r.poly.map((q) => pt(q as [number, number]));
      if (r.kitchen) {
        if (r.kitchen.walls) r.kitchen.walls = r.kitchen.walls.map((s) => CCW[s]);
        if (r.kitchen.sink && r.kitchen.sink !== 'island') r.kitchen.sink = CCW[r.kitchen.sink];
        if (r.kitchen.range && r.kitchen.range !== 'island') r.kitchen.range = CCW[r.kitchen.range];
        if (r.kitchen.fridge) r.kitchen.fridge = CCW[r.kitchen.fridge];
      }
      if (r.bath?.wetWall) r.bath.wetWall = CCW[r.bath.wetWall];
    }
    for (const o of level.openings) {
      if (o.side) {
        if (flipsAlong(o.side)) {
          o.offset = -(o.offset ?? 0);
          o.align = swapAlign(o.align ?? 'center');
          o.swing = swapSwing(o.swing ?? 'auto');
        }
        o.side = CCW[o.side];
      }
    }
    for (const f of level.fixtures) {
      if (f.wall) {
        if (flipsAlong(f.wall)) {
          f.offset = -(f.offset ?? 0);
          f.align = swapAlign(f.align ?? 'center');
        }
        f.wall = CCW[f.wall];
      }
      if (f.at) f.at = pt(f.at as [number, number]);
      if (f.rotation !== undefined) f.rotation = (((f.rotation + 90) % 360) as 0 | 90 | 180 | 270);
    }
    for (const s of level.stairs) {
      s.dir = CCW[s.dir];
      if (s.wall) s.wall = CCW[s.wall];
      if (s.at) s.at = pt(s.at as [number, number]);
    }
  }
  p.site.water = p.site.water.map((s) => CCW[s]);
  if (p.roof.low) p.roof.low = CCW[p.roof.low];
  if (p.roof.chimney) p.roof.chimney.side = CCW[p.roof.chimney.side];
}

function normalizeOrigin(p: Project) {
  const first = p.levels[0];
  const pts = first.rooms.filter((r) => isEnclosed(r.type)).flatMap((r) => roomRing(r));
  if (!pts.length) return;
  const dx = -Math.min(...pts.map((q) => q[0]));
  const dy = -Math.min(...pts.map((q) => q[1]));
  if (!dx && !dy) return;
  for (const level of p.levels) {
    for (const r of level.rooms) {
      if (r.rect) r.rect = [r.rect[0] + dx, r.rect[1] + dy, r.rect[2], r.rect[3]];
      if (r.poly) r.poly = r.poly.map(([x, y]) => [x + dx, y + dy]);
    }
    for (const f of level.fixtures) if (f.at) f.at = [f.at[0] + dx, f.at[1] + dy];
    for (const s of level.stairs) if (s.at) s.at = [s.at[0] + dx, s.at[1] + dy];
  }
}
