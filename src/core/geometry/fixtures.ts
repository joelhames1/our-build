import { fixtureSpec } from '../catalog/fixtures';
import type { Fixture, Level, Side } from '../model/schema';
import type { Box } from './polygon';
import type { RoomEdge } from './openings';

/** A piece of furniture or a fixture, placed: plan footprint, the way its front faces, and heights. */
export interface ResolvedFixture {
  id: string;
  kind: string;
  room: string;
  auto: boolean;
  /** Center on plan. */
  cx: number;
  cy: number;
  /** Width across its front and depth front-to-back. */
  w: number;
  d: number;
  h: number;
  /** Absolute height of its underside. */
  z0: number;
  /** The direction its front faces (a wall-backed piece faces into the room). */
  facing: Side;
  box: Box;
  solid: boolean;
  /** Set when it backs onto a wall. */
  wall?: Side;
}

export const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
/** Rotation (degrees counterclockwise from facing north) to facing, and back. */
export const FACING_BY_ROTATION: Record<0 | 90 | 180 | 270, Side> = { 0: 'N', 90: 'W', 180: 'S', 270: 'E' };
export const ROTATION_BY_FACING: Record<Side, 0 | 90 | 180 | 270> = { N: 0, W: 90, S: 180, E: 270 };

/** Footprint of a w×d piece centered at (cx, cy) whose front faces `facing`. */
export function footprint(cx: number, cy: number, w: number, d: number, facing: Side): Box {
  const ns = facing === 'N' || facing === 'S';
  const hx = (ns ? w : d) / 2;
  const hy = (ns ? d : w) / 2;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

/** What wall-backed placement needs to know about a room side: its inner face and where along it to measure from. */
export interface SideFrame {
  axis: 'x' | 'y';
  /** Interior face of the wall (perpendicular coordinate). */
  face: number;
  /** +1/-1: the direction from the wall into the room. */
  into: 1 | -1;
  /** Middle of the room's longest edge on this side (offsets are measured from here, like openings). */
  mid: number;
  a: number;
  b: number;
}

export function sideFrame(edges: RoomEdge[], side: Side, inner: Box): SideFrame | null {
  const es = edges.filter((e) => e.side === side);
  if (!es.length) return null;
  const e = es.reduce((p, q) => (q.b - q.a > p.b - p.a ? q : p));
  const axis = e.axis;
  const into: 1 | -1 = side === 'S' || side === 'W' ? 1 : -1;
  const face = side === 'S' ? inner.y0 : side === 'N' ? inner.y1 : side === 'W' ? inner.x0 : inner.x1;
  const [a, b] = axis === 'x' ? [inner.x0, inner.x1] : [inner.y0, inner.y1];
  return { axis, face, into, mid: (e.a + e.b) / 2, a, b };
}

export interface FixtureRoom {
  edges: RoomEdge[];
  /** Clear floor inside the walls. */
  inner: Box;
}

/** Place every fixture on a level. Fixtures whose room is gone are dropped. */
export function resolveFixtures(level: Level, rooms: Map<string, FixtureRoom>, elevation: number): ResolvedFixture[] {
  const out: ResolvedFixture[] = [];
  for (const f of level.fixtures) {
    const room = rooms.get(f.room);
    if (!room) continue;
    const r = resolveFixture(f, room, elevation);
    if (r) out.push(r);
  }
  return out;
}

export function resolveFixture(f: Fixture, room: FixtureRoom, elevation: number): ResolvedFixture | null {
  const spec = fixtureSpec(f.kind);
  const [w, d] = f.size ?? [spec.w, spec.d];
  let cx: number;
  let cy: number;
  let facing: Side;
  if (f.wall) {
    const sf = sideFrame(room.edges, f.wall, room.inner);
    if (!sf) return null;
    facing = OPPOSITE[f.wall];
    const u = f.align === 'start' ? sf.a + f.offset + w / 2 : f.align === 'end' ? sf.b - f.offset - w / 2 : sf.mid + f.offset;
    const n = sf.face + sf.into * (d / 2);
    [cx, cy] = sf.axis === 'x' ? [u, n] : [n, u];
  } else if (f.at) {
    [cx, cy] = f.at;
    facing = FACING_BY_ROTATION[f.rotation ?? 0];
  } else {
    // No position given: the middle of the room.
    cx = (room.inner.x0 + room.inner.x1) / 2;
    cy = (room.inner.y0 + room.inner.y1) / 2;
    facing = FACING_BY_ROTATION[f.rotation ?? 0];
  }
  return {
    id: f.id,
    kind: f.kind,
    room: f.room,
    auto: f.auto,
    cx,
    cy,
    w,
    d,
    h: spec.h,
    z0: elevation + (spec.mount ?? 0),
    facing,
    box: footprint(cx, cy, w, d, facing),
    solid: spec.solid !== false,
    ...(f.wall ? { wall: f.wall } : {}),
  };
}
