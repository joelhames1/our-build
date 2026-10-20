import type { Issue } from '../model/issues';
import type { Room } from '../model/schema';
import { BEDROOM_TYPES, HABITABLE_TYPES, isDoorType, isEnclosed, isOutdoor, isPassable, isWindowType } from '../model/schema';
import { ftIn } from '../model/units';
import { type Box, difference, multiArea, multiBox, roomRing, union } from '../geometry/polygon';
import type { ResolvedFixture } from '../geometry/fixtures';
import { fixtureSpec } from '../catalog/fixtures';
import type { Resolved, ResolvedLevel } from '../resolve';

/**
 * Residential guardrails, inspired by the IRC but phrased as friendly guidance. Not code
 * compliance: just the things a thoughtful designer would point out.
 */
export function checkRules(res: Resolved): Issue[] {
  const out: Issue[] = [];
  for (const rl of res.levels) {
    out.push(...sizes(rl), ...egressAndLight(rl, res), ...reach(rl), ...closets(rl), ...stairs(rl), ...gaps(rl), ...garage(rl), ...kitchens(rl), ...baths(rl), ...furniture(rl));
  }
  out.push(...cantilever(res));
  return out;
}

const name = (r: Room) => r.name;

function sizes(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  for (const info of rl.rooms.values()) {
    const r = info.room;
    const minDim = Math.min(info.clearW, info.clearD);
    if (HABITABLE_TYPES.has(r.type) && r.type !== 'kitchen') {
      if (info.netArea < 70 || minDim < 7) {
        out.push({ rule: 'size.habitable', severity: 'warning', message: `${name(r)} is tight (${ftIn(info.clearW)} × ${ftIn(info.clearD)}). Livable rooms want at least 70 sf and 7' each way.`, level: rl.level.id, ids: [r.id] });
      }
    }
    if (r.type === 'hall' && minDim < 3) {
      out.push({ rule: 'hall', severity: 'warning', message: `The hall is only ${ftIn(minDim)} wide; 3' is the minimum and 3'-6" feels comfortable.`, level: rl.level.id, ids: [r.id] });
    }
    if (r.type === 'bath' && (minDim < 5 || info.netArea < 35)) {
      out.push({ rule: 'bath.size', severity: 'warning', message: `${name(r)} is small for a full bath (${ftIn(info.clearW)} × ${ftIn(info.clearD)}); 5' × 8' is the classic minimum.`, level: rl.level.id, ids: [r.id] });
    }
    if (r.type === 'half_bath' && (minDim < 3 || info.netArea < 18)) {
      out.push({ rule: 'bath.size', severity: 'warning', message: `${name(r)} is small for a powder room; aim for about 3' × 6'.`, level: rl.level.id, ids: [r.id] });
    }
    if (rl.level.kind === 'full' && rl.level.ceiling < 7 && HABITABLE_TYPES.has(r.type)) {
      out.push({ rule: 'ceiling', severity: 'warning', message: `Ceilings on ${rl.level.name} are under 7'.`, level: rl.level.id, ids: [rl.level.id] });
    }
  }
  return out;
}

function egressAndLight(rl: ResolvedLevel, res: Resolved): Issue[] {
  const out: Issue[] = [];
  const style = res.project.style.windows;
  for (const info of rl.rooms.values()) {
    const r = info.room;
    const wins = rl.openings.filter((o) => o.room === r.id && isWindowType(o.type) && o.type !== 'transom');
    const doorsOut = rl.openings.filter((o) => o.room === r.id && isDoorType(o.type) && o.exterior);
    if (BEDROOM_TYPES.has(r.type)) {
      const egress = wins.some((w) => {
        const open = style === 'double_hung' ? w.unitWidth * (w.height / 2) * 0.85 : w.unitWidth * w.height * 0.8;
        return open >= 5.0 && w.unitWidth >= 1.67 && w.height >= 2 && w.sill <= 3.67;
      });
      if (!egress && !doorsOut.length) {
        out.push({
          rule: 'egress',
          severity: 'warning',
          message: wins.length ? `${name(r)} needs a window big enough to climb out of in an emergency (about 3' × 5' with a sill under 44").` : `${name(r)} has no window. Bedrooms need one big enough to escape through.`,
          level: rl.level.id,
          ids: [r.id],
          fix: wins.length ? [{ op: 'update_opening', opening: wins[0].id, width: 3, height: 5, sill: 2.5 }] : [{ op: 'add_opening', type: 'window', room: r.id, to: 'outside', width: 3, height: 5, sill: 2.5 }],
        });
      }
    }
    if (HABITABLE_TYPES.has(r.type)) {
      const glass = wins.reduce((s, w) => s + w.unitWidth * w.count * w.height, 0) + rl.openings.filter((o) => o.room === r.id && (o.type === 'french_door' || o.type === 'slider')).reduce((s, o) => s + (o.u1 - o.u0) * o.height * 0.8, 0);
      if (glass < info.netArea * 0.08 && !BEDROOM_TYPES.has(r.type)) {
        out.push({ rule: 'light', severity: 'tip', message: `${name(r)} could use more daylight; windows totaling about ${Math.ceil(info.netArea * 0.08)} sf would brighten it.`, level: rl.level.id, ids: [r.id] });
      }
    }
  }
  return out;
}

