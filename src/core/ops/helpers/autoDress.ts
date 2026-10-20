import { openingDefaults } from '../../catalog/openings';
import type { Level, Opening, OpeningType, Project, Room, RoomType, Side } from '../../model/schema';
import { BEDROOM_TYPES, isDoorType, isEnclosed, isOutdoor, isPassable, isWindowType } from '../../model/schema';
import { resolveOpenings, roomEdges } from '../../geometry/openings';
import { pointInMulti } from '../../geometry/polygon';
import { roofZAt } from '../../geometry/roof';
import { type WallSeg, deriveWalls } from '../../geometry/walls';
import { resolve } from '../../resolve';

/**
 * "Auto until touched": doors and windows the app adds on its own carry auto=true and are rebuilt
 * after every change. Editing one pins it (auto=false) and from then on it is left alone.
 */

const PUBLIC: ReadonlySet<RoomType> = new Set(['living', 'family', 'great_room', 'dining', 'kitchen', 'foyer', 'hall', 'stair_hall', 'loft', 'sunroom', 'library', 'media', 'studio']);
const CIRCULATION: ReadonlySet<RoomType> = new Set(['hall', 'stair_hall', 'foyer', 'loft']);
const NO_WINDOWS: ReadonlySet<RoomType> = new Set(['closet', 'walk_in_closet', 'pantry', 'mechanical', 'storage', 'open_to_below']);

function preference(u: RoomType, n: RoomType): number {
  const circ = CIRCULATION.has(n);
  const liv = n === 'living' || n === 'family' || n === 'great_room';
  switch (u) {
    case 'bedroom':
    case 'nursery':
    case 'office':
    case 'primary_bedroom':
    case 'gym':
    case 'media':
    case 'library':
      return circ ? 10 : liv ? 6 : n === 'dining' || n === 'kitchen' ? 1 : BEDROOM_TYPES.has(n) ? -3 : n === 'bath' || n === 'half_bath' ? -10 : 0;
    case 'bath':
      return n === 'primary_bedroom' ? 12 : circ ? 10 : BEDROOM_TYPES.has(n) ? 6 : liv ? 3 : n === 'kitchen' ? -6 : 0;
    case 'half_bath':
      return circ || n === 'mudroom' ? 10 : liv ? 5 : n === 'kitchen' ? 1 : 0;
    case 'closet':
    case 'walk_in_closet':
      return BEDROOM_TYPES.has(n) ? 10 : circ ? 8 : n === 'mudroom' ? 6 : 0;
    case 'pantry':
      return n === 'kitchen' ? 10 : 0;
    case 'laundry':
    case 'mudroom':
    case 'mechanical':
    case 'storage':
      return n === 'kitchen' || circ || n === 'garage' || n === 'mudroom' || n === 'laundry' ? 8 : 1;
    case 'garage':
    case 'workshop':
      return n === 'mudroom' || n === 'laundry' ? 10 : n === 'kitchen' || circ ? 6 : 0;
    case 'kitchen':
      return n === 'dining' ? 10 : liv ? 8 : circ ? 6 : n === 'mudroom' ? 5 : 1;
    case 'dining':
      return n === 'kitchen' || liv ? 10 : circ ? 7 : 1;
    case 'living':
    case 'family':
    case 'great_room':
    case 'sunroom':
      return n === 'foyer' || n === 'stair_hall' ? 10 : circ ? 9 : n === 'dining' || liv ? 8 : n === 'kitchen' ? 7 : 1;
    default:
      return circ ? 10 : liv ? 6 : 1;
  }
}

function connectionType(a: RoomType, b: RoomType): OpeningType {
  if (PUBLIC.has(a) && PUBLIC.has(b)) {
    const open = (t: RoomType) => t === 'kitchen' || t === 'dining' || t === 'family' || t === 'great_room';
    if (open(a) && open(b)) return 'open';
    return 'cased_opening';
  }
  if (a === 'closet' || b === 'closet' || a === 'pantry' || b === 'pantry') return 'door';
  return 'door';
}

