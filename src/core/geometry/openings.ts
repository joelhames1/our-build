import { MULLION, openingDefaults } from '../catalog/openings';
import type { Issue } from '../model/issues';
import type { Level, Opening, Room, Side } from '../model/schema';
import { isDoorType, isOutdoor, isWindowType } from '../model/schema';
import { roomRing } from './polygon';
import type { WallSeg } from './walls';

export interface RoomEdge {
  side: Side;
  axis: 'x' | 'y';
  coord: number;
  a: number;
  b: number;
}

/** Sides of a room. Counter-clockwise ring: +x travel = S side, -x = N, +y = E, -y = W. */
export function roomEdges(room: Room): RoomEdge[] {
  const ring = roomRing(room);
  const out: RoomEdge[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    if (Math.abs(y1 - y2) < 1e-9 && Math.abs(x1 - x2) > 1e-9)
      out.push({ side: x2 > x1 ? 'S' : 'N', axis: 'x', coord: y1, a: Math.min(x1, x2), b: Math.max(x1, x2) });
    else if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) > 1e-9)
      out.push({ side: y2 > y1 ? 'E' : 'W', axis: 'y', coord: x1, a: Math.min(y1, y2), b: Math.max(y1, y2) });
  }
  return out;
}

export interface ResolvedOpening {
  id: string;
  type: Opening['type'];
  room: string;
  /** The room on the other side, or null when it is the outside. */
  other: string | null;
  side: Side;
  axis: 'x' | 'y';
  coord: number;
  /** Extent along the wall axis. */
  u0: number;
  u1: number;
  unitWidth: number;
  count: number;
  sill: number;
  height: number;
  head: number;
  wall: WallSeg;
  exterior: boolean;
  /** +1 if the host room is on the wall's pos side. */
  hostSign: 1 | -1;
  /** Door hinge end and the side the leaf swings toward (+1 pos, -1 neg). */
  hinge: 'u0' | 'u1';
  swingTo: 1 | -1;
  style?: string;
  auto: boolean;
}

interface Candidate {
  edge: RoomEdge;
  i0: number;
  i1: number;
  wall: WallSeg;
  other: string | null;
}

export function resolveOpenings(level: Level, walls: WallSeg[]): { openings: ResolvedOpening[]; issues: Issue[] } {
  const rooms = new Map(level.rooms.map((r) => [r.id, r]));
  const out: ResolvedOpening[] = [];
  const issues: Issue[] = [];
  const taken: { wall: WallSeg; u0: number; u1: number; id: string }[] = [];

  for (const o of level.openings) {
    const host = rooms.get(o.room);
    if (!host) {
      issues.push({ rule: 'opening.orphan', severity: 'warning', message: `${label(o)} ${o.id} belongs to a room that no longer exists.`, level: level.id, ids: [o.id], fix: [{ op: 'remove_opening', opening: o.id }] });
      continue;
    }
    const r = resolveOne(o, host, rooms, walls);
    if ('issue' in r) {
      issues.push({ ...r.issue, level: level.id });
      continue;
    }
    // Avoid two openings on top of each other: slide later ones along the wall if they collide.
    const res = r.opening;
    const clash = taken.find((t) => t.wall.id === res.wall.id && res.u0 < t.u1 - 0.05 && t.u0 < res.u1 - 0.05 && overlapsVertically(res, out.find((x) => x.id === t.id)!));
    if (clash && res.type !== 'open') {
      issues.push({ rule: 'opening.overlap', severity: 'warning', message: `${label(o)} ${o.id} overlaps ${clash.id} in ${host.name}.`, level: level.id, ids: [o.id, clash.id] });
    }
    taken.push({ wall: res.wall, u0: res.u0, u1: res.u1, id: res.id });
    out.push(res);
  }
  return { openings: out, issues };
}

const overlapsVertically = (a: ResolvedOpening, b?: ResolvedOpening) => !b || (a.sill < b.head && b.sill < a.head);

const label = (o: Opening) => (isWindowType(o.type) ? 'Window' : isDoorType(o.type) ? 'Door' : 'Opening');

function matcher(o: Opening, rooms: Map<string, Room>): (other: string | null) => boolean {
  const outsideish = (other: string | null) => other === null || isOutdoor(rooms.get(other)!.type);
  if (o.to === 'outside') return outsideish;
  if (o.to) return (other) => other === o.to;
  if (isWindowType(o.type)) return outsideish;
  return () => true;
}