function reach(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  const rooms = [...rl.rooms.values()].map((i) => i.room);
  const enclosed = rooms.filter((r) => isEnclosed(r.type));
  if (!enclosed.length) return out;
  const g = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!g.has(a)) g.set(a, new Set());
    if (!g.has(b)) g.set(b, new Set());
    g.get(a)!.add(b);
    g.get(b)!.add(a);
  };
  for (const o of rl.openings) if (isPassable(o.type)) link(o.room, o.other ?? '@out');
  for (const w of rl.walls) if (w.kind === 'none' && w.pos && w.neg) link(w.pos, w.neg);
  // Entry points: outside (ground floor) or the stair arrival (upper floors).
  const roots = new Set<string>();
  if (rl.index === 0) roots.add('@out');
  for (const s of rl.stairHoles) {
    const cx = (s.footprint.x0 + s.footprint.x1) / 2;
    const cy = (s.footprint.y0 + s.footprint.y1) / 2;
    for (const info of rl.rooms.values()) if (cx >= info.box.x0 && cx <= info.box.x1 && cy >= info.box.y0 && cy <= info.box.y1) roots.add(info.room.id);
  }
  // Outdoor rooms connect to the outside.
  for (const r of rooms) if (isOutdoor(r.type) && rl.index === 0) link(r.id, '@out');
  if (!roots.size) return out;
  const seen = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length) {
    const k = stack.pop()!;
    for (const n of g.get(k) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
  }
  for (const r of enclosed) {
    if (r.type === 'open_to_below') continue;
    if (!seen.has(r.id)) out.push({ rule: 'reach', severity: 'warning', message: `${name(r)} can't be reached: it has no door or opening to the rest of the house.`, level: rl.level.id, ids: [r.id] });
  }
  if (rl.index === 0 && !rl.openings.some((o) => isDoorType(o.type) && (o.other === null || isOutdoor(rl.rooms.get(o.other)?.room.type ?? 'hall')))) {
    out.push({ rule: 'reach.entry', severity: 'warning', message: 'There is no door to the outside on the ground floor.', level: rl.level.id, ids: [rl.level.id] });
  }
  // Bedroom only reachable through another bedroom.
  for (const r of enclosed.filter((x) => BEDROOM_TYPES.has(x.type))) {
    const viaOthers = [...(g.get(r.id) ?? [])];
    if (viaOthers.length && viaOthers.every((n) => BEDROOM_TYPES.has(rl.rooms.get(n)?.room.type ?? 'hall'))) {
      out.push({ rule: 'reach.bedroom', severity: 'tip', message: `${name(r)} is only reached through another bedroom.`, level: rl.level.id, ids: [r.id] });
    }
  }
  return out;
}

function closets(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  const rooms = [...rl.rooms.values()];
  for (const info of rooms) {
    const r = info.room;
    if (!BEDROOM_TYPES.has(r.type)) continue;
    const hasCloset = rl.openings.some((o) => (o.room === r.id && rl.rooms.get(o.other ?? '')?.room.type.includes('closet')) || (o.other === r.id && rl.rooms.get(o.room)?.room.type.includes('closet'))) || rl.level.fixtures.some((f) => f.room === r.id && f.kind.includes('wardrobe'));
    if (!hasCloset) out.push({ rule: 'bedroom.closet', severity: 'tip', message: `${name(r)} has no closet yet.`, level: rl.level.id, ids: [r.id] });
  }
  return out;
}

function stairs(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  for (const s of rl.stairs) {
    if (s.width < 3) out.push({ rule: 'stair.width', severity: 'warning', message: `The stairs are ${ftIn(s.width)} wide; 3' is the minimum.`, level: rl.level.id, ids: [s.id], fix: [{ op: 'update_stairs', stairs: s.id, width: 3.5 }] });
  }
  return out;
}