interface Span {
  side: Side;
  a: number;
  b: number;
  axis: 'x' | 'y';
  coord: number;
  other: string | null;
}

/** Exterior (and interior) spans along a room's sides. */
function spans(room: Room, walls: WallSeg[]): Span[] {
  const out: Span[] = [];
  for (const e of roomEdges(room)) {
    for (const w of walls) {
      if (w.axis !== e.axis || Math.abs(w.coord - e.coord) > 1e-6) continue;
      const a = Math.max(e.a, w.a);
      const b = Math.min(e.b, w.b);
      if (b - a < 1e-6) continue;
      const host = w.pos === room.id ? 1 : w.neg === room.id ? -1 : 0;
      if (!host) continue;
      if (w.kind !== 'exterior' && w.kind !== 'interior') continue;
      out.push({ side: e.side, a, b, axis: e.axis, coord: e.coord, other: host === 1 ? w.neg : w.pos });
    }
  }
  return out;
}

function sideRange(room: Room, side: Side): [number, number] {
  const es = roomEdges(room).filter((e) => e.side === side);
  if (!es.length) return [0, 0];
  const longest = es.reduce((p, q) => (q.b - q.a > p.b - p.a ? q : p));
  return [longest.a, longest.b];
}

export function autoDress(p: Project): string[] {
  const notes: string[] = [];
  for (const level of p.levels) level.openings = level.openings.filter((o) => !o.auto);
  // Resolve once without the auto openings to know elevations, roofs and stair landings.
  const res = resolve(p);
  p.levels.forEach((level, li) => {
    const rl = res.levels[li];
    const loftOver = level.kind === 'loft' && li > 0 ? res.levels[li - 1].footprint : undefined;
    const walls = deriveWalls({ level, levelIndex: li, floorAboveGrade: rl.elevation, style: p.style, loftOver }).walls;
    const rooms = new Map(level.rooms.map((r) => [r.id, r]));
    const add: Opening[] = [];
    const has = (o: Partial<Opening>) => [...level.openings, ...add].some((x) => Object.entries(o).every(([k, v]) => (x as Record<string, unknown>)[k] === v));

    // --- connectivity graph from passable openings
    const links = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!links.has(a)) links.set(a, new Set());
      if (!links.has(b)) links.set(b, new Set());
      links.get(a)!.add(b);
      links.get(b)!.add(a);
    };
    for (const o of level.openings) if (isPassable(o.type) && o.to) link(o.room, o.to === 'outside' ? '@out' : o.to);

    const adj = new Map<string, Map<string, number>>();
    for (const w of walls) {
      if (!w.pos || !w.neg) continue;
      if (w.kind !== 'interior' && w.kind !== 'none' && w.kind !== 'exterior') continue;
      for (const [a, b] of [
        [w.pos, w.neg],
        [w.neg, w.pos],
      ]) {
        if (!adj.has(a)) adj.set(a, new Map());
        adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + (w.b - w.a));
      }
    }
    // 'open' joins with no wall between them still count as connections
    for (const w of walls) if (w.kind === 'none' && w.pos && w.neg && isEnclosed(rooms.get(w.pos)!.type) && isEnclosed(rooms.get(w.neg)!.type)) link(w.pos, w.neg);

    const enclosed = level.rooms.filter((r) => isEnclosed(r.type));
    if (!enclosed.length) return;

    // --- entry points
    const roots = new Set<string>();
    if (li === 0) {
      const ext = [...level.openings].filter((o) => isDoorType(o.type) && (o.to === 'outside' || (o.to && isOutdoor(rooms.get(o.to)?.type ?? 'hall'))));
      for (const o of ext) roots.add(o.room);
      if (!roots.size) {
        const front = frontDoor(level, walls, rooms, p.site.front);
        if (front) {
          add.push(front);
          roots.add(front.room);
          link(front.room, front.to === 'outside' ? '@out' : front.to!);
        }
      }
    } else {
      for (const s of rl.stairHoles) {
        const cx = (s.footprint.x0 + s.footprint.x1) / 2;
        const cy = (s.footprint.y0 + s.footprint.y1) / 2;
        const host = enclosed.find((r) => pointInMulti([cx, cy], [[roomEdgesRing(r)]]));
        if (host) roots.add(host.id);
      }
      if (!roots.size) {
        const hub = enclosed.find((r) => CIRCULATION.has(r.type)) ?? enclosed[0];
        roots.add(hub.id);
      }
    }

    // --- connect every enclosed room
    const reach = new Set<string>();
    const flood = () => {
      const stack = [...roots, ...reach];
      while (stack.length) {
        const k = stack.pop()!;
        if (reach.has(k) && !roots.has(k)) continue;
        reach.add(k);
        for (const n of links.get(k) ?? []) if (!reach.has(n) && n !== '@out') stack.push(n);
      }
    };
    flood();
    for (let guard = 0; guard < 60; guard++) {
      let best: { u: Room; n: Room; score: number } | null = null;
      for (const u of enclosed) {
        if (reach.has(u.id)) continue;
        for (const [nid, len] of adj.get(u.id) ?? []) {
          const n = rooms.get(nid);
          if (!n || !isEnclosed(n.type) || len < 2.6) continue;
          const score = preference(u.type, n.type) + (reach.has(nid) ? 20 : 0) + Math.min(len, 12) * 0.05;
          if (!best || score > best.score) best = { u, n, score };
        }
      }
      if (!best) break;
      const type = connectionType(best.u.type, best.n.type);
      const id = `a${type === 'door' ? 'd' : 'o'}_${best.u.id}_${best.n.id}`.slice(0, 24);
      if (!has({ id })) {
        add.push(mk({ id, type, room: best.u.id, to: best.n.id, width: type === 'cased_opening' ? Math.min(5, (adj.get(best.u.id)!.get(best.n.id) ?? 6) - 1.5) : undefined }));
      }
      link(best.u.id, best.n.id);
      flood();
      if (!reach.has(best.u.id)) reach.add(best.u.id);
    }

    // --- outdoor rooms get a door from the house
    for (const out of level.rooms.filter((r) => isOutdoor(r.type))) {
      if ([...level.openings, ...add].some((o) => isPassable(o.type) && (o.to === out.id || o.room === out.id))) continue;
      let best: { r: Room; score: number } | null = null;
      for (const [nid, len] of adj.get(out.id) ?? []) {
        const r = rooms.get(nid);
        if (!r || !isEnclosed(r.type) || len < 3.5) continue;
        const score = (r.type === 'living' || r.type === 'family' || r.type === 'great_room' ? 10 : r.type === 'foyer' || r.type === 'stair_hall' ? 9 : r.type === 'kitchen' || r.type === 'dining' ? 8 : BEDROOM_TYPES.has(r.type) ? 4 : 1) + len * 0.05;
        if (!best || score > best.score) best = { r, score };
      }
      if (best) {
        const living = best.r.type === 'living' || best.r.type === 'family' || best.r.type === 'great_room' || best.r.type === 'sunroom';
        const shared = adj.get(out.id)?.get(best.r.id) ?? 0;
        add.push(mk({ id: `ad_${best.r.id}_${out.id}`.slice(0, 24), type: living && shared >= 8 ? 'french_door' : 'door', room: best.r.id, to: out.id }));
      }
    }

    // --- mudrooms get their own way in
    if (li === 0) {
      for (const m of level.rooms.filter((r) => r.type === 'mudroom')) {
        if ([...level.openings, ...add].some((o) => o.room === m.id && isDoorType(o.type) && (o.to === 'outside' || (o.to && isOutdoor(rooms.get(o.to)?.type ?? 'hall'))))) continue;
        const sp = spans(m, walls).filter((s) => (s.other === null || isOutdoor(rooms.get(s.other)!.type)) && s.b - s.a >= 4);
        if (!sp.length) continue;
        const s = sp.reduce((a, b) => ((b.side !== p.site.front ? 10 : 0) + b.b - b.a > (a.side !== p.site.front ? 10 : 0) + a.b - a.a ? b : a));
        const [r0, r1] = sideRange(m, s.side);
        add.push(mk({ id: `ad_${m.id}_out`, type: 'door', room: m.id, side: s.side, to: s.other ?? 'outside', offset: round((s.a + s.b) / 2 - (r0 + r1) / 2) }));
      }
    }

    // --- garages: a big door to the street side
    for (const g of level.rooms.filter((r) => r.type === 'garage')) {
      if (level.openings.some((o) => o.type === 'garage_door' && o.room === g.id)) continue;
      const sp = spans(g, walls).filter((s) => s.other === null);
      if (!sp.length) continue;
      const pref = (s: Span) => (s.side === p.site.front ? 100 : 0) + (s.b - s.a);
      const s = sp.reduce((a, b) => (pref(b) > pref(a) ? b : a));
      const len = s.b - s.a;
      const [r0, r1] = sideRange(g, s.side);
      add.push(mk({ id: `ag_${g.id}`, type: 'garage_door', room: g.id, side: s.side, to: 'outside', width: len >= 20 ? 16 : 9, offset: (s.a + s.b) / 2 - (r0 + r1) / 2 }));
    }

    // --- windows
    for (const room of level.rooms) {
      if (!isEnclosed(room.type) || NO_WINDOWS.has(room.type)) continue;
      if (level.openings.some((o) => o.room === room.id && isWindowType(o.type))) continue;
      const ext = spans(room, walls).filter((s) => s.other === null || isOutdoor(rooms.get(s.other)!.type));
      if (!ext.length) continue;
      const bySide = new Map<Side, Span[]>();
      for (const s of ext) {
        if (!bySide.has(s.side)) bySide.set(s.side, []);
        bySide.get(s.side)!.push(s);
      }
      const sides = [...bySide.entries()]
        .map(([side, list]) => ({ side, span: list.reduce((a, b) => (b.b - b.a > a.b - a.a ? b : a)) }))
        .filter(({ span }) => span.b - span.a >= 3.5)
        .filter(({ span }) => clearsRoof(res, li, span, room, rl.elevation))
        .sort((a, b) => b.span.b - b.span.a - (a.span.b - a.span.a));
      if (!sides.length) continue;
      const t = room.type;
      let maxSides = 2;
      let perSide = (len: number): number => (len >= 13 ? 2 : 1);
      if (t === 'living' || t === 'family' || t === 'great_room' || t === 'sunroom' || t === 'dining' || t === 'studio' || t === 'library') {
        maxSides = 3;
        perSide = (len) => Math.max(1, Math.min(4, Math.round(len / 8)));
      } else if (t === 'kitchen' || t === 'bath' || t === 'half_bath' || t === 'laundry' || t === 'mudroom' || t === 'hall' || t === 'foyer' || t === 'stair_hall' || t === 'garage' || t === 'workshop') {
        maxSides = 1;
        perSide = () => 1;
      }
      const defaults = openingDefaults('window', { exterior: true, hostType: t });
      const w = t === 'hall' || t === 'foyer' || t === 'stair_hall' ? 2.5 : t === 'garage' || t === 'workshop' ? 2.5 : defaults.width;
      for (const { side, span } of sides.slice(0, maxSides)) {
        const [r0, r1] = sideRange(room, side);
        const n = perSide(span.b - span.a);
        for (let k = 0; k < n; k++) {
          const c = span.a + ((k + 0.5) / n) * (span.b - span.a);
          if (c - w / 2 < span.a + 0.6 || c + w / 2 > span.b - 0.6) continue;
          add.push(mk({ id: `aw_${room.id}_${side}${k + 1}`.slice(0, 24), type: 'window', room: room.id, side, to: span.other === null ? 'outside' : span.other, offset: round(c - (r0 + r1) / 2), width: w }));
        }
      }
    }

    // Keep auto windows off the spots where doors sit: resolve them and drop any that collide.
    let final = [...level.openings, ...add.filter((o) => !level.suppress.includes(o.id))];
    for (let pass = 0; pass < 3; pass++) {
      const clashes = resolveOpenings({ ...level, openings: final }, walls).issues.filter((i) => i.rule === 'opening.overlap' || i.rule === 'opening.no_wall' || i.rule === 'opening.no_room');
      const drop = new Set(clashes.map((i) => i.ids[0]).filter((id) => final.find((o) => o.id === id)?.auto));
      if (!drop.size) break;
      final = final.filter((o) => !drop.has(o.id));
    }
    level.openings = final;
  });
  return notes;
}