function resolveOne(o: Opening, host: Room, rooms: Map<string, Room>, walls: WallSeg[]): { opening: ResolvedOpening } | { issue: Omit<Issue, 'level'> } {
  const matches = matcher(o, rooms);
  const edges = roomEdges(host).filter((e) => !o.side || e.side === o.side);
  const cands: Candidate[] = [];
  for (const e of edges) {
    for (const w of walls) {
      if (w.axis !== e.axis || Math.abs(w.coord - e.coord) > 1e-6) continue;
      const i0 = Math.max(e.a, w.a);
      const i1 = Math.min(e.b, w.b);
      if (i1 - i0 < 1e-6) continue;
      const hostSign = w.pos === host.id ? 1 : w.neg === host.id ? -1 : 0;
      if (!hostSign) continue;
      const other = hostSign === 1 ? w.neg : w.pos;
      if (!matches(other)) continue;
      const okKind = o.type === 'open' ? w.kind === 'none' || w.kind === 'interior' || w.kind === 'railing' : w.kind === 'exterior' || w.kind === 'interior';
      if (!okKind) continue;
      cands.push({ edge: e, i0, i1, wall: w, other });
    }
  }
  const what = `${label(o)} ${o.id}`;
  if (!cands.length) {
    const target = o.to === 'outside' || (!o.to && isWindowType(o.type)) ? 'the outside' : o.to ? rooms.get(o.to)?.name ?? o.to : 'another room';
    const sideTxt = o.side ? ` on its ${sideName(o.side)} side` : '';
    return {
      issue: {
        rule: 'opening.no_wall',
        severity: 'warning',
        message: `${what} in ${host.name} has no wall${sideTxt} shared with ${target}, so it can't be placed.`,
        ids: [o.id, host.id],
        fix: [{ op: 'remove_opening', opening: o.id }],
      },
    };
  }

  // Pick the room side (longest usable length per side), then the interval.
  const bySide = new Map<string, Candidate[]>();
  for (const c of cands) {
    const k = `${c.edge.side}:${c.edge.coord}:${c.edge.a}`;
    if (!bySide.has(k)) bySide.set(k, []);
    bySide.get(k)!.push(c);
  }
  let best: Candidate[] = [];
  let bestLen = -1;
  for (const list of bySide.values()) {
    const len = list.reduce((s, c) => s + (c.i1 - c.i0), 0);
    if (len > bestLen + 1e-6) {
      bestLen = len;
      best = list;
    }
  }
  const edge = best[0].edge;
  const exteriorGuess = best.some((c) => c.other === null || isOutdoor(rooms.get(c.other)!.type));
  const defaults = openingDefaults(o.type, { exterior: exteriorGuess, hostType: host.type, otherType: best[0].other ? rooms.get(best[0].other!)?.type : undefined });
  let unit = o.width ?? defaults.width;
  let count = o.count ?? 1;
  const total = () => count * unit + (count - 1) * MULLION;

  if (o.type === 'open') {
    // An 'open' connection spans the whole shared boundary.
    const c = best.reduce((p, q) => (q.i1 - q.i0 > p.i1 - p.i0 ? q : p));
    return { opening: build(o, host, c, c.i0, c.i1, c.i1 - c.i0, 1, 0, 9) };
  }

  const want = o.align === 'start' ? edge.a + (o.offset ?? 0) + total() / 2 : o.align === 'end' ? edge.b - (o.offset ?? 0) - total() / 2 : (edge.a + edge.b) / 2 + (o.offset ?? 0);
  const sorted = [...best].sort((p, q) => dist(want, p) - dist(want, q) || q.i1 - q.i0 - (p.i1 - p.i0));
  for (const c of sorted) {
    const [lo, hi] = clearRange(c, walls, isDoorType(o.type));
    const avail = hi - lo;
    if (avail <= 0.5) continue;
    while (count > 1 && total() > avail) count--;
    const minW = isDoorType(o.type) ? 2 : 1.25;
    if (total() > avail) {
      if (avail < minW) continue;
      unit = Math.floor(avail * 12) / 12;
    }
    const half = total() / 2;
    const center = Math.min(Math.max(want, lo + half), hi - half);
    const sill = o.sill ?? defaults.sill;
    const height = o.height ?? defaults.height;
    return { opening: build(o, host, c, center - half, center + half, unit, count, sill, height) };
  }
  return {
    issue: {
      rule: 'opening.no_room',
      severity: 'warning',
      message: `${what} doesn't fit on that wall of ${host.name}.`,
      ids: [o.id, host.id],
      fix: [{ op: 'remove_opening', opening: o.id }],
    },
  };
}

function build(o: Opening, host: Room, c: Candidate, u0: number, u1: number, unit: number, count: number, sill: number, height: number): ResolvedOpening {
  const hostSign: 1 | -1 = c.wall.pos === host.id ? 1 : -1;
  let hinge: 'u0' | 'u1' = u0 - c.i0 <= c.i1 - u1 ? 'u0' : 'u1';
  if (o.swing === 'left' || o.swing === 'out_left') hinge = 'u0';
  if (o.swing === 'right' || o.swing === 'out_right') hinge = 'u1';
  const out = o.swing === 'out_left' || o.swing === 'out_right';
  return {
    id: o.id,
    type: o.type,
    room: host.id,
    other: c.other,
    side: c.edge.side,
    axis: c.edge.axis,
    coord: c.edge.coord,
    u0,
    u1,
    unitWidth: unit,
    count,
    sill,
    height,
    head: sill + height,
    wall: c.wall,
    exterior: c.wall.kind === 'exterior',
    hostSign,
    hinge,
    swingTo: out ? (-hostSign as 1 | -1) : hostSign,
    style: o.style,
    auto: o.auto ?? false,
  };
}

const dist = (v: number, c: { i0: number; i1: number }) => (v < c.i0 ? c.i0 - v : v > c.i1 ? v - c.i1 : 0);

/** Usable range along a candidate interval, keeping clear of perpendicular walls at its ends. */
function clearRange(c: Candidate, walls: WallSeg[], door: boolean): [number, number] {
  const pad = door ? 0.3 : 0.4;
  const endPad = (u: number) => {
    let t = 0;
    for (const w of walls) {
      if (w.axis === c.wall.axis || (w.kind !== 'exterior' && w.kind !== 'interior')) continue;
      if (Math.abs(w.coord - u) > 1e-6) continue;
      if (w.a - 1e-6 <= c.wall.coord && c.wall.coord <= w.b + 1e-6) t = Math.max(t, w.thickness / 2);
    }
    return t > 0 ? t + pad : 0.15;
  };
  return [c.i0 + endPad(c.i0), c.i1 - endPad(c.i1)];
}

export const sideName = (s: Side) => ({ N: 'north', E: 'east', S: 'south', W: 'west' })[s];