function gaps(rl: ResolvedLevel): Issue[] {
  const enclosed = [...rl.rooms.values()].filter((i) => isEnclosed(i.room.type) || i.room.type === 'open_to_below');
  if (enclosed.length < 2) return [];
  const u = union(...enclosed.map((i) => [[roomRing(i.room)]]));
  const holes = u.flatMap((p) => p.slice(1)).filter((h) => multiArea([[h]]) > 4);
  if (!holes.length) return [];
  const area = holes.reduce((s, h) => s + multiArea([[h]]), 0);
  return [{ rule: 'geo.gap', severity: 'warning', message: `There's ${Math.round(area)} sf of unassigned space enclosed on ${rl.level.name}.`, level: rl.level.id, ids: [rl.level.id] }];
}

function garage(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  for (const o of rl.openings) {
    if (!isDoorType(o.type) || !o.other) continue;
    const a = rl.rooms.get(o.room)?.room.type;
    const b = rl.rooms.get(o.other)?.room.type;
    if ((a === 'garage' && b && BEDROOM_TYPES.has(b)) || (b === 'garage' && a && BEDROOM_TYPES.has(a))) {
      out.push({ rule: 'garage.bedroom', severity: 'warning', message: 'A garage shouldn’t open straight into a bedroom.', level: rl.level.id, ids: [o.id], fix: [{ op: 'remove_opening', opening: o.id }] });
    }
  }
  return out;
}

function cantilever(res: Resolved): Issue[] {
  const out: Issue[] = [];
  for (let i = 1; i < res.levels.length; i++) {
    const over = difference(res.levels[i].footprint, res.levels[i - 1].footprint);
    if (!over.length) continue;
    const b = multiBox(over);
    const depth = Math.min(b.x1 - b.x0, b.y1 - b.y0);
    if (depth > 2.05 && multiArea(over) > 8) {
      out.push({ rule: 'struct.cantilever', severity: 'warning', message: `${res.levels[i].level.name} hangs ${ftIn(depth)} past the floor below. Over 2' needs real structure (posts or beams).`, level: res.levels[i].level.id, ids: [res.levels[i].level.id] });
    }
  }
  return out;
}

// --- kitchens, baths and furniture ---------------------------------------------------------------

/** Clear distance between two footprints (negative when they overlap). Corner to corner is a true distance. */
const gap = (a: Box, b: Box) => {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1);
  return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
};
const center = (f: ResolvedFixture): [number, number] => [f.cx, f.cy];
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const label = (f: ResolvedFixture) => fixtureSpec(f.kind).label;

function kitchens(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  for (const info of rl.rooms.values()) {
    const r = info.room;
    if (r.type !== 'kitchen' || r.furnish === 'none') continue;
    const fx = rl.fixtures.filter((f) => f.room === r.id);
    const sink = fx.find((f) => f.kind === 'sink' || f.kind === 'island_sink');
    const range = fx.find((f) => f.kind === 'range' || f.kind === 'island_cooktop');
    const fridge = fx.find((f) => f.kind === 'fridge');
    const missing = [!sink && 'a sink', !range && 'a range', !fridge && 'a refrigerator'].filter(Boolean) as string[];
    if (missing.length) {
      out.push({ rule: 'kitchen.missing', severity: 'warning', message: `${name(r)} has no room for ${missing.join(' or ')}. A bigger kitchen or a different layout would fit them.`, level: rl.level.id, ids: [r.id] });
    } else {
      // The work triangle: sink, range and fridge within easy reach of each other.
      const legs = [dist(center(sink!), center(range!)), dist(center(range!), center(fridge!)), dist(center(fridge!), center(sink!))];
      const total = legs.reduce((a, b) => a + b, 0);
      if (total > 28) out.push({ rule: 'kitchen.triangle', severity: 'tip', message: `The walk between sink, range and fridge in ${name(r)} adds up to about ${Math.round(total)}'. Under 26' keeps cooking easy.`, level: rl.level.id, ids: [r.id, sink!.id, range!.id, fridge!.id] });
      else if (total < 11) out.push({ rule: 'kitchen.triangle', severity: 'tip', message: `Sink, range and fridge in ${name(r)} are bunched within ${Math.round(total)}'; a little more counter between them helps.`, level: rl.level.id, ids: [r.id] });
    }
    // Aisles at the island.
    const island = fx.find((f) => f.kind === 'island');
    if (island) {
      for (const f of fx) {
        if (f === island || !f.solid || f.z0 - rl.elevation > 2 || f.kind === 'bar_stool') continue;
        const g = gap(island.box, f.box);
        if (g >= 0 && g < 3.4) {
          out.push({ rule: 'kitchen.aisle', severity: 'tip', message: `The aisle between the island and the ${label(f)} in ${name(r)} is ${ftIn(g)}; 42" lets two people pass.`, level: rl.level.id, ids: [island.id, f.id] });
          break;
        }
      }
    } else if (r.kitchen?.island || r.kitchen?.sink === 'island' || r.kitchen?.range === 'island') {
      out.push({
        rule: 'kitchen.island',
        severity: 'tip',
        message:
          r.kitchen?.shape === 'galley'
            ? `A galley kitchen like ${name(r)} has no room for an island; an L-shaped layout would make space for one.`
            : `${name(r)} isn't big enough for an island: it needs about 3'-6" of aisle all round. Making the kitchen deeper would fit one.`,
        level: rl.level.id,
        ids: [r.id],
        fix: [{ op: 'set_kitchen', room: r.id, island: false, ...(r.kitchen?.sink === 'island' ? { sink: undefined } : {}), ...(r.kitchen?.range === 'island' ? { range: undefined } : {}) }],
      });
    }
  }
  return out;
}