const round = (v: number) => Math.round(v * 12) / 12;

function mk(o: Partial<Opening> & Pick<Opening, 'id' | 'type' | 'room'>): Opening {
  return { align: 'center', offset: 0, count: 1, swing: 'auto', auto: true, ...o } as Opening;
}

function roomEdgesRing(r: Room): [number, number][] {
  if (r.poly) return r.poly as [number, number][];
  const [x, y, w, d] = r.rect!;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ];
}

/** On half stories and under eaves, only walls tall enough inside for a window get one. */
function clearsRoof(res: ReturnType<typeof resolve>, li: number, s: Span, room: Room, elevation: number): boolean {
  const level = res.levels[li];
  if (level.level.kind === 'full' && level.hasFloorAbove) return true;
  const roofLevel = level.roofLevel;
  // Probe just inside the room, at the inner face of the wall.
  const inward = s.side === 'S' || s.side === 'W' ? 1 : -1;
  const head = openingDefaults('window', { exterior: true, hostType: room.type });
  const need = head.sill + head.height + 0.25;
  const pts = [0.25, 0.5, 0.75].map((t) => s.a + (s.b - s.a) * t);
  return pts.some((u) => {
    const [x, y]: [number, number] = s.axis === 'x' ? [u, s.coord + inward * 0.45] : [s.coord + inward * 0.45, u];
    const z = roofZAt(res.roof.faces, roofLevel, x, y);
    return z === null || z - res.roof.thickness - elevation >= need;
  });
}