function baths(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  for (const f of rl.fixtures) {
    if (f.kind !== 'toilet' || f.auto) continue;
    const info = rl.rooms.get(f.room);
    if (!info) continue;
    // 15" from the centerline to anything beside it, 21" clear in front.
    const across = f.facing === 'N' || f.facing === 'S' ? 'x' : 'y';
    const side: Box = across === 'x' ? { x0: f.cx - 1.25, x1: f.cx + 1.25, y0: f.box.y0, y1: f.box.y1 } : { y0: f.cy - 1.25, y1: f.cy + 1.25, x0: f.box.x0, x1: f.box.x1 };
    const front: Box =
      f.facing === 'N' ? { ...f.box, y0: f.box.y1, y1: f.box.y1 + 1.75 } : f.facing === 'S' ? { ...f.box, y1: f.box.y0, y0: f.box.y0 - 1.75 } : f.facing === 'E' ? { ...f.box, x0: f.box.x1, x1: f.box.x1 + 1.75 } : { ...f.box, x1: f.box.x0, x0: f.box.x0 - 1.75 };
    const inner = info.inner;
    const outside = (b: Box) => b.x0 < inner.x0 - 0.05 || b.x1 > inner.x1 + 0.05 || b.y0 < inner.y0 - 0.05 || b.y1 > inner.y1 + 0.05;
    const hits = (b: Box) => rl.fixtures.some((o) => o !== f && o.solid && o.z0 - rl.elevation < 3 && gap(o.box, b) < -0.05);
    if (outside(side) || hits(side) || outside(front) || hits(front)) {
      out.push({ rule: 'bath.toilet', severity: 'warning', message: `The toilet in ${info.room.name} is tight: it wants 15" from its center to anything beside it and 21" clear in front.`, level: rl.level.id, ids: [f.id] });
    }
  }
  return out;
}

function furniture(rl: ResolvedLevel): Issue[] {
  const out: Issue[] = [];
  // Hand-placed pieces can end up in a doorway; auto ones never do.
  for (const o of rl.openings) {
    if (!isPassable(o.type) || o.type === 'garage_door') continue;
    for (const roomId of [o.room, o.other]) {
      if (!roomId) continue;
      const info = rl.rooms.get(roomId);
      if (!info) continue;
      const inPos = roomId === o.room ? o.hostSign === 1 : o.hostSign === -1;
      const n0 = o.wall.coord + (inPos ? 1 : -1) * (o.wall.thickness / 2);
      const n1 = n0 + (inPos ? 1 : -1) * 2;
      const [lo, hi] = n0 < n1 ? [n0, n1] : [n1, n0];
      const zone: Box = o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: lo, y1: hi } : { y0: o.u0, y1: o.u1, x0: lo, x1: hi };
      const f = rl.fixtures.find((x) => !x.auto && x.solid && x.room === roomId && x.z0 - rl.elevation < 2 && gap(x.box, zone) < -0.1);
      if (f) {
        const other = roomId === o.room ? o.other : o.room;
        const to = other ? (rl.rooms.get(other)?.room.name ?? 'the next room') : 'outside';
        out.push({ rule: 'fixture.door', severity: 'warning', message: `The ${label(f)} in ${info.room.name} is in the way of the door to ${to}.`, level: rl.level.id, ids: [f.id, o.id], fix: [{ op: 'remove_fixture', fixture: f.id }] });
      }
    }
  }
  for (const info of rl.rooms.values()) {
    const r = info.room;
    if ((r.type !== 'bedroom' && r.type !== 'primary_bedroom') || r.furnish === 'none') continue;
    if (rl.level.suppress.some((id) => id.startsWith(`af_${r.id}_bed`))) continue;
    if (!rl.fixtures.some((f) => f.room === r.id && f.kind.startsWith('bed_'))) {
      out.push({ rule: 'bedroom.bed', severity: 'tip', message: `No bed fits in ${name(r)} with room to walk around it. A little more space or one less door would help.`, level: rl.level.id, ids: [r.id] });
    }
  }
  return out;
}