/** Choose and build the front door. */
function frontDoor(level: Level, walls: WallSeg[], rooms: Map<string, Room>, front: Side): Opening | null {
  const score: Partial<Record<RoomType, number>> = { foyer: 10, stair_hall: 9, living: 8, great_room: 8, hall: 7, family: 6, kitchen: 4, dining: 3, mudroom: 3 };
  let best: { room: Room; span: Span; score: number } | null = null;
  for (const room of level.rooms) {
    if (!isEnclosed(room.type)) continue;
    for (const s of spans(room, walls)) {
      const outdoor = s.other !== null && isOutdoor(rooms.get(s.other)!.type);
      if (s.other !== null && !outdoor) continue;
      if (s.b - s.a < 4) continue;
      const sc = (score[room.type] ?? 1) + (s.side === front ? 20 : 0) + (outdoor ? 5 : 0) + Math.min(s.b - s.a, 10) * 0.1;
      if (!best || sc > best.score) best = { room, span: s, score: sc };
    }
  }
  if (!best) return null;
  const [r0, r1] = sideRange(best.room, best.span.side);
  return mk({
    id: `ad_${best.room.id}_front`,
    type: 'door',
    room: best.room.id,
    side: best.span.side,
    to: best.span.other ?? 'outside',
    offset: round((best.span.a + best.span.b) / 2 - (r0 + r1) / 2),
  });
}
